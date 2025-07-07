"use client";
import React, { useState, useEffect } from "react";
import TradingViewWidget from "./components/TradingViewWidget";

// Default pairs for demonstration
const DEFAULT_PAIRS = ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT"];

// TradingView interval options
const INTERVAL_OPTIONS = [
  { value: "1", label: "1 minute" },
  { value: "3", label: "3 minutes" },
  { value: "5", label: "5 minutes" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
  { value: "240", label: "4 hours" },
  { value: "D", label: "1 day" },
  { value: "W", label: "1 week" },
  { value: "M", label: "1 month" }
];

function parsePairsFromUrl(): string[] {
  if (typeof window === "undefined") return DEFAULT_PAIRS;
  const params = new URLSearchParams(window.location.search);
  const pairs = params.get("pairs");
  return pairs ? pairs.split(",") : DEFAULT_PAIRS;
}

function parseGridFromUrl(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 2, height: 2 };
  const params = new URLSearchParams(window.location.search);
  const width = parseInt(params.get("width") || "2", 10);
  const height = parseInt(params.get("height") || "2", 10);
  return {
    width: isNaN(width) ? 2 : Math.max(1, Math.min(10, width)),
    height: isNaN(height) ? 2 : Math.max(1, Math.min(10, height)),
  };
}

function parseDefaultIntervalFromUrl(): string {
  if (typeof window === "undefined") return "D";
  const params = new URLSearchParams(window.location.search);
  const interval = params.get("interval");
  return interval || "D";
}

function updateUrl(pairs: string[], width: number, height: number, defaultInterval: string) {
  const params = new URLSearchParams(window.location.search);
  params.set("pairs", pairs.join(","));
  params.set("width", String(width));
  params.set("height", String(height));
  params.set("interval", defaultInterval);
  window.history.replaceState({}, "", `?${params.toString()}`);
}

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function SymbolInfoOverlay({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  useEffect(() => {
    // Technical Analysis widget (Oscillators, Moving Averages, Pivot Points)
    const taContainer = document.getElementById(`symbol-technical-widget-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`);
    if (taContainer) {
      taContainer.innerHTML = "";
      const taScript = document.createElement("script");
      taScript.src = "https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js";
      taScript.type = "text/javascript";
      taScript.async = true;
      taScript.innerHTML = JSON.stringify({
        interval: "1D",
        width: "100%",
        height: 350,
        isTransparent: false,
        colorTheme: getSystemTheme(),
        symbol,
        showIntervalTabs: true,
        locale: "en"
      });
      taContainer.appendChild(taScript);
    }
    // Symbol Info widget (Summary, Performance, Key Stats)
    const infoContainer = document.getElementById(`symbol-info-widget-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`);
    if (infoContainer) {
      infoContainer.innerHTML = "";
      const infoScript = document.createElement("script");
      infoScript.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js";
      infoScript.type = "text/javascript";
      infoScript.async = true;
      infoScript.innerHTML = JSON.stringify({
        symbol,
        width: "100%",
        height: 850,
        locale: "en",
        colorTheme: getSystemTheme(),
        isTransparent: false,
        showChange: true,           // Summary
        showLastPrice: true,        // Summary
        showLogo: true,             // Summary
        showHighLow: true,          // Key Stats
        showOpenClose: true,        // Key Stats
        showPrevClose: true,        // Key Stats
        showChangePercent: true,    // Summary
        show52WeekHighLow: true,    // Key Stats
        showMarketCap: true,        // Key Stats
        showVolume: true,           // Key Stats
        showFundamental: false,     // Hide
        showPerformance: true,      // Performance
      });
      infoContainer.appendChild(infoScript);
    }
    return () => {
      if (taContainer) taContainer.innerHTML = "";
      if (infoContainer) infoContainer.innerHTML = "";
    };
  }, [symbol]);
  return (
    <div className="absolute top-0 right-0 h-full w-96 max-w-full bg-white dark:bg-zinc-900 shadow-lg z-20 flex flex-col pointer-events-auto overflow-hidden border-l border-gray-200 dark:border-zinc-700">
      <button className="absolute top-2 right-2 text-xl z-10" onClick={onClose}>&times;</button>
      <div className="flex-1 pt-10 px-2 pb-2 flex flex-col overflow-y-auto" style={{ maxHeight: '100%' }}>
        {/* Summary, Performance, Key Stats (Symbol Info) */}
        <div className="tradingview-widget-container mb-4" style={{ minHeight: 850, height: 850 }}>
          <div id={`symbol-info-widget-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`}></div>
        </div>
        {/* Technicals (Oscillators, Moving Averages, Pivot Points) */}
        <div className="tradingview-widget-container" style={{ minHeight: 350, height: 350 }}>
          <div id={`symbol-technical-widget-${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`}></div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  // Use width and height for grid size
  const gridFromUrl = typeof window !== "undefined" ? parseGridFromUrl() : { width: 2, height: 2 };
  const [gridWidth, setGridWidth] = useState(gridFromUrl.width);
  const [gridHeight, setGridHeight] = useState(gridFromUrl.height);
  const [pairs, setPairs] = useState<string[]>(
    typeof window !== "undefined" ? parsePairsFromUrl() : DEFAULT_PAIRS
  );
  const [defaultInterval, setDefaultInterval] = useState<string>(
    typeof window !== "undefined" ? parseDefaultIntervalFromUrl() : "D"
  );
  const [intervals, setIntervals] = useState<string[]>(() => {
    // Initialize intervals array with default interval for each pair
    if (typeof window !== "undefined") {
      const urlPairs = parsePairsFromUrl();
      const urlDefaultInterval = parseDefaultIntervalFromUrl();
      return new Array(urlPairs.length).fill(urlDefaultInterval);
    }
    return new Array(DEFAULT_PAIRS.length).fill("D");
  });
  const [showToast, setShowToast] = useState(false);
  const [refreshModal, setRefreshModal] = useState<{ show: boolean; chartIndex: number; newSymbol: string }>({
    show: false,
    chartIndex: -1,
    newSymbol: ""
  });

  // Load interval from localStorage (for backward compatibility)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedInterval = localStorage.getItem("tvInterval");
      if (savedInterval) {
        setIntervals(new Array(pairs.length).fill(savedInterval));
      }
    }
  }, [pairs.length]);

  // Save interval to localStorage (for backward compatibility)
  useEffect(() => {
    if (typeof window !== "undefined" && intervals.length > 0) {
      localStorage.setItem("tvInterval", intervals[0]); // Save first interval for compatibility
    }
  }, [intervals]);

  // Keep URL in sync with pairs, width, height, and default interval
  useEffect(() => {
    updateUrl(pairs, gridWidth, gridHeight, defaultInterval);
  }, [pairs, gridWidth, gridHeight, defaultInterval]);

  // On mount, sync state with URL
  useEffect(() => {
    const urlPairs = parsePairsFromUrl();
    const urlDefaultInterval = parseDefaultIntervalFromUrl();
    setPairs(urlPairs);
    setDefaultInterval(urlDefaultInterval);
    setIntervals(new Array(urlPairs.length).fill(urlDefaultInterval)); // Initialize intervals
    const grid = parseGridFromUrl();
    setGridWidth(grid.width);
    setGridHeight(grid.height);
  }, []);

  const handleAddChart = () => {
    setPairs((prev) => [...prev, "BINANCE:BTCUSDT"]);
    setIntervals((prev) => [...prev, defaultInterval]); // Add default interval for new chart
  };

  const handleRemoveChart = (idx: number) => {
    setPairs((prev) => prev.filter((_, i) => i !== idx));
    setIntervals((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDefaultIntervalChange = (newInterval: string) => {
    setDefaultInterval(newInterval);
    // Update all charts to use the new default interval
    setIntervals(new Array(pairs.length).fill(newInterval));
  };

  const handleRefreshChart = (idx: number) => {
    setRefreshModal({
      show: true,
      chartIndex: idx,
      newSymbol: pairs[idx] // Pre-fill with current symbol
    });
  };

  const handleConfirmRefresh = () => {
    if (refreshModal.newSymbol.trim()) {
      setPairs(prev => {
        const updated = [...prev];
        updated[refreshModal.chartIndex] = refreshModal.newSymbol.trim().toUpperCase();
        return updated;
      });
      setRefreshModal({ show: false, chartIndex: -1, newSymbol: "" });
    }
  };

  // Share charts button handler
  const handleShareCharts = async () => {
    if (typeof window !== "undefined") {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000); // Hide toast after 3 seconds
      } catch (err) {
        console.error('Failed to copy URL:', err);
      }
    }
  };

  // Calculate the number of charts to display based on grid size
  const maxCharts = gridWidth * gridHeight;
  const visiblePairs = pairs.slice(0, maxCharts);
  const visibleIntervals = intervals.slice(0, maxCharts);

  return (
    <div className="min-h-screen p-4 flex flex-col items-center gap-6">
      <h1 className="text-2xl font-bold mb-2">MultiCoinCharts</h1>
      <div className="flex gap-4 items-center mb-2">
        <label>
          Width:
          <input
            type="number"
            min={1}
            max={10}
            value={gridWidth}
            onChange={e => {
              const val = Math.max(1, Math.min(10, Number(e.target.value)));
              setGridWidth(val);
              // updateUrl will be called by useEffect
            }}
            className="ml-2 border rounded px-2 py-1 w-16"
          />
        </label>
        <label>
          Height:
          <input
            type="number"
            min={1}
            max={10}
            value={gridHeight}
            onChange={e => {
              const val = Math.max(1, Math.min(10, Number(e.target.value)));
              setGridHeight(val);
              // updateUrl will be called by useEffect
            }}
            className="ml-2 border rounded px-2 py-1 w-16"
          />
        </label>
        <label>
          Default Interval:
          <select
            value={defaultInterval}
            onChange={(e) => handleDefaultIntervalChange(e.target.value)}
            className="ml-2 border rounded px-2 py-1 bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100"
          >
            {INTERVAL_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="bg-blue-600 text-white px-4 py-1 rounded hover:bg-blue-700"
          onClick={handleAddChart}
        >
          Add Chart
        </button>
        <button
          className="bg-gray-200 dark:bg-zinc-800 text-gray-800 dark:text-gray-200 px-4 py-1 rounded hover:bg-gray-300 dark:hover:bg-zinc-700 border"
          onClick={handleShareCharts}
        >
          Share Charts
        </button>
      </div>

      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-md shadow-lg transform transition-all duration-300 ease-in-out">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>URL copied to clipboard!</span>
          </div>
        </div>
      )}

      {/* Refresh Chart Modal */}
      {refreshModal.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 w-96 max-w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Refresh Chart
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Enter new symbol:
              </label>
              <input
                type="text"
                value={refreshModal.newSymbol}
                onChange={(e) => setRefreshModal(prev => ({ ...prev, newSymbol: e.target.value }))}
                placeholder="e.g., BINANCE:PEPEUSDT"
                className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-700 text-gray-900 dark:text-gray-100"
                onKeyPress={(e) => e.key === 'Enter' && handleConfirmRefresh()}
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRefreshModal({ show: false, chartIndex: -1, newSymbol: "" })}
                className="px-4 py-2 text-sm bg-gray-300 dark:bg-zinc-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-400 dark:hover:bg-zinc-500"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRefresh}
                disabled={!refreshModal.newSymbol.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Refresh Chart
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="w-full grid gap-0"
        style={{
          gridTemplateColumns: `repeat(${gridWidth}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridHeight}, minmax(0, 1fr))`,
        }}
      >
        {visiblePairs.map((pair, idx) => (
          <div key={idx} className="relative bg-white dark:bg-zinc-900 flex" style={{ minHeight: 350 }}>
            {/* Main Chart Area */}
            <div className="flex-1">
              <TradingViewWidget
                symbol={pair}
                height={350}
                interval={visibleIntervals[idx] || defaultInterval}
                onSymbolChange={newSymbol => {
                  setPairs(prev => {
                    const updated = [...prev];
                    updated[idx] = newSymbol;
                    // Immediately update URL after symbol change
                    updateUrl(updated, gridWidth, gridHeight, defaultInterval);
                    return updated;
                  });
                }}
                onIntervalChange={newInterval => {
                  setIntervals(prev => {
                    const updated = [...prev];
                    updated[idx] = newInterval;
                    return updated;
                  });
                }}
              />
            </div>
            
            {/* Permanent Sidebar */}
            <div className="w-64 bg-gray-50 dark:bg-zinc-800 border-l border-gray-200 dark:border-zinc-700 flex flex-col">
              {/* Chart Controls */}
              <div className="p-3 border-b border-gray-200 dark:border-zinc-700 space-y-2">
                <button
                  className="w-full flex items-center justify-center px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                  onClick={() => handleRefreshChart(idx)}
                  title="Refresh chart with new symbol"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Chart
                </button>
                <button
                  className="w-full flex items-center justify-center px-3 py-2 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
                  onClick={() => handleRemoveChart(idx)}
                  title="Remove chart"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Remove Chart
                </button>
              </div>
              
              {/* Sidebar Content Area */}
              <div className="flex-1 p-3">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <div className="font-medium mb-2">Chart Info</div>
                  <div className="space-y-1">
                    <div><span className="font-medium">Symbol:</span> {pair}</div>
                    <div><span className="font-medium">Interval:</span> {visibleIntervals[idx] || defaultInterval}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
