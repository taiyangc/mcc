"use client";
import { useEffect, useState } from "react";

interface GexWidgetProps {
  currency: string;
  exchange: string;
  refreshKey?: number;
  height?: number;
}

interface GexData {
  currency: string;
  spotPrice: number;
  lastUpdated: string;
  expirations: string[];
  strikes: Record<string, { netGex: number; byExpiration: Record<string, number> }>;
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

function formatGexValue(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function GexWidget({ currency, refreshKey = 0, height = 350 }: GexWidgetProps) {
  const [data, setData] = useState<GexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExpiration, setSelectedExpiration] = useState<string>("all");
  const [selectedBar, setSelectedBar] = useState<number | null>(null);
  const theme = useSystemTheme();

  useEffect(() => {
    let cancelled = false;

    async function fetchGex() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/gex?currency=${encodeURIComponent(currency)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `API error: ${res.status}`);
        }
        const gexData = await res.json();
        if (cancelled) return;
        setData(gexData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch GEX data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchGex();
    return () => { cancelled = true; };
  }, [currency, refreshKey]);

  const bgColor = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const textColor = theme === "dark" ? "text-gray-100" : "text-gray-900";
  const secondaryTextColor = theme === "dark" ? "text-gray-400" : "text-gray-600";

  if (loading) {
    return (
      <div className={`w-full h-full ${bgColor} flex items-center justify-center`} style={{ height }}>
        <div className={`${secondaryTextColor} text-sm text-center`}>
          <div>Loading GEX data...</div>
          <div className="text-xs mt-1">First load may take up to 60s.</div>
        </div>
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

  if (!data || Object.keys(data.strikes).length === 0) {
    return (
      <div className={`w-full h-full ${bgColor} flex items-center justify-center`} style={{ height }}>
        <div className={`${secondaryTextColor} text-sm`}>No GEX data available</div>
      </div>
    );
  }

  // Filter strikes by selected expiration
  const filteredStrikes: { strike: number; gex: number }[] = [];
  for (const [strikeStr, val] of Object.entries(data.strikes)) {
    const strike = parseFloat(strikeStr);
    let gex: number;
    if (selectedExpiration === "all") {
      gex = val.netGex;
    } else {
      gex = val.byExpiration[selectedExpiration] || 0;
    }
    if (gex !== 0) {
      filteredStrikes.push({ strike, gex });
    }
  }
  filteredStrikes.sort((a, b) => a.strike - b.strike);

  if (filteredStrikes.length === 0) {
    return (
      <div className={`w-full h-full ${bgColor} ${textColor} p-4 flex flex-col`} style={{ height }}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold">{data.currency} GEX — Spot: ${data.spotPrice.toFixed(2)}</h3>
          <select
            value={selectedExpiration}
            onChange={(e) => setSelectedExpiration(e.target.value)}
            className={`text-xs px-2 py-1 rounded border ${theme === "dark" ? "bg-zinc-800 border-zinc-600" : "bg-gray-100 border-gray-300"}`}
          >
            <option value="all">All Expirations</option>
            {data.expirations.map((exp) => (
              <option key={exp} value={exp}>{exp}</option>
            ))}
          </select>
        </div>
        <div className={`flex-1 flex items-center justify-center ${secondaryTextColor} text-sm`}>
          No data for this expiration
        </div>
      </div>
    );
  }

  // Chart dimensions
  const padding = { top: 28, right: 80, bottom: 50, left: 10 };
  const chartWidth = 800;
  const chartHeight = Math.max(200, height - 60);
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const maxAbsGex = Math.max(...filteredStrikes.map((s) => Math.abs(s.gex)));
  const barWidth = Math.max(2, Math.min(20, innerWidth / filteredStrikes.length - 1));
  const totalBarsWidth = filteredStrikes.length * (barWidth + 1);
  const barsStartX = padding.left + (innerWidth - totalBarsWidth) / 2;

  // Y scale: center zero line
  const yScale = (val: number) => {
    if (maxAbsGex === 0) return innerHeight / 2;
    return padding.top + innerHeight / 2 - (val / maxAbsGex) * (innerHeight / 2);
  };
  const zeroY = padding.top + innerHeight / 2;

  // Spot price position
  const spotIdx = filteredStrikes.findIndex((s) => s.strike >= data.spotPrice);
  let spotX: number | null = null;
  if (spotIdx >= 0) {
    if (spotIdx === 0) {
      spotX = barsStartX;
    } else {
      // Interpolate between bars
      const prev = filteredStrikes[spotIdx - 1];
      const curr = filteredStrikes[spotIdx];
      const ratio = (data.spotPrice - prev.strike) / (curr.strike - prev.strike);
      spotX = barsStartX + (spotIdx - 1 + ratio) * (barWidth + 1) + barWidth / 2;
    }
  }

  // Y-axis tick values
  const yTicks: number[] = [];
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    const val = -maxAbsGex + (2 * maxAbsGex * i) / tickCount;
    yTicks.push(val);
  }

  // X-axis label: show ~10-15 labels max
  const labelInterval = Math.max(1, Math.floor(filteredStrikes.length / 12));

  const isDark = theme === "dark";
  const axisColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "#374151" : "#e5e7eb";

  // Tooltip data for selected bar
  const selectedStrike = selectedBar !== null ? filteredStrikes[selectedBar] : null;

  return (
    <div className={`w-full h-full ${bgColor} ${textColor} p-2 flex flex-col`} style={{ height }}>
      <div className="flex justify-between items-center mb-1 px-2">
        <h3 className="text-base font-bold">{data.currency} Gamma Exposure — Spot: ${data.spotPrice.toLocaleString()}</h3>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${secondaryTextColor}`}>
            {new Date(data.lastUpdated).toLocaleTimeString()}
          </span>
          <select
            value={selectedExpiration}
            onChange={(e) => setSelectedExpiration(e.target.value)}
            className={`text-xs px-2 py-1 rounded border ${isDark ? "bg-zinc-800 border-zinc-600 text-gray-100" : "bg-gray-100 border-gray-300 text-gray-900"}`}
          >
            <option value="all">All Expirations</option>
            {data.expirations.map((exp) => (
              <option key={exp} value={exp}>{exp}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tooltip for selected bar */}
      {selectedStrike && (
        <div className={`mx-2 mb-1 px-3 py-1.5 rounded text-sm font-medium flex items-center gap-4 ${isDark ? "bg-zinc-800" : "bg-gray-100"}`}>
          <span>Strike: <strong>${selectedStrike.strike.toLocaleString()}</strong></span>
          <span style={{ color: selectedStrike.gex >= 0 ? (isDark ? "#22c55e" : "#16a34a") : (isDark ? "#ef4444" : "#dc2626") }}>
            GEX: <strong>{formatGexValue(selectedStrike.gex)}</strong>
          </span>
          <button
            onClick={() => setSelectedBar(null)}
            className={`ml-auto text-xs ${secondaryTextColor} hover:opacity-70`}
          >
            &times;
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full"
        >
          {/* Grid lines */}
          {yTicks.map((val, i) => (
            <line
              key={i}
              x1={padding.left}
              x2={chartWidth - padding.right}
              y1={yScale(val)}
              y2={yScale(val)}
              stroke={gridColor}
              strokeWidth={val === 0 ? 1.5 : 0.5}
              strokeDasharray={val === 0 ? undefined : "4,4"}
            />
          ))}

          {/* Y-axis labels */}
          {yTicks.map((val, i) => (
            <text
              key={i}
              x={chartWidth - padding.right + 8}
              y={yScale(val) + 5}
              fontSize={13}
              fill={axisColor}
              textAnchor="start"
              fontWeight="500"
            >
              {formatGexValue(val)}
            </text>
          ))}

          {/* Bars */}
          {filteredStrikes.map((s, i) => {
            const x = barsStartX + i * (barWidth + 1);
            const barTop = s.gex >= 0 ? yScale(s.gex) : zeroY;
            const barH = Math.abs(yScale(s.gex) - zeroY);
            const isSelected = selectedBar === i;
            const baseColor = s.gex >= 0
              ? (isDark ? "#22c55e" : "#16a34a")
              : (isDark ? "#ef4444" : "#dc2626");
            const highlightColor = s.gex >= 0
              ? (isDark ? "#4ade80" : "#22c55e")
              : (isDark ? "#f87171" : "#ef4444");
            return (
              <rect
                key={i}
                x={x}
                y={barTop}
                width={barWidth}
                height={Math.max(0.5, barH)}
                fill={isSelected ? highlightColor : baseColor}
                opacity={isSelected ? 1 : 0.85}
                stroke={isSelected ? (isDark ? "#fff" : "#000") : "none"}
                strokeWidth={isSelected ? 1.5 : 0}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedBar(isSelected ? null : i)}
              >
                <title>{`Strike: $${s.strike.toLocaleString()}, GEX: ${formatGexValue(s.gex)}`}</title>
              </rect>
            );
          })}

          {/* X-axis labels (strike prices) */}
          {filteredStrikes.map((s, i) => {
            if (i % labelInterval !== 0) return null;
            const x = barsStartX + i * (barWidth + 1) + barWidth / 2;
            const labelY = chartHeight - padding.bottom + 14;
            return (
              <text
                key={i}
                x={x}
                y={labelY}
                fontSize={12}
                fill={axisColor}
                textAnchor="end"
                fontWeight="500"
                transform={`rotate(-45, ${x}, ${labelY})`}
              >
                ${s.strike.toLocaleString()}
              </text>
            );
          })}

          {/* Spot price line */}
          {spotX !== null && (
            <>
              <line
                x1={spotX}
                x2={spotX}
                y1={padding.top}
                y2={chartHeight - padding.bottom}
                stroke={isDark ? "#facc15" : "#ca8a04"}
                strokeWidth={1.5}
                strokeDasharray="6,3"
              />
              <text
                x={spotX}
                y={padding.top - 8}
                fontSize={13}
                fill={isDark ? "#facc15" : "#ca8a04"}
                textAnchor="middle"
                fontWeight="bold"
              >
                Spot: ${data.spotPrice.toLocaleString()}
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
