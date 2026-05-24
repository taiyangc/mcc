import { NextResponse } from "next/server";

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const ACTIVE_TTL_MS = 60 * 1000;       // window still open — refresh every minute
const ELAPSED_TTL_MS = 60 * 60 * 1000; // window fully elapsed — classification is frozen, cache 1h
const DEFAULT_WINDOW_HOURS = 24;
const MIN_WINDOW_HOURS = 1;
const MAX_WINDOW_HOURS = 7 * 24;
const HYPE_SPOT_COINS = new Set(["@107"]); // HYPE/USDC primary spot pair

export interface WalletActivity {
  user: string;
  since: number;
  windowHours: number;
  currentHypeBalance: number;
  soldOnHl: { twapAmount: number; marketAmount: number; fillCount: number };
  transferredOut: { totalAmount: number; transferCount: number; destinations: string[] };
}

interface HlFill { coin: string; sz: string; side: string; tid: number; time: number }
interface HlLedgerEntry {
  time: number;
  delta: {
    type: string;
    token?: string;
    amount?: string;
    user?: string;
    destination?: string;
  };
}
interface HlTwapSliceFill { fill: { tid: number } }
interface HlSpotState { balances?: Array<{ coin: string; total: string }> }

interface CacheEntry { data: WalletActivity; timestamp: number }
const cache = new Map<string, CacheEntry>();

function clampWindowHours(h: unknown): number {
  const n = typeof h === "number" && Number.isFinite(h) ? Math.round(h) : DEFAULT_WINDOW_HOURS;
  return Math.min(MAX_WINDOW_HOURS, Math.max(MIN_WINDOW_HOURS, n));
}

async function hlPost<T>(body: unknown): Promise<T | null> {
  try {
    const res = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Fetch the combined window for one address, then derive per-`since` activities from the
// shared data. One set of HL info calls per address, regardless of how many entries that
// address has — vs. the naive per-entry fan-out which scales O(entries).
async function classifyAddressWindow(addr: string, sinces: number[], windowMs: number, now: number): Promise<WalletActivity[]> {
  if (sinces.length === 0) return [];
  const windowHours = Math.round(windowMs / (60 * 60 * 1000));
  const startTime = Math.min(...sinces);
  const endTime = Math.min(Math.max(...sinces) + windowMs, now);

  const [spot, fills, ledger] = await Promise.all([
    hlPost<HlSpotState>({ type: "spotClearinghouseState", user: addr }),
    hlPost<HlFill[]>({ type: "userFillsByTime", user: addr, startTime, endTime }),
    hlPost<HlLedgerEntry[]>({ type: "userNonFundingLedgerUpdates", user: addr, startTime, endTime }),
  ]);

  // Reject partial results — a null from rate-limit/transient must not be cached as a
  // "zero activity" classification, which then masquerades as Held forever.
  if (!spot || !Array.isArray(fills) || !Array.isArray(ledger)) {
    throw new Error("hyperliquid returned partial/no data");
  }

  const hypeBalanceRow = spot.balances?.find(b => b.coin === "HYPE");
  const currentHypeBalance = hypeBalanceRow ? parseFloat(hypeBalanceRow.total) : 0;

  const allHypeSells: HlFill[] = fills.filter(f => HYPE_SPOT_COINS.has(f.coin) && f.side === "A");

  // Only pay the userTwapSliceFills cost if any HYPE sells appeared in the combined window.
  let twapTids: Set<number> = new Set();
  if (allHypeSells.length > 0) {
    const twapSlices = await hlPost<HlTwapSliceFill[]>({ type: "userTwapSliceFills", user: addr });
    if (!Array.isArray(twapSlices)) {
      throw new Error("hyperliquid twap slice fills failed");
    }
    twapTids = new Set<number>(
      twapSlices.map(s => s.fill?.tid).filter((t): t is number => typeof t === "number")
    );
  }

  const allHypeTransfers: HlLedgerEntry[] = ledger.filter(e =>
    e?.delta?.type === "spotTransfer" &&
    e.delta.token === "HYPE" &&
    typeof e.delta.user === "string" &&
    e.delta.user.toLowerCase() === addr
  );

  // Derive per-`since` activity by filtering the shared data to that entry's selected window.
  return sinces.map(since => {
    const windowEnd = Math.min(since + windowMs, now);
    const sells = allHypeSells.filter(f => f.time >= since && f.time <= windowEnd);

    let twapAmount = 0;
    let marketAmount = 0;
    for (const f of sells) {
      const sz = parseFloat(f.sz);
      if (!Number.isFinite(sz)) continue;
      if (twapTids.has(f.tid)) twapAmount += sz;
      else marketAmount += sz;
    }

    const transfers = allHypeTransfers.filter(e => e.time >= since && e.time <= windowEnd);
    const transferredOut = {
      totalAmount: transfers.reduce((s, e) => s + (parseFloat(e.delta.amount || "0") || 0), 0),
      transferCount: transfers.length,
      destinations: [...new Set(
        transfers.map(e => (e.delta.destination || "").toLowerCase()).filter(Boolean)
      )],
    };

    return {
      user: addr,
      since,
      windowHours,
      currentHypeBalance,
      soldOnHl: { twapAmount, marketAmount, fillCount: sells.length },
      transferredOut,
    };
  });
}

export async function POST(request: Request) {
  let body: unknown = null;
  try { body = await request.json(); } catch { /* malformed body → empty result */ }

  const parsed = body as { users?: Array<{ user: string; since: number }>; windowHours?: number; force?: boolean };
  const users = parsed?.users;
  if (!Array.isArray(users) || users.length === 0) {
    return NextResponse.json({ activities: [] });
  }
  const windowHours = clampWindowHours(parsed?.windowHours);
  const windowMs = windowHours * 60 * 60 * 1000;
  const force = parsed?.force === true;

  const now = Date.now();

  // Group requested (user, since) pairs by address, splitting into cached-hits and misses.
  // Cache key includes windowHours — same (addr, since) with a different window produces a
  // different classification (a 24h window may show "Untracked" while a 7d window catches the sale).
  const byAddr = new Map<string, { cached: WalletActivity[]; missing: number[] }>();
  for (const { user, since } of users) {
    if (typeof user !== "string" || typeof since !== "number") continue;
    const addr = user.toLowerCase();
    let bucket = byAddr.get(addr);
    if (!bucket) {
      bucket = { cached: [], missing: [] };
      byAddr.set(addr, bucket);
    }
    const cacheKey = `${addr}|${since}|${windowHours}`;
    const cached = cache.get(cacheKey);
    const elapsed = since + windowMs <= now;
    const ttl = elapsed ? ELAPSED_TTL_MS : ACTIVE_TTL_MS;
    // `force` skips the cache so the user's manual refresh always hits Hyperliquid.
    if (!force && cached && now - cached.timestamp < ttl) {
      bucket.cached.push(cached.data);
    } else {
      bucket.missing.push(since);
    }
  }

  // For each address with misses, do ONE combined window fetch and derive per-since.
  // Limit concurrent address fetches so we don't burst the Hyperliquid rate budget.
  const addrsWithMisses = [...byAddr.entries()].filter(([, b]) => b.missing.length > 0);
  const ADDR_CONCURRENCY = 10;
  const fresh: WalletActivity[] = [];
  for (let i = 0; i < addrsWithMisses.length; i += ADDR_CONCURRENCY) {
    const slice = addrsWithMisses.slice(i, i + ADDR_CONCURRENCY);
    const batchResults = await Promise.all(
      slice.map(async ([addr, bucket]) => {
        try {
          const activities = await classifyAddressWindow(addr, bucket.missing, windowMs, now);
          for (const a of activities) cache.set(`${addr}|${a.since}|${windowHours}`, { data: a, timestamp: now });
          return activities;
        } catch {
          return [] as WalletActivity[];
        }
      })
    );
    for (const arr of batchResults) fresh.push(...arr);
  }

  const all: WalletActivity[] = [];
  for (const [, bucket] of byAddr) all.push(...bucket.cached);
  all.push(...fresh);

  return NextResponse.json({ activities: all });
}
