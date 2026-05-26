"use client";
import { useEffect, useState, useRef, useCallback } from "react";

interface HypeUnstakingWidgetProps {
  refreshKey?: number;
  height?: number;
}

interface UnstakingEntry {
  initiatedTime: number;
  unlockTime: number;
  user: string;
  amountHype: number;
}

interface UnstakingData {
  entries: UnstakingEntry[];
  totalAmount: number;
  totalEntries: number;
}

interface WalletActivity {
  user: string;
  since: number;
  windowHours: number;
  currentHypeBalance: number;
  soldOnHl: { twapAmount: number; marketAmount: number; fillCount: number };
  transferredOut: { totalAmount: number; transferCount: number; destinations: string[] };
}

type BadgeVariant =
  | 'held'
  | 'sold-spot'
  | 'sold-twap'
  | 'transferred'
  | 'unaccounted';

interface Badge {
  label: string;
  variant: BadgeVariant;
}

interface Classification {
  badges: Badge[];
  keptPct: number;
  tooltip: string;
}

const HYPEREVM_BRIDGE_DEST = '0x2222222222222222222222222222222222222222';

function describeDestination(addr: string): string {
  if (addr.toLowerCase() === HYPEREVM_BRIDGE_DEST) return 'HyperEVM bridge';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function classify(activity: WalletActivity, stakedAmount: number): Classification {
  // Wallet balance may include HYPE from other unlocks or pre-existing holdings, so cap the
  // kept% display at 100 — otherwise an address with multiple unlocks shows misleading >100%.
  const rawKeptPct = stakedAmount > 0
    ? Math.round((activity.currentHypeBalance / stakedAmount) * 100)
    : 0;
  const keptPct = Math.min(rawKeptPct, 100);
  const twapAmount = activity.soldOnHl.twapAmount;
  const marketAmount = activity.soldOnHl.marketAmount;
  const transferred = activity.transferredOut.totalAmount;
  // Cap action %s at 100 — a wallet may transfer or sell more than THIS entry's stake
  // (e.g. multiple unlocks landing in the same wallet, then bridging the whole pile),
  // which would otherwise produce confusing "Transferred 126%" badges.
  const twapPct = stakedAmount > 0 ? Math.min(100, Math.round((twapAmount / stakedAmount) * 100)) : 0;
  const marketPct = stakedAmount > 0 ? Math.min(100, Math.round((marketAmount / stakedAmount) * 100)) : 0;
  const transferredPct = stakedAmount > 0 ? Math.min(100, Math.round((transferred / stakedAmount) * 100)) : 0;
  const anyDetected = twapPct > 0 || marketPct > 0 || transferredPct > 0;
  const windowHours = activity.windowHours;
  const windowLabel = windowHours % 24 === 0 ? `${windowHours / 24}d` : `${windowHours}h`;

  const tooltipLines: string[] = [];
  if (twapAmount > 0) {
    tooltipLines.push(`TWAP sold: ${twapAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} HYPE (${twapPct}%)`);
  }
  if (marketAmount > 0) {
    tooltipLines.push(`Spot sold: ${marketAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })} HYPE (${marketPct}%)`);
  }
  if (twapAmount + marketAmount > 0) {
    tooltipLines.push(`Across ${activity.soldOnHl.fillCount} fill${activity.soldOnHl.fillCount === 1 ? '' : 's'}`);
  }
  if (transferred > 0) {
    tooltipLines.push(`Transferred: ${transferred.toLocaleString('en-US', { maximumFractionDigits: 0 })} HYPE (${transferredPct}%)`);
    const dests = activity.transferredOut.destinations.slice(0, 3).map(describeDestination);
    if (dests.length > 0) tooltipLines.push(`To: ${dests.join(', ')}`);
  }
  tooltipLines.push(`In wallet: ${activity.currentHypeBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })} HYPE (${keptPct}%)`);
  if (!anyDetected && keptPct < 95) {
    const unaccounted = Math.max(0, 100 - keptPct);
    tooltipLines.push(`Unaccounted: ~${unaccounted}% — no sells/transfers detected in this window. Likely acted >${windowLabel} after unlock, or moved via HyperEVM (we only track HyperCore spot transfers).`);
  }
  tooltipLines.push(`Window: ${windowLabel} after unlock`);
  const tooltip = tooltipLines.join('\n');

  // Only emit badges for the actions (sold/transferred/unaccounted). The kept% is shown
  // as a fixed row label next to the amount, so a Kept badge here is redundant.
  const badges: Badge[] = [];
  if (marketPct > 0) badges.push({ label: `Sold (Spot) ${marketPct}%`, variant: 'sold-spot' });
  if (twapPct > 0) badges.push({ label: `Sold (TWAP) ${twapPct}%`, variant: 'sold-twap' });
  if (transferredPct > 0) badges.push({ label: `Transferred ${transferredPct}%`, variant: 'transferred' });
  if (!anyDetected && keptPct < 95) {
    const unaccounted = Math.max(0, 100 - keptPct);
    if (unaccounted >= 5) {
      badges.push({ label: `Unaccounted ${unaccounted}%`, variant: 'unaccounted' });
    }
  }

  return { badges, keptPct, tooltip };
}

function getBadgeClasses(variant: BadgeVariant): string {
  switch (variant) {
    case 'held':        return 'bg-green-500/20 text-green-300 ring-green-500/30';
    case 'sold-spot':   return 'bg-red-500/20 text-red-300 ring-red-500/30';
    case 'sold-twap':   return 'bg-orange-500/20 text-orange-300 ring-orange-500/30';
    case 'transferred': return 'bg-blue-500/20 text-blue-300 ring-blue-500/30';
    case 'unaccounted': return 'bg-zinc-500/20 text-zinc-300 ring-zinc-500/30';
  }
}

function getKeptTextColor(pct: number, theme: "dark" | "light"): string {
  if (pct >= 95) return theme === "dark" ? "text-emerald-400" : "text-emerald-600";
  if (pct >= 70) return theme === "dark" ? "text-emerald-400" : "text-emerald-600";
  if (pct >= 30) return theme === "dark" ? "text-yellow-400" : "text-yellow-600";
  return theme === "dark" ? "text-rose-400" : "text-rose-600";
}

function useSystemTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return theme;
}

function formatTimeRemaining(unlockTimeMs: number, now: number): string {
  const diff = unlockTimeMs - now;
  if (diff <= 0) {
    const ago = Math.abs(diff);
    const days = Math.floor(ago / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ago % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ago % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 0) return `${days}d ${hours}h ago`;
    if (hours > 0) return `${hours}h ${minutes}m ago`;
    return `${minutes}m ago`;
  }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatHypeAmount(amount: number): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function truncateAddress(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function getAmountColorClass(amount: number): string {
  if (amount >= 100_000) return "text-red-500";
  if (amount >= 10_000) return "text-orange-500";
  if (amount >= 1_000) return "text-yellow-500";
  return "text-green-500";
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

const LOOKBACK_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;
type LookbackDays = typeof LOOKBACK_OPTIONS[number];

const MIN_HYPE_FOR_CLASSIFICATION = 100;

type SizeFilter = 'all' | 'small' | 'medium' | 'large' | 'whale';

const SIZE_FILTERS: { key: SizeFilter; label: string; colorClass: string; min: number; max: number }[] = [
  { key: 'all', label: 'All', colorClass: '', min: 0, max: Infinity },
  { key: 'small', label: '<1K', colorClass: 'text-green-500', min: 0, max: 1_000 },
  { key: 'medium', label: '1K-10K', colorClass: 'text-yellow-500', min: 1_000, max: 10_000 },
  { key: 'large', label: '10K-100K', colorClass: 'text-orange-500', min: 10_000, max: 100_000 },
  { key: 'whale', label: '100K+', colorClass: 'text-red-500', min: 100_000, max: Infinity },
];

export default function HypeUnstakingWidget({ refreshKey = 0, height = 350 }: HypeUnstakingWidgetProps) {
  const [data, setData] = useState<UnstakingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>('all');
  const [lookbackDays, setLookbackDays] = useState<LookbackDays>(1);
  const [postUnlockDays, setPostUnlockDaysRaw] = useState<LookbackDays>(1);
  const [hypePrice, setHypePrice] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [walletActivity, setWalletActivity] = useState<Record<string, WalletActivity>>({});
  const [checkingKeys, setCheckingKeys] = useState<Set<string>>(new Set());
  const [checkAllProgress, setCheckAllProgress] = useState<{ done: number; total: number } | null>(null);

  // Changing the post-unlock window invalidates every cached classification (a different
  // window can flip a row from "Untracked" to "Sold"), so wipe local state on change.
  const setPostUnlockDays = useCallback((d: LookbackDays) => {
    setPostUnlockDaysRaw(d);
    setWalletActivity({});
  }, []);
  const periodicIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const dataRef = useRef<UnstakingData | null>(null);
  const theme = useSystemTheme();

  const fetchHypePrice = useCallback(async () => {
    try {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
      });
      if (!res.ok) return;
      const mids: Record<string, string> = await res.json();
      if (mids["HYPE"]) setHypePrice(parseFloat(mids["HYPE"]));
    } catch { /* silently ignore price fetch failures */ }
  }, []);

  // Fetch a batch of (user, since) entries; reports per-entry progress via callbacks.
  // Shared by per-row "Check", the bulk "Check all", and the manual "Refresh" path.
  const fetchActivityFor = useCallback(async (
    targets: Array<{ user: string; since: number }>,
    onChunk?: (delta: number) => void,
    force = false,
  ) => {
    if (targets.length === 0) return;
    const targetKeys = targets.map(t => `${t.user.toLowerCase()}|${t.since}`);
    setCheckingKeys(prev => {
      const nxt = new Set(prev);
      for (const k of targetKeys) nxt.add(k);
      return nxt;
    });
    try {
      const chunkSize = 20;
      const chunks: Array<Array<{ user: string; since: number }>> = [];
      for (let i = 0; i < targets.length; i += chunkSize) chunks.push(targets.slice(i, i + chunkSize));

      await Promise.all(chunks.map(async (chunk) => {
        try {
          const res = await fetch("/api/hyperliquid/wallet-activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ users: chunk, windowHours: postUnlockDays * 24, force }),
          });
          if (!res.ok) return;
          const json: { activities?: Array<WalletActivity & { since?: number }> } = await res.json();
          const chunkNext: Record<string, WalletActivity> = {};
          for (const a of json.activities ?? []) {
            const since = typeof a.since === "number" ? a.since : null;
            if (since === null) continue;
            chunkNext[`${a.user.toLowerCase()}|${since}`] = a;
          }
          if (Object.keys(chunkNext).length > 0) {
            setWalletActivity(prev => ({ ...prev, ...chunkNext }));
          }
        } catch { /* ignore network blips */ }
        onChunk?.(chunk.length);
      }));
    } finally {
      setCheckingKeys(prev => {
        const nxt = new Set(prev);
        for (const k of targetKeys) nxt.delete(k);
        return nxt;
      });
    }
  }, [postUnlockDays]);

  const checkOne = useCallback((user: string, since: number) => {
    void fetchActivityFor([{ user: user.toLowerCase(), since }]);
  }, [fetchActivityFor]);

  // Caller passes the visible entries — checkAll respects the active size filter
  // (otherwise clicking "Check all (12)" while on 100K+ would silently storm the server
  // with hundreds of off-screen entries and only a handful would land). `force=true`
  // bypasses the server cache so the user can manually re-fetch already-classified rows.
  const checkAll = useCallback(async (entries: UnstakingEntry[], opts?: { force?: boolean }) => {
    const force = opts?.force === true;
    const seen = new Set<string>();
    const targets: Array<{ user: string; since: number }> = [];
    for (const e of entries) {
      const addr = e.user.toLowerCase();
      const key = `${addr}|${e.unlockTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ user: addr, since: e.unlockTime });
    }
    if (targets.length === 0) return;

    setCheckAllProgress({ done: 0, total: targets.length });
    let done = 0;
    await fetchActivityFor(targets, (delta) => {
      done += delta;
      setCheckAllProgress({ done, total: targets.length });
    }, force);
    setCheckAllProgress(null);
  }, [fetchActivityFor]);

  // Advance the local clock + refresh HYPE price every 60s. The clock tick (`now`) also drives
  // the unstaking refetch below, keeping the snapshot fresh; activity is user-driven.
  useEffect(() => {
    fetchHypePrice();
    periodicIntervalRef.current = setInterval(() => {
      setNow(Date.now());
      fetchHypePrice();
    }, 60_000);
    return () => {
      if (periodicIntervalRef.current) clearInterval(periodicIntervalRef.current);
    };
  }, [fetchHypePrice]);

  // Initial load + refetch on manual refresh, lookback change, or the 60s clock tick (`now`), so
  // the lookback always filters fresh data instead of a frozen mount-time snapshot. A failed
  // background refresh keeps the last good rows rather than blanking to an error.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/hyperliquid/unstaking");
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json: UnstakingData = await res.json();
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (err) {
        // Keep the last good data on a background failure; only surface an error with nothing to show.
        if (cancelled || dataRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to fetch unstaking queue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshKey, lookbackDays, now]);

  // Keep dataRef in sync with the latest fetched data; activity fetches read from it.
  useEffect(() => {
    dataRef.current = data;
  }, [data]);


  const bgColor = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const textColor = theme === "dark" ? "text-gray-100" : "text-gray-900";
  const secondaryTextColor = theme === "dark" ? "text-gray-400" : "text-gray-600";
  const borderColor = theme === "dark" ? "border-zinc-700" : "border-gray-200";
  const headerBg = theme === "dark" ? "bg-zinc-800" : "bg-gray-50";
  const rowEvenBg = theme === "dark" ? "bg-zinc-800/50" : "bg-gray-50/50";
  const rowHoverBg = theme === "dark" ? "hover:bg-zinc-700/50" : "hover:bg-gray-100";
  const selectClasses = `text-[10px] font-medium rounded border px-1 py-0.5 outline-none ${
    theme === "dark"
      ? "bg-zinc-700 text-gray-200 border-zinc-600 hover:bg-zinc-600"
      : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
  }`;

  if (loading && !data) {
    return (
      <div className={`w-full h-full ${bgColor} flex items-center justify-center`} style={{ height }}>
        <div className={`${secondaryTextColor} text-sm`}>Loading unstaking queue...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={`w-full h-full ${bgColor} flex items-center justify-center`} style={{ height }}>
        <div className="text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  const activeFilter = SIZE_FILTERS.find(f => f.key === sizeFilter)!;
  const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
  const filteredEntries = data
    ? data.entries.filter(e =>
        e.amountHype >= activeFilter.min &&
        e.amountHype < activeFilter.max &&
        (e.unlockTime > now || now - e.unlockTime < lookbackMs)
      )
    : [];
  const filteredTotal = filteredEntries.reduce((sum, e) => sum + e.amountHype, 0);

  const checkableEntries = filteredEntries.filter(e =>
    e.unlockTime <= now && e.amountHype >= MIN_HYPE_FOR_CLASSIFICATION
  );
  const unclassifiedCheckable = checkableEntries.filter(e =>
    !walletActivity[`${e.user.toLowerCase()}|${e.unlockTime}`]
  );
  const checkAllRunning = checkAllProgress !== null;

  if (!data || data.entries.length === 0) {
    return (
      <div className={`w-full h-full ${bgColor} flex items-center justify-center`} style={{ height }}>
        <div className={`${secondaryTextColor} text-sm`}>No pending unstaking entries</div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full ${bgColor} ${textColor} flex flex-col`} style={{ height }}>
      {/* Header */}
      <div className={`px-4 py-2 border-b ${borderColor} ${headerBg} flex-shrink-0`}>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-sm font-semibold">HYPE Unstaking Queue</h3>
          <div className={`text-xs ${secondaryTextColor} flex gap-3`}>
            <span>{formatHypeAmount(filteredTotal)} HYPE</span>
            {hypePrice && <span>{formatUsd(filteredTotal * hypePrice)}</span>}
            <span>{filteredEntries.length}{sizeFilter !== 'all' ? ` / ${data.totalEntries}` : ''} entries</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`flex items-center gap-1 text-[10px] ${secondaryTextColor}`}>
            Size
            <select
              value={sizeFilter}
              onChange={e => setSizeFilter(e.target.value as SizeFilter)}
              className={selectClasses}
            >
              {SIZE_FILTERS.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className={`flex items-center gap-1 text-[10px] ${secondaryTextColor}`}>
            History
            <select
              value={lookbackDays}
              onChange={e => setLookbackDays(Number(e.target.value) as LookbackDays)}
              className={selectClasses}
            >
              {LOOKBACK_OPTIONS.map(d => (
                <option key={d} value={d}>{d}d</option>
              ))}
            </select>
          </label>
          <label
            className={`flex items-center gap-1 text-[10px] ${secondaryTextColor}`}
            title="Time window after each entry's unlock to classify activity in"
          >
            Window
            <select
              value={postUnlockDays}
              onChange={e => setPostUnlockDays(Number(e.target.value) as LookbackDays)}
              className={selectClasses}
            >
              {LOOKBACK_OPTIONS.map(d => (
                <option key={d} value={d}>{d}d</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              if (unclassifiedCheckable.length > 0) void checkAll(unclassifiedCheckable);
              else void checkAll(checkableEntries, { force: true });
            }}
            disabled={checkAllRunning || checkableEntries.length === 0}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              checkAllRunning || checkableEntries.length === 0
                ? `${theme === 'dark' ? 'bg-zinc-700 text-gray-500' : 'bg-gray-200 text-gray-400'} cursor-not-allowed`
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
            title={
              unclassifiedCheckable.length > 0
                ? `Classify ${unclassifiedCheckable.length} unclassified entries (${postUnlockDays}d window)`
                : `Re-fetch all ${checkableEntries.length} classified entries from Hyperliquid (bypasses cache)`
            }
          >
            {checkAllRunning
              ? `Checking ${checkAllProgress!.done}/${checkAllProgress!.total}…`
              : unclassifiedCheckable.length > 0
                ? `Check all (${unclassifiedCheckable.length})`
                : `Refresh (${checkableEntries.length})`}
          </button>
        </div>
      </div>

      {/* Table Header */}
      <div className={`grid grid-cols-[0.7fr_0.9fr_0.65fr_0.4fr_1.65fr_0.85fr] px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider ${secondaryTextColor} border-b ${borderColor} flex-shrink-0`}>
        <span>Unlocks In</span>
        <span>Amount (HYPE)</span>
        <span>USDC</span>
        <span>Kept</span>
        <span>Action</span>
        <span className="text-right">Address</span>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredEntries.length === 0 && (
          <div className={`flex items-center justify-center py-8 ${secondaryTextColor} text-sm`}>
            No entries in this size bracket
          </div>
        )}
        {filteredEntries.map((entry, idx) => {
          const addr = entry.user.toLowerCase();
          const compositeKey = `${addr}|${entry.unlockTime}`;
          const activity = walletActivity[compositeKey];
          const tooSmall = entry.amountHype < MIN_HYPE_FOR_CLASSIFICATION;
          const isChecking = checkingKeys.has(compositeKey);
          const showAction = entry.unlockTime <= now && activity !== undefined;
          const classification = showAction ? classify(activity, entry.amountHype) : null;
          const canCheck = entry.unlockTime <= now && !tooSmall && !classification && !isChecking;
          return (
          <div
            key={`${entry.user}-${entry.initiatedTime}-${idx}`}
            className={`grid grid-cols-[0.7fr_0.9fr_0.65fr_0.4fr_1.65fr_0.85fr] px-4 py-1.5 text-xs ${idx % 2 === 0 ? rowEvenBg : ""} ${rowHoverBg} transition-colors`}
          >
            <span className={entry.unlockTime <= now ? "text-green-400" : ""}>
              {formatTimeRemaining(entry.unlockTime, now)}
            </span>
            <span className={`font-mono ${getAmountColorClass(entry.amountHype)}`}>
              {formatHypeAmount(entry.amountHype)}
            </span>
            <span className={`font-mono ${secondaryTextColor}`}>
              {hypePrice ? formatUsd(entry.amountHype * hypePrice) : "—"}
            </span>
            <span
              className={`font-mono text-[11px] ${classification ? getKeptTextColor(classification.keptPct, theme) : secondaryTextColor}`}
              title={classification ? `${classification.keptPct}% of unstaked HYPE still in spot wallet` : undefined}
            >
              {classification ? `${classification.keptPct}%` : '—'}
            </span>
            <span>
              {classification ? (
                <span className="flex flex-wrap items-center gap-1 cursor-help" title={classification.tooltip}>
                  {classification.badges.map((b, i) => (
                    <span
                      key={i}
                      className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${getBadgeClasses(b.variant)}`}
                    >
                      {b.label}
                    </span>
                  ))}
                </span>
              ) : isChecking ? (
                <span className={`text-[10px] ${secondaryTextColor}`}>checking…</span>
              ) : canCheck ? (
                <button
                  onClick={() => checkOne(entry.user, entry.unlockTime)}
                  className={`text-[10px] px-1.5 py-0.5 rounded ring-1 transition-colors ${
                    theme === 'dark'
                      ? 'bg-zinc-700 hover:bg-zinc-600 text-gray-200 ring-zinc-600'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700 ring-gray-300'
                  }`}
                >
                  Check
                </button>
              ) : (
                <span className={`text-[10px] ${secondaryTextColor}`}>
                  {entry.unlockTime > now ? "—" : tooSmall ? "dust" : "—"}
                </span>
              )}
            </span>
            <span className="text-right">
              <a
                href={`https://hypurrscan.io/address/${entry.user}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 hover:underline"
              >
                {truncateAddress(entry.user)}
              </a>
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
}
