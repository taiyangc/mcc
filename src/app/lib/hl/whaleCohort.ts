// The tracked-trader cohort: one server-side job that powers the long/short split, the
// margin panel, the biggest-position and position-change feeds, and the per-market ratios.
//
// Hyperliquid has no aggregate positioning endpoint, so the cohort is assembled from the
// public leaderboard (ranked by 24h volume and 30d PnL, never by the stale accountValue
// field) plus addresses seen trading size, and each member's clearinghouseState is polled.
// Everything the panels need is derived from that one pass.

import {
  hlInfo,
  mapWithConcurrency,
  reserveWeight,
  remainingWeight,
  RingBuffer,
  RateLimitError,
  WEIGHT_CHEAP,
  HL_LEADERBOARD_URL,
} from "./client";
import {
  aggregateAllCohorts,
  diffPositions,
  indexPositions,
  largestPositions,
} from "./aggregate";
import type {
  AccountSnapshot,
  CohortKey,
  CohortStats,
  CohortTag,
  LargestPosition,
  PositionChange,
  PositionIndex,
} from "./aggregate";
import type { HlClearinghouseState, HlLeaderboard, HlLeaderboardRow } from "./types";

const CYCLE_INTERVAL_MS = 60_000;
const CYCLE_DEADLINE_MS = 30_000;
const LEADERBOARD_TTL_MS = 30 * 60_000;
const RANK_SIZE = 100;
const WHALE_CAP = 100;
const WHALE_MIN_NOTIONAL = 1_000_000;
/** Addresses ranked below the top 100 that are probed a few at a time each cycle. */
const DISCOVERY_POOL_SIZE = 900;
const DISCOVERY_PER_CYCLE = 25;
const BASE_CONCURRENCY = 20;
const SERIES_CAPACITY = 1440;
const CHANGES_CAPACITY = 500;
const MAX_COHORT_SIZE = 325;

export interface CohortSample {
  t: number;
  longUsd: number;
  shortUsd: number;
  marginUsed: number;
  accountValue: number;
}

export interface WhaleSnapshot {
  warming: boolean;
  updatedAt: number;
  cohortSize: number;
  rateLimited: boolean;
  /** Why the last cycle failed, if it did. Panels surface this instead of silently staling. */
  lastError: string | null;
  cohorts: Record<CohortKey, CohortStats>;
  positions: LargestPosition[];
  changes: PositionChange[];
  series: CohortSample[];
}

interface CohortState {
  /** Candidate addresses by tag, refreshed from the leaderboard. */
  ranked: { vol: string[]; pnl: string[] };
  rankedAt: number;
  leaderboardInFlight: Promise<void> | null;
  whales: Set<string>;
  /** Deeper leaderboard ranks, probed in rotation to find size the top 100 misses. */
  discoveryPool: string[];
  discoveryCursor: number;
  accounts: Map<string, AccountSnapshot>;
  previousIndex: PositionIndex;
  series: RingBuffer<CohortSample>;
  changes: RingBuffer<PositionChange>;
  snapshot: WhaleSnapshot | null;
  cycleStartedAt: number;
  inFlight: Promise<WhaleSnapshot> | null;
  penaltyCycles: number;
  lastError: string | null;
}

const STATE_KEY = "__mccHlCohort_v1";

function defaultState(): CohortState {
  return {
    ranked: { vol: [], pnl: [] },
    rankedAt: 0,
    leaderboardInFlight: null,
    whales: new Set(),
    discoveryPool: [],
    discoveryCursor: 0,
    accounts: new Map(),
    previousIndex: new Map(),
    series: new RingBuffer<CohortSample>(SERIES_CAPACITY),
    changes: new RingBuffer<PositionChange>(CHANGES_CAPACITY),
    snapshot: null,
    cycleStartedAt: 0,
    inFlight: null,
    penaltyCycles: 0,
    lastError: null,
  };
}

/**
 * The job's state lives on globalThis so a dev reload keeps the warm cohort instead of
 * refetching the leaderboard. Because a reload can bring new fields, missing keys are
 * backfilled from the defaults rather than assuming an existing object is complete.
 */
function state(): CohortState {
  const g = globalThis as unknown as Record<string, CohortState | undefined>;
  const defaults = defaultState();
  const current = g[STATE_KEY];
  if (!current) {
    g[STATE_KEY] = defaults;
    return defaults;
  }
  const target = current as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) target[key] = value;
  }
  return current;
}

function num(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function windowValue(row: HlLeaderboardRow, window: string, field: "pnl" | "vlm"): number {
  const entry = row.windowPerformances.find(w => w[0] === window);
  return entry ? num(entry[1][field]) : 0;
}

/**
 * Refresh the ranked candidate lists from the public leaderboard.
 *
 * The response is ~37MB, so it is parsed once and immediately reduced to two lists of
 * addresses; nothing else is retained. Ranking uses 24h volume and 30d PnL because the
 * row-level accountValue is a stale snapshot whose top entries are empty accounts.
 */
async function refreshLeaderboard(): Promise<void> {
  const s = state();
  if (Date.now() - s.rankedAt < LEADERBOARD_TTL_MS && s.ranked.vol.length > 0) return;
  if (s.leaderboardInFlight) return s.leaderboardInFlight;

  s.leaderboardInFlight = (async () => {
    try {
      const res = await fetch(HL_LEADERBOARD_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) return;
      const data = (await res.json()) as HlLeaderboard;
      const rows = data?.leaderboardRows;
      if (!Array.isArray(rows) || rows.length === 0) return;

      const rankedByVolume = rows
        .map(row => ({ addr: row.ethAddress, score: windowValue(row, "day", "vlm") }))
        .filter(r => r.addr && r.score > 0)
        .sort((a, b) => b.score - a.score);

      const byVolume = rankedByVolume.slice(0, RANK_SIZE).map(r => r.addr.toLowerCase());
      const pool = rankedByVolume
        .slice(RANK_SIZE, RANK_SIZE + DISCOVERY_POOL_SIZE)
        .map(r => r.addr.toLowerCase());

      const byPnl = rows
        .map(row => ({ addr: row.ethAddress, score: windowValue(row, "month", "pnl") }))
        .filter(r => r.addr && r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, RANK_SIZE)
        .map(r => r.addr.toLowerCase());

      s.ranked = { vol: byVolume, pnl: byPnl };
      s.discoveryPool = pool;
      if (s.discoveryCursor >= pool.length) s.discoveryCursor = 0;
      s.rankedAt = Date.now();
    } catch {
      // Keep whatever ranking we already have; the cycle can run without a refresh.
    } finally {
      s.leaderboardInFlight = null;
    }
  })();

  return s.leaderboardInFlight;
}

interface CohortMember {
  addr: string;
  tags: CohortTag[];
}

/** Take the next `DISCOVERY_PER_CYCLE` addresses from the pool, wrapping at the end. */
function nextDiscoverySlice(s: CohortState): string[] {
  const pool = s.discoveryPool;
  if (pool.length === 0) return [];
  const slice: string[] = [];
  for (let i = 0; i < Math.min(DISCOVERY_PER_CYCLE, pool.length); i++) {
    slice.push(pool[(s.discoveryCursor + i) % pool.length]);
  }
  s.discoveryCursor = (s.discoveryCursor + slice.length) % pool.length;
  return slice;
}

function buildCohort(s: CohortState, includeDiscovery: boolean): CohortMember[] {
  const tags = new Map<string, Set<CohortTag>>();
  const add = (addr: string, tag: CohortTag) => {
    const key = addr.toLowerCase();
    let set = tags.get(key);
    if (!set) {
      set = new Set<CohortTag>();
      tags.set(key, set);
    }
    set.add(tag);
  };

  for (const addr of s.ranked.vol) add(addr, "VOL");
  for (const addr of s.ranked.pnl) add(addr, "PNL");
  for (const addr of s.whales) add(addr, "WHALE");

  // Discovery probes are untagged until a cycle proves they hold size, at which point
  // the whale rule keeps them. The cursor advances so the pool is swept over time.
  if (includeDiscovery) {
    for (const addr of nextDiscoverySlice(s)) {
      if (!tags.has(addr)) tags.set(addr, new Set());
    }
  }

  const members = Array.from(tags.entries()).map(([addr, set]) => ({
    addr,
    tags: Array.from(set),
  }));

  // Ranked members first so the cap drops discovery probes, not the core cohort.
  members.sort((a, b) => b.tags.length - a.tags.length);
  return members.slice(0, MAX_COHORT_SIZE);
}

function toSnapshot(
  member: CohortMember,
  chState: HlClearinghouseState,
  now: number,
): AccountSnapshot {
  const positions = chState.assetPositions
    .map(ap => ap.position)
    .filter(p => p && num(p.szi) !== 0)
    .map(p => ({
      coin: p.coin,
      szi: num(p.szi),
      positionValue: num(p.positionValue),
      marginUsed: num(p.marginUsed),
      entryPx: p.entryPx !== null ? num(p.entryPx) : null,
      liquidationPx: p.liquidationPx !== null ? num(p.liquidationPx) : null,
      leverage: p.leverage?.value ?? 0,
      unrealizedPnl: num(p.unrealizedPnl),
    }));

  return {
    user: member.addr,
    tags: member.tags,
    accountValue: num(chState.marginSummary?.accountValue),
    totalMarginUsed: num(chState.marginSummary?.totalMarginUsed),
    positions,
    updatedAt: now,
  };
}

function buildSnapshot(s: CohortState, now: number, rateLimited: boolean): WhaleSnapshot {
  const accounts = Array.from(s.accounts.values());
  const cohorts = aggregateAllCohorts(accounts);
  const all = cohorts.ALL;

  const lastSample = s.series.last();
  if (!lastSample || now - lastSample.t >= CYCLE_INTERVAL_MS - 5_000) {
    s.series.push({
      t: now,
      longUsd: all.longUsd,
      shortUsd: all.shortUsd,
      marginUsed: all.marginUsed,
      accountValue: all.accountValue,
    });
  }

  return {
    warming: accounts.length === 0,
    updatedAt: now,
    cohortSize: accounts.length,
    rateLimited,
    lastError: s.lastError,
    cohorts,
    positions: largestPositions(accounts, 100),
    // Newest cycle first, and biggest move first within a cycle (all of one cycle's
    // changes share a timestamp, so a stable sort by size then time gives both).
    changes: s.changes.toArray().sort((a, b) => b.t - a.t || b.magnitude - a.magnitude),
    series: s.series.toArray(),
  };
}

async function runCycle(): Promise<WhaleSnapshot> {
  const s = state();
  const now = Date.now();
  s.cycleStartedAt = now;

  await refreshLeaderboard();

  const penalised = s.penaltyCycles > 0;
  if (penalised) s.penaltyCycles -= 1;

  const members = buildCohort(s, !penalised);
  // Never start a pass we cannot pay for; drop the tail rather than get 429'd mid-cycle.
  const affordable = Math.floor(remainingWeight() / WEIGHT_CHEAP);
  const batch = members.slice(0, Math.max(0, Math.min(members.length, affordable)));
  const concurrency = penalised ? Math.ceil(BASE_CONCURRENCY / 2) : BASE_CONCURRENCY;

  let rateLimited = false;
  const results = await mapWithConcurrency(batch, concurrency, async member => {
    try {
      const chState = await hlInfo<HlClearinghouseState>(
        { type: "clearinghouseState", user: member.addr },
        { weight: WEIGHT_CHEAP, timeoutMs: 6000 },
      );
      return { member, chState };
    } catch (err) {
      if (err instanceof RateLimitError) rateLimited = true;
      return { member, chState: null };
    }
  });

  if (rateLimited) s.penaltyCycles = 5;

  const nextAccounts = new Map<string, AccountSnapshot>();
  for (const { member, chState } of results) {
    if (chState && chState.marginSummary) {
      nextAccounts.set(member.addr, toSnapshot(member, chState, now));
    } else {
      // A failed fetch keeps the previous snapshot: treating it as flat would
      // register a phantom close and skew the aggregates toward zero.
      const previous = s.accounts.get(member.addr);
      if (previous) nextAccounts.set(member.addr, { ...previous, tags: member.tags });
    }
  }

  // Tag whales from the positions just fetched, not from last cycle's set, so the
  // cohort is populated on the very first pass instead of staying empty until the second.
  const byNotional = Array.from(nextAccounts.values())
    .map(a => ({
      user: a.user,
      notional: a.positions.reduce((sum, p) => sum + Math.abs(p.positionValue), 0),
    }))
    .filter(a => a.notional >= WHALE_MIN_NOTIONAL)
    .sort((a, b) => b.notional - a.notional)
    .slice(0, WHALE_CAP);
  // Anyone holding size stays tracked next cycle even if they leave the rankings.
  s.whales = new Set(byNotional.map(w => w.user));
  for (const account of nextAccounts.values()) {
    const isWhale = s.whales.has(account.user);
    const hasTag = account.tags.includes("WHALE");
    if (isWhale && !hasTag) account.tags = [...account.tags, "WHALE"];
    else if (!isWhale && hasTag) account.tags = account.tags.filter(t => t !== "WHALE");
  }

  const accountList = Array.from(nextAccounts.values());

  if (s.previousIndex.size > 0) {
    // s.accounts is still last cycle's map here, so its keys are exactly the addresses
    // that were read before this pass — the ones whose positions can be diffed.
    const changes = diffPositions(s.previousIndex, accountList, now, new Set(s.accounts.keys()));
    s.changes.pushMany(changes);
  }
  s.previousIndex = indexPositions(accountList);
  s.accounts = nextAccounts;

  s.lastError = null;
  const snapshot = buildSnapshot(s, now, rateLimited);
  s.snapshot = snapshot;
  return snapshot;
}

/** A stale snapshot still reports the current failure state, not the one it was built with. */
function withStatus(s: CohortState, snapshot: WhaleSnapshot): WhaleSnapshot {
  if (snapshot.lastError === s.lastError) return snapshot;
  return { ...snapshot, lastError: s.lastError };
}

function emptySnapshot(): WhaleSnapshot {
  const s = state();
  return buildSnapshot(s, Date.now(), false);
}

/**
 * Current cohort snapshot.
 *
 * Cycles are request-driven: nothing runs while the dashboard is closed. A stale
 * snapshot is served immediately while a refresh runs in the background, so a panel
 * never blocks on the multi-second pass.
 */
export async function getWhaleSnapshot(): Promise<WhaleSnapshot> {
  const s = state();
  const now = Date.now();
  const due = now - s.cycleStartedAt >= CYCLE_INTERVAL_MS;

  if (!due) return withStatus(s, s.snapshot ?? emptySnapshot());

  if (!s.inFlight) {
    const cycle = runCycle();
    // A hung upstream call must not wedge every later request behind this promise.
    const guarded = Promise.race([
      cycle,
      new Promise<WhaleSnapshot>((_, reject) =>
        setTimeout(() => reject(new Error("cycle deadline exceeded")), CYCLE_DEADLINE_MS).unref?.(),
      ),
    ]).finally(() => {
      s.inFlight = null;
    });
    s.inFlight = guarded;
    // Record and swallow: a failed cycle must not reject every request awaiting it.
    guarded.catch((err: unknown) => {
      s.lastError = err instanceof Error ? err.message : String(err);
    });
  }

  if (s.snapshot) return withStatus(s, s.snapshot);

  try {
    return withStatus(s, await s.inFlight);
  } catch {
    return withStatus(s, emptySnapshot());
  }
}

/** Reserve the weight a full cycle would spend, for callers that want to pre-check. */
export function canAffordCycle(size: number): boolean {
  return reserveWeight(0) && remainingWeight() >= size * WEIGHT_CHEAP;
}
