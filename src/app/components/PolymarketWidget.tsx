"use client";
import { useEffect, useState } from "react";

interface PolymarketWidgetProps {
  marketId: string;
  refreshKey?: number;
  height?: number;
}

interface Outcome {
  name: string;
  price: number;
}

interface MarketData {
  question: string;
  outcomes: Outcome[];
  volume: number;
  liquidity: number;
  endDate?: string;
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

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

export default function PolymarketWidget({ marketId, refreshKey = 0, height = 350 }: PolymarketWidgetProps) {
  const [market, setMarket] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const theme = useSystemTheme();

  useEffect(() => {
    let cancelled = false;

    async function fetchMarket() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/polymarket/markets?id=${encodeURIComponent(marketId)}`);
        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }
        const marketData = await res.json();
        if (cancelled) return;

        if (!marketData || !marketData.question) {
          throw new Error("Market not found");
        }

        // Parse outcomes from the market data
        // Polymarket stores outcomes as JSON string arrays
        let outcomeNames: string[] = [];
        let outcomePrices: number[] = [];

        try {
          outcomeNames = typeof marketData.outcomes === 'string'
            ? JSON.parse(marketData.outcomes)
            : marketData.outcomes || ['Yes', 'No'];
          outcomePrices = typeof marketData.outcomePrices === 'string'
            ? JSON.parse(marketData.outcomePrices)
            : marketData.outcomePrices || [];
        } catch {
          outcomeNames = ['Yes', 'No'];
          outcomePrices = [];
        }

        const outcomes: Outcome[] = outcomeNames.map((name: string, i: number) => ({
          name,
          price: outcomePrices[i] ? parseFloat(String(outcomePrices[i])) : 0,
        }));

        setMarket({
          question: marketData.question || 'Unknown Market',
          outcomes,
          volume: parseFloat(marketData.volume || '0'),
          liquidity: parseFloat(marketData.liquidity || '0'),
          endDate: marketData.endDate,
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch market');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchMarket();

    return () => {
      cancelled = true;
    };
  }, [marketId, refreshKey]);

  const bgColor = theme === 'dark' ? 'bg-zinc-900' : 'bg-white';
  const textColor = theme === 'dark' ? 'text-gray-100' : 'text-gray-900';
  const secondaryTextColor = theme === 'dark' ? 'text-gray-400' : 'text-gray-600';
  const borderColor = theme === 'dark' ? 'border-zinc-700' : 'border-gray-200';

  if (loading) {
    return (
      <div className={`w-full h-full ${bgColor} flex items-center justify-center`} style={{ height }}>
        <div className={`${secondaryTextColor} text-sm`}>Loading market data...</div>
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

  if (!market) {
    return (
      <div className={`w-full h-full ${bgColor} flex items-center justify-center`} style={{ height }}>
        <div className={`${secondaryTextColor} text-sm`}>No market data</div>
      </div>
    );
  }

  return (
    <div className={`w-full h-full ${bgColor} ${textColor} p-4 flex flex-col`} style={{ height }}>
      {/* Question */}
      <h3 className="text-lg font-semibold mb-4 leading-tight">{market.question}</h3>

      {/* Outcomes */}
      <div className="flex-1 flex flex-col justify-center gap-3">
        {market.outcomes.map((outcome, idx) => {
          const percentage = outcome.price * 100;
          // Color based on probability - higher = more green, lower = more red
          const barColor = percentage >= 50
            ? `bg-green-${Math.min(600, 400 + Math.floor((percentage - 50) * 4))}`
            : `bg-red-${Math.min(600, 400 + Math.floor((50 - percentage) * 4))}`;

          // Use simpler color scheme
          const getBarColor = (pct: number) => {
            if (pct >= 70) return theme === 'dark' ? 'bg-green-600' : 'bg-green-500';
            if (pct >= 50) return theme === 'dark' ? 'bg-green-700' : 'bg-green-400';
            if (pct >= 30) return theme === 'dark' ? 'bg-yellow-600' : 'bg-yellow-400';
            return theme === 'dark' ? 'bg-red-600' : 'bg-red-400';
          };

          return (
            <div key={idx} className="w-full">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">{outcome.name}</span>
                <span className="text-sm font-bold">{percentage.toFixed(1)}%</span>
              </div>
              <div className={`w-full h-6 rounded ${theme === 'dark' ? 'bg-zinc-700' : 'bg-gray-200'} overflow-hidden`}>
                <div
                  className={`h-full ${getBarColor(percentage)} transition-all duration-300`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className={`mt-4 pt-3 border-t ${borderColor} flex justify-between text-sm ${secondaryTextColor}`}>
        <span>Vol: {formatCurrency(market.volume)}</span>
        <span>Liquidity: {formatCurrency(market.liquidity)}</span>
        {market.endDate && (
          <span>Ends: {new Date(market.endDate).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}
