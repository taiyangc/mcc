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
  if (diff <= 0) return "Unlocked";
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
  const [hypePrice, setHypePrice] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const priceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const theme = useSystemTheme();

  // Tick every 60s to keep "Unlocks In" times fresh
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  useEffect(() => {
    fetchHypePrice();
    priceIntervalRef.current = setInterval(fetchHypePrice, 60_000);
    return () => {
      if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);
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
  const filteredEntries = data
    ? data.entries.filter(e => e.amountHype >= activeFilter.min && e.amountHype < activeFilter.max)
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
      </div>

      {/* Table Header */}
      <div className={`grid grid-cols-[1fr_1fr_1fr_1fr] px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider ${secondaryTextColor} border-b ${borderColor} flex-shrink-0`}>
        <span>Unlocks In</span>
        <span className="text-right">Amount (HYPE)</span>
        <span className="text-right">USDC</span>
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
            <span className={`text-right font-mono ${getAmountColorClass(entry.amountHype)}`}>
              {formatHypeAmount(entry.amountHype)}
            </span>
            <span className={`text-right font-mono ${secondaryTextColor}`}>
              {hypePrice ? formatUsd(entry.amountHype * hypePrice) : "—"}
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
