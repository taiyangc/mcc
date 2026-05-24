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
  currentHypeBalance: number;
  soldOnHl: { twapAmount: number; marketAmount: number; fillCount: number };
  transferredOut: { totalAmount: number; transferCount: number; destinations: string[] };
}

type BadgeVariant =
  | 'held'
  | 'sold-spot'
  | 'sold-twap'
  | 'transferred'
  | 'unaccounted'
  | 'kept-high'
  | 'kept-mid'
  | 'kept-low';

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
  const twapPct = stakedAmount > 0 ? Math.round((twapAmount / stakedAmount) * 100) : 0;
  const marketPct = stakedAmount > 0 ? Math.round((marketAmount / stakedAmount) * 100) : 0;
  const transferredPct = stakedAmount > 0 ? Math.round((transferred / stakedAmount) * 100) : 0;
  const anyDetected = twapPct > 0 || marketPct > 0 || transferredPct > 0;

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
    tooltipLines.push(`Unaccounted: ~${unaccounted}% — no sells/transfers detected in this window. Likely acted >24h after unlock, or moved via HyperEVM (we only track HyperCore spot transfers).`);
  }
  tooltipLines.push(`Window: 24h after unlock`);
  const tooltip = tooltipLines.join('\n');

  // Build one badge per detected action; suffix with a kept% badge. The "Held" case
  // collapses to a single badge so the common 100%-kept row stays uncluttered.
  const badges: Badge[] = [];

  if (!anyDetected && keptPct >= 95) {
    badges.push({ label: `Held ${keptPct}%`, variant: 'held' });
    return { badges, keptPct, tooltip };
  }

  if (marketPct > 0) badges.push({ label: `Sold (Spot) ${marketPct}%`, variant: 'sold-spot' });
  if (twapPct > 0) badges.push({ label: `Sold (TWAP) ${twapPct}%`, variant: 'sold-twap' });
  if (transferredPct > 0) badges.push({ label: `Transferred ${transferredPct}%`, variant: 'transferred' });

  if (!anyDetected) {
    const unaccounted = Math.max(0, 100 - keptPct);
    if (unaccounted >= 5) {
      badges.push({ label: `Unaccounted ${unaccounted}%`, variant: 'unaccounted' });
    }
  }

  // Kept always appears alongside actions so user sees both halves of the picture.
  const keptVariant: BadgeVariant =
    keptPct >= 70 ? 'kept-high' :
    keptPct >= 30 ? 'kept-mid' :
    'kept-low';
  badges.push({ label: `Kept ${keptPct}%`, variant: keptVariant });

  return { badges, keptPct, tooltip };
}

function getBadgeClasses(variant: BadgeVariant): string {
  switch (variant) {
    case 'held':        return 'bg-green-500/20 text-green-300 ring-green-500/30';
    case 'sold-spot':   return 'bg-red-500/20 text-red-300 ring-red-500/30';
    case 'sold-twap':   return 'bg-orange-500/20 text-orange-300 ring-orange-500/30';
    case 'transferred': return 'bg-blue-500/20 text-blue-300 ring-blue-500/30';
    case 'unaccounted': return 'bg-zinc-500/20 text-zinc-300 ring-zinc-500/30';
    case 'kept-high':   return 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/30';
    case 'kept-mid':    return 'bg-yellow-500/20 text-yellow-300 ring-yellow-500/30';
    case 'kept-low':    return 'bg-rose-500/20 text-rose-300 ring-rose-500/30';
  }
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
    if (days > 0) return `Unlocked ${days}d ${hours}h ago`;
    if (hours > 0) return `Unlocked ${hours}h ${minutes}m ago`;
    return `Unlocked ${minutes}m ago`;
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
  const [hypePrice, setHypePrice] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [walletActivity, setWalletActivity] = useState<Record<string, WalletActivity>>({});
  const [checkingKeys, setCheckingKeys] = useState<Set<string>>(new Set());
  const [checkAllProgress, setCheckAllProgress] = useState<{ done: number; total: number } | null>(null);
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
  // Shared by per-row "Check" and the "Check all" bulk action.
  const fetchActivityFor = useCallback(async (
    targets: Array<{ user: string; since: number }>,
    onChunk?: (delta: number) => void,
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
            body: JSON.stringify({ users: chunk }),
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
  }, []);

  const checkOne = useCallback((user: string, since: number) => {
    void fetchActivityFor([{ user: user.toLowerCase(), since }]);
  }, [fetchActivityFor]);

  // Caller passes the visible unclassified entries — checkAll respects the active size
  // filter (otherwise clicking "Check all (12)" while on 100K+ would silently storm the
  // server with hundreds of off-screen entries and only a handful would land).
  const checkAll = useCallback(async (entries: UnstakingEntry[]) => {
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
    });
    setCheckAllProgress(null);
  }, [fetchActivityFor]);

  // Refresh HYPE price + the local time tick every 60s; activity is user-driven now.
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

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/hyperliquid/unstaking");
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch unstaking queue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [refreshKey]);

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

  if (loading) {
    return (
      <div className={`w-full h-full ${bgColor} flex items-center justify-center`} style={{ height }}>
        <div className={`${secondaryTextColor} text-sm`}>Loading unstaking queue...</div>
      </div>
    );
  }

  if (error) {
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
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {SIZE_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setSizeFilter(f.key)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  sizeFilter === f.key
                    ? 'bg-blue-600 text-white'
                    : `${theme === 'dark' ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-gray-200 hover:bg-gray-300'} ${f.colorClass || (theme === 'dark' ? 'text-gray-300' : 'text-gray-700')}`
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className={`flex items-center gap-1 border-l ${borderColor} pl-3`}>
            <span className={`text-[10px] ${secondaryTextColor}`}>History:</span>
            {LOOKBACK_OPTIONS.map(d => (
              <button
                key={d}
                onClick={() => setLookbackDays(d)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  lookbackDays === d
                    ? 'bg-blue-600 text-white'
                    : `${theme === 'dark' ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-gray-200 hover:bg-gray-300'} ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <div className={`flex items-center gap-1 border-l ${borderColor} pl-3`}>
            <button
              onClick={() => { void checkAll(unclassifiedCheckable); }}
              disabled={checkAllRunning || unclassifiedCheckable.length === 0}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                checkAllRunning || unclassifiedCheckable.length === 0
                  ? `${theme === 'dark' ? 'bg-zinc-700 text-gray-500' : 'bg-gray-200 text-gray-400'} cursor-not-allowed`
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
              title="Classify post-unlock action for all visible unlocked entries >= 100 HYPE"
            >
              {checkAllRunning
                ? `Checking ${checkAllProgress!.done}/${checkAllProgress!.total}…`
                : unclassifiedCheckable.length > 0
                  ? `Check all (${unclassifiedCheckable.length})`
                  : 'Check all'}
            </button>
          </div>
        </div>
      </div>

      {/* Table Header */}
      <div className={`grid grid-cols-[0.9fr_0.9fr_0.8fr_2fr_1fr] px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider ${secondaryTextColor} border-b ${borderColor} flex-shrink-0`}>
        <span>Unlocks In</span>
        <span>Amount (HYPE)</span>
        <span>USDC</span>
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
            className={`grid grid-cols-[0.9fr_0.9fr_0.8fr_2fr_1fr] px-4 py-1.5 text-xs ${idx % 2 === 0 ? rowEvenBg : ""} ${rowHoverBg} transition-colors`}
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
