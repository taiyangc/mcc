"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  Time,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";

const HL_INTERVALS = [
  { value: "1m", label: "1m" },
  { value: "3m", label: "3m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "2h", label: "2h" },
  { value: "4h", label: "4h" },
  { value: "8h", label: "8h" },
  { value: "12h", label: "12h" },
  { value: "1d", label: "1D" },
  { value: "3d", label: "3D" },
  { value: "1w", label: "1W" },
  { value: "1M", label: "1M" },
];

// Map TradingView interval format to Hyperliquid format
const TV_TO_HL_INTERVAL: Record<string, string> = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  "D": "1d",
  "W": "1w",
  "M": "1M",
};

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

interface HyperliquidWidgetProps {
  coin: string;
  displayName?: string;
  isSpot?: boolean;
  interval?: string;
  refreshKey?: number;
  height?: number;
  onIntervalChange?: (interval: string) => void;
}

export default function HyperliquidWidget({
  coin,
  displayName,
  isSpot = false,
  interval = "1h",
  refreshKey = 0,
  height = 350,
  onIntervalChange,
}: HyperliquidWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const theme = useSystemTheme();

  // Map TV interval to HL interval
  const hlInterval = TV_TO_HL_INTERVAL[interval] || interval;
  const [activeInterval, setActiveInterval] = useState(hlInterval);
  const [lastPrice, setLastPrice] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Sync activeInterval when parent interval changes
  useEffect(() => {
    const mapped = TV_TO_HL_INTERVAL[interval] || interval;
    if (HL_INTERVALS.some(i => i.value === mapped)) {
      setActiveInterval(mapped);
    }
  }, [interval]);

  const fetchCandles = useCallback(async (chartInterval: string) => {
    try {
      const res = await fetch(`/api/hyperliquid/candles?coin=${encodeURIComponent(coin)}&interval=${chartInterval}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, [coin]);

  // Create chart on mount / theme change
  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = theme === "dark";

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: height - 32, // leave room for interval bar
      layout: {
        background: { type: ColorType.Solid, color: isDark ? "#18181b" : "#ffffff" },
        textColor: isDark ? "#e4e4e7" : "#27272a",
      },
      grid: {
        vertLines: { color: isDark ? "#27272a" : "#e4e4e7" },
        horzLines: { color: isDark ? "#27272a" : "#e4e4e7" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: isDark ? "#3f3f46" : "#d4d4d8" },
      timeScale: {
        borderColor: isDark ? "#3f3f46" : "#d4d4d8",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      wickUpColor: "#22c55e",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });

    chart.priceScale("").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // ResizeObserver
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) {
          chart.resize(width, height - 32);
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [theme, height]);

  // Fetch and set data when interval, coin, or refreshKey changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchCandles(activeInterval).then(candles => {
      if (cancelled || !candles || !candleSeriesRef.current || !volumeSeriesRef.current) return;

      const candleData: CandlestickData<Time>[] = candles.map((c: any) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volumeData: HistogramData<Time>[] = candles.map((c: any) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
      }));

      candleSeriesRef.current!.setData(candleData);
      volumeSeriesRef.current!.setData(volumeData);

      if (candles.length > 0) {
        const last = candles[candles.length - 1];
        setLastPrice(formatPrice(last.close));
      }

      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [activeInterval, coin, refreshKey, fetchCandles]);

  const handleIntervalClick = (iv: string) => {
    setActiveInterval(iv);
    if (onIntervalChange) onIntervalChange(iv);
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
      {/* Header + interval bar */}
      <div
        style={{ height: 32 }}
        className="flex items-center gap-1 px-2 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 overflow-x-auto"
      >
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap mr-2">
          {displayName || coin}{isSpot ? "/USDC Spot" : "-USD Perp"}{lastPrice ? ` | $${lastPrice}` : ""}{" "}
          | {activeInterval}
        </span>
        {loading && (
          <span className="text-xs text-gray-400 mr-2">Loading...</span>
        )}
        <div className="flex gap-0.5">
          {HL_INTERVALS.map(iv => (
            <button
              key={iv.value}
              onClick={() => handleIntervalClick(iv.value)}
              className={`px-1.5 py-0.5 text-[10px] rounded ${
                activeInterval === iv.value
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-200 dark:bg-zinc-700 text-gray-700 dark:text-gray-300 hover:bg-zinc-300 dark:hover:bg-zinc-600"
              }`}
            >
              {iv.label}
            </button>
          ))}
        </div>
      </div>
      {/* Chart container */}
      <div ref={containerRef} style={{ width: "100%", height: `calc(100% - 32px)` }} />
    </div>
  );
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toPrecision(4);
}
