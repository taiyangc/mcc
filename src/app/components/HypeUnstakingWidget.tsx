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

function getRetentionClasses(pct: number): string {
  if (pct >= 80) return "bg-green-500/20 text-green-300 ring-green-500/30";
  if (pct >= 30) return "bg-yellow-500/20 text-yellow-300 ring-yellow-500/30";
  return "bg-red-500/20 text-red-300 ring-red-500/30";
}

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
  const [now, setNow] = useState(Date.now());
  const [walletBalances, setWalletBalances] = useState<Record<string, number>>({});
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

  const fetchWalletBalances = useCallback(async () => {
    const currentData = dataRef.current;
    if (!currentData) return;
    const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
    const unlockedAddresses = [...new Set(
      currentData.entries
        .filter(e => e.unlockTime <= Date.now() && Date.now() - e.unlockTime < lookbackMs)
        .map(e => e.user.toLowerCase())
    )];
    if (unlockedAddresses.length === 0) return;
    const balances: Record<string, number> = {};
    const batchSize = 20;
    for (let i = 0; i < unlockedAddresses.length; i += batchSize) {
      const batch = unlockedAddresses.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (addr) => {
          try {
            const res = await fetch("https://api.hyperliquid.xyz/info", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "spotClearinghouseState", user: addr }),
            });
            if (!res.ok) return;
            const json = await res.json();
            const hypeBalance = json.balances?.find((b: { coin: string }) => b.coin === "HYPE");
            balances[addr] = hypeBalance ? parseFloat(hypeBalance.total) : 0;
          } catch { /* ignore */ }
        })
      );
    }
    setWalletBalances(prev => ({ ...prev, ...balances }));
  }, [lookbackDays]);

  // Fetch price + balances on mount, then every 60s alongside the time tick
  useEffect(() => {
    fetchHypePrice();
    fetchWalletBalances();
    periodicIntervalRef.current = setInterval(() => {
      setNow(Date.now());
      fetchHypePrice();
      fetchWalletBalances();
    }, 60_000);
    return () => {
      if (periodicIntervalRef.current) clearInterval(periodicIntervalRef.current);
    };
  }, [fetchHypePrice, fetchWalletBalances]);

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

  // Keep dataRef in sync and re-fetch balances when data changes
  useEffect(() => {
    dataRef.current = data;
    fetchWalletBalances();
  }, [data, fetchWalletBalances]);


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
        </div>
      </div>

      {/* Table Header */}
      <div className={`grid grid-cols-[1fr_1fr_1fr_1fr] px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider ${secondaryTextColor} border-b ${borderColor} flex-shrink-0`}>
        <span>Unlocks In</span>
        <span>Amount (HYPE)</span>
        <span>USDC</span>
        <span className="text-right">Address</span>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredEntries.length === 0 && (
          <div className={`flex items-center justify-center py-8 ${secondaryTextColor} text-sm`}>
            No entries in this size bracket
          </div>
        )}
        {filteredEntries.map((entry, idx) => (
          <div
            key={`${entry.user}-${entry.initiatedTime}-${idx}`}
            className={`grid grid-cols-[1fr_1fr_1fr_1fr] px-4 py-1.5 text-xs ${idx % 2 === 0 ? rowEvenBg : ""} ${rowHoverBg} transition-colors`}
          >
            <span className={entry.unlockTime <= now ? "text-green-400" : ""}>
              {formatTimeRemaining(entry.unlockTime, now)}
            </span>
            <span className={`font-mono ${getAmountColorClass(entry.amountHype)}`}>
              {formatHypeAmount(entry.amountHype)}
              {entry.unlockTime <= now && walletBalances[entry.user.toLowerCase()] !== undefined && (() => {
                const pct = Math.round((walletBalances[entry.user.toLowerCase()] / entry.amountHype) * 100);
                return <span className={`ml-1 text-[10px] px-1 rounded ring-1 ${getRetentionClasses(pct)}`}>{pct}%</span>;
              })()}
            </span>
            <span className={`font-mono ${secondaryTextColor}`}>
              {hypePrice ? formatUsd(entry.amountHype * hypePrice) : "—"}
              {entry.unlockTime <= now && hypePrice && walletBalances[entry.user.toLowerCase()] !== undefined && (() => {
                const pct = Math.round((walletBalances[entry.user.toLowerCase()] / entry.amountHype) * 100);
                return <span className={`ml-1 text-[10px] px-1 rounded ring-1 ${getRetentionClasses(pct)}`}>{pct}%</span>;
              })()}
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
        ))}
      </div>
    </div>
  );
}
