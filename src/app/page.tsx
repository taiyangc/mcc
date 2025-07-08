"use client";
import React, { useState, useEffect } from "react";
import TradingViewWidget from "./components/TradingViewWidget";
import { useRef } from "react";

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

async function searchGeckoPools(query: string): Promise<any[]> {
  if (!query) return [];
  const res = await fetch(`https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || [];
}

export default function Home() {
  // Hydration guard
  const [hydrated, setHydrated] = useState(false);
  // Initialize state from URL on client, defaults on server
  const getInitialPairs = () => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const pairs = params.get("pairs");
      return pairs ? pairs.split(",") : DEFAULT_PAIRS;
    }
    return DEFAULT_PAIRS;
  };
  const getInitialGrid = () => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const width = parseInt(params.get("width") || "2", 10);
      const height = parseInt(params.get("height") || "2", 10);
      return {
        width: isNaN(width) ? 2 : Math.max(1, Math.min(10, width)),
        height: isNaN(height) ? 2 : Math.max(1, Math.min(10, height)),
      };
    }
    return { width: 2, height: 2 };
  };
  const getInitialInterval = () => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const interval = params.get("interval");
      return interval || "D";
    }
    return "D";
  };
  const initialPairs = getInitialPairs();
  const initialGrid = getInitialGrid();
  const initialInterval = getInitialInterval();

  const [gridWidth, setGridWidth] = useState(initialGrid.width);
  const [gridHeight, setGridHeight] = useState(initialGrid.height);
  const [pairs, setPairs] = useState<string[]>(initialPairs);
  const [defaultInterval, setDefaultInterval] = useState<string>(initialInterval);
  const [intervals, setIntervals] = useState<string[]>(new Array(initialPairs.length).fill(initialInterval));
  const [showToast, setShowToast] = useState(false);
  const [refreshModal, setRefreshModal] = useState<{ show: boolean; chartIndex: number; newSymbol: string }>({
    show: false,
    chartIndex: -1,
    newSymbol: ""
  });
  const [addModal, setAddModal] = useState<{ show: boolean; symbol: string }>({ show: false, symbol: "BINANCE:BTCUSDT" });
  const [detailModal, setDetailModal] = useState<{ show: boolean; chartIndex: number }>({ show: false, chartIndex: -1 });
  const [expandedTechIdx, setExpandedTechIdx] = useState<number | null>(null);
  const [expandedDetailIdx, setExpandedDetailIdx] = useState<number | null>(null);

  // Add Chart Modal: support GeckoTerminal search
  const [addMode, setAddMode] = useState<'symbol' | 'gecko'>('symbol');
  const [geckoQuery, setGeckoQuery] = useState('');
  const [geckoResults, setGeckoResults] = useState<any[]>([]);
  const [geckoLoading, setGeckoLoading] = useState(false);
  const geckoTimeout = useRef<NodeJS.Timeout | null>(null);

  // Handle GeckoTerminal search
  useEffect(() => {
    if (addMode !== 'gecko' || !geckoQuery) {
      setGeckoResults([]);
      return;
    }
    setGeckoLoading(true);
    if (geckoTimeout.current) clearTimeout(geckoTimeout.current);
    geckoTimeout.current = setTimeout(async () => {
      const results = await searchGeckoPools(geckoQuery);
      setGeckoResults(results);
      setGeckoLoading(false);
    }, 400);
    // eslint-disable-next-line
  }, [geckoQuery, addMode]);

  // Editable pairs grid state
  const [editablePairs, setEditablePairs] = useState<string[]>(pairs);
  // Sync editablePairs with pairs when pairs/grid changes
  useEffect(() => {
    setEditablePairs(pairs);
  }, [pairs.join(",")]);

  // Handle input change in the editable grid
  const handleEditablePairChange = (idx: number, value: string) => {
    setEditablePairs(prev => {
      const updated = [...prev];
      updated[idx] = value;
      return updated;
    });
  };

  // Save edited pairs
  const handleSaveEditablePairs = () => {
    // Only update if changed
    const newPairs = [...pairs];
    let changed = false;
    for (let i = 0; i < editablePairs.length; ++i) {
      const newVal = editablePairs[i].trim().toUpperCase();
      if (newVal && newVal !== pairs[i]) {
        newPairs[i] = newVal;
        changed = true;
      }
    }
    if (changed) {
      setPairs(newPairs);
      setIntervals(new Array(newPairs.length).fill(defaultInterval));
      updateUrl(newPairs, gridWidth, gridHeight, defaultInterval);
    }
  };

  useEffect(() => { setHydrated(true); }, []);

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

  // Listen for URL changes (popstate) and update state from URL
  useEffect(() => {
    const handlePopState = () => {
      const urlPairs = parsePairsFromUrl();
      const urlDefaultInterval = parseDefaultIntervalFromUrl();
      setPairs(urlPairs);
      setDefaultInterval(urlDefaultInterval);
      setIntervals(new Array(urlPairs.length).fill(urlDefaultInterval));
      const grid = parseGridFromUrl();
      setGridWidth(grid.width);
      setGridHeight(grid.height);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Mount TradingView Technical Analysis widget when sidebar is expanded
  useEffect(() => {
    if (expandedTechIdx === null || expandedTechIdx < 0 || expandedTechIdx >= pairs.length) return;
    const symbol = pairs[expandedTechIdx];
    const containerId = `tv-tech-widget-${expandedTechIdx}`;
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = "";
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js";
      script.type = "text/javascript";
      script.async = true;
      script.innerHTML = JSON.stringify({
        interval: "1D",
        width: "100%",
        height: 350,
        isTransparent: false,
        colorTheme: typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        symbol,
        showIntervalTabs: true,
        locale: "en"
      });
      container.appendChild(script);
    }
    return () => {
      if (container) container.innerHTML = "";
    };
    // eslint-disable-next-line
  }, [expandedTechIdx, pairs]);

  const handleAddChart = () => {
    setAddModal({ show: true, symbol: "BINANCE:BTCUSDT" });
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

  const handleConfirmAdd = () => {
    if (addModal.symbol.trim()) {
      setPairs((prev) => [...prev, addModal.symbol.trim().toUpperCase()]);
      setIntervals((prev) => [...prev, defaultInterval]);
      setAddModal({ show: false, symbol: "BINANCE:BTCUSDT" });
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

  // Collapse/expand state for config and grid
  const [configOpen, setConfigOpen] = useState(true);
  const handleToggleConfig = () => setConfigOpen(open => !open);

  if (!hydrated) return null;

  return (
    <div className="min-h-screen p-4 flex flex-col items-center gap-6">
      <div className="flex items-center gap-2 mb-2">
        <h1 className="text-2xl font-bold">MultiCoinCharts</h1>
        <button
          onClick={handleToggleConfig}
          aria-label={configOpen ? "Collapse settings" : "Expand settings"}
          className="ml-2 p-1 rounded hover:bg-gray-200 dark:hover:bg-zinc-700 focus:outline-none"
        >
          {configOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>
      {configOpen && (
        <>
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

          {/* Add Chart Modal */}
          {addModal.show && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 w-96 max-w-full mx-4">
                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                  Add Chart
                </h3>
                <div className="mb-4 flex gap-2">
                  <button
                    className={`px-3 py-1 rounded ${addMode === 'symbol' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-zinc-700 text-gray-800 dark:text-gray-200'}`}
                    onClick={() => setAddMode('symbol')}
                  >
                    By Symbol
                  </button>
                  <button
                    className={`px-3 py-1 rounded ${addMode === 'gecko' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-zinc-700 text-gray-800 dark:text-gray-200'}`}
                    onClick={() => setAddMode('gecko')}
                  >
                    GeckoTerminal
                  </button>
                </div>
                {addMode === 'symbol' ? (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Enter symbol:
                    </label>
                    <input
                      type="text"
                      value={addModal.symbol}
                      onChange={(e) => setAddModal(prev => ({ ...prev, symbol: e.target.value }))}
                      placeholder="e.g., BINANCE:BTCUSDT"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-700 text-gray-900 dark:text-gray-100"
                      onKeyPress={(e) => e.key === 'Enter' && handleConfirmAdd()}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Search GeckoTerminal Pools:
                    </label>
                    <input
                      type="text"
                      value={geckoQuery}
                      onChange={e => setGeckoQuery(e.target.value)}
                      placeholder="e.g., PEPE"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-700 text-gray-900 dark:text-gray-100"
                      autoFocus
                    />
                    {geckoLoading && <div className="text-xs text-gray-500 mt-1">Searching...</div>}
                    {!geckoLoading && geckoResults.length > 0 && (
                      <div className="mt-2 max-h-40 overflow-y-auto border rounded bg-white dark:bg-zinc-700">
                        {geckoResults.map(pool => {
                          const chain = pool.id?.split('_')[0]?.toLowerCase() || 'polygon_pos';
                          const name = pool.attributes.name || pool.id;
                          const address = pool.attributes.address;
                          const marketCap = pool.attributes.market_cap_usd;
                          const fdv = pool.attributes.fdv_usd;
                          const volume = pool.attributes.volume_usd && typeof pool.attributes.volume_usd === 'object' && pool.attributes.volume_usd.h24
                            ? pool.attributes.volume_usd.h24
                            : (typeof pool.attributes.volume_usd === 'string' ? pool.attributes.volume_usd : null);
                          // Chain color map
                          const chainColorMap: Record<string, string> = {
                            ethereum: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200',
                            polygon_pos: 'bg-fuchsia-100 dark:bg-fuchsia-900 text-fuchsia-700 dark:text-fuchsia-200',
                            bsc: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-900',
                            arbitrum: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200',
                            base: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-200',
                            optimism: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200',
                            blast: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200',
                            avalanche: 'bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-200',
                            fantom: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200',
                            gnosis: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200',
                            zksync: 'bg-lime-100 dark:bg-lime-900 text-lime-700 dark:text-lime-200',
                            linea: 'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-200',
                            scroll: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200',
                            manta: 'bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-200',
                            moonbeam: 'bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-200',
                            moonriver: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-900',
                            cronos: 'bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-200',
                            celo: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200',
                            aurora: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-200',
                            harmony: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200',
                            metis: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-200',
                            kava: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200',
                          };
                          // Color palette for unknown chains
                          const colorPalette = [
                            'bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-200',
                            'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200',
                            'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200',
                            'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-900',
                            'bg-fuchsia-100 dark:bg-fuchsia-900 text-fuchsia-700 dark:text-fuchsia-200',
                            'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-200',
                            'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200',
                            'bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-200',
                            'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200',
                            'bg-lime-100 dark:bg-lime-900 text-lime-700 dark:text-lime-200',
                            'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-200',
                            'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200',
                            'bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-200',
                            'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200',
                            'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-200',
                            'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200',
                          ];
                          function hashStringToIndex(str: string, max: number) {
                            let hash = 0;
                            for (let i = 0; i < str.length; i++) {
                              hash = ((hash << 5) - hash) + str.charCodeAt(i);
                              hash |= 0;
                            }
                            return Math.abs(hash) % max;
                          }
                          const chainClass = chainColorMap[chain] || colorPalette[hashStringToIndex(chain, colorPalette.length)];
                          return (
                            <div
                              key={pool.id}
                              role="button"
                              tabIndex={0}
                              className="block w-full text-left px-3 py-2 hover:bg-blue-100 dark:hover:bg-zinc-600 text-xs relative border-b last:border-b-0 border-gray-200 dark:border-zinc-700 cursor-pointer"
                              onClick={() => {
                                // Add the GeckoTerminal pool with chain and address
                                setPairs(prev => [...prev, `GECKO:${chain}:${address}`]);
                                setIntervals(prev => [...prev, defaultInterval]);
                                setAddModal({ show: false, symbol: "BINANCE:BTCUSDT" });
                                setGeckoQuery('');
                                setGeckoResults([]);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  setPairs(prev => [...prev, `GECKO:${chain}:${address}`]);
                                  setIntervals(prev => [...prev, defaultInterval]);
                                  setAddModal({ show: false, symbol: "BINANCE:BTCUSDT" });
                                  setGeckoQuery('');
                                  setGeckoResults([]);
                                }
                              }}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-base text-gray-900 dark:text-gray-100">{name}</span>
                                <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-mono ${chainClass}`}>{chain}</span>
                              </div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-gray-500">Pool:</span>
                                <span className="font-mono text-xs text-pink-600 dark:text-pink-400 select-all break-all">{address}</span>
                                <button
                                  type="button"
                                  className="ml-1 px-1 py-0.5 rounded bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-200 text-[10px] border border-pink-300 dark:border-pink-700"
                                  onClick={e => {e.stopPropagation(); navigator.clipboard.writeText(address);}}
                                  title="Copy address"
                                >Copy</button>
                              </div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-gray-500">Market Cap ($):</span>
                                <span className="text-gray-700 dark:text-gray-200">{marketCap ? Number(marketCap).toLocaleString() : 'N/A'}</span>
                              </div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-gray-500">FDV ($):</span>
                                <span className="text-gray-700 dark:text-gray-200">{fdv ? Number(fdv).toLocaleString() : 'N/A'}</span>
                              </div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-gray-500">Volume ($):</span>
                                <span className="text-gray-700 dark:text-gray-200">{volume ? Number(volume).toLocaleString() : 'N/A'}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => {
                      setAddModal({ show: false, symbol: "BINANCE:BTCUSDT" });
                      setGeckoQuery('');
                      setGeckoResults([]);
                    }}
                    className="px-4 py-2 text-sm bg-gray-300 dark:bg-zinc-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-400 dark:hover:bg-zinc-500"
                  >
                    Cancel
                  </button>
                  {addMode === 'symbol' && (
                    <button
                      onClick={handleConfirmAdd}
                      disabled={!addModal.symbol.trim()}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Add Chart
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Detail Modal */}
          {detailModal.show && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 w-96 max-w-full mx-4">
                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
                  Chart Details
                </h3>
                <div className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                  <div className="font-medium mb-2">Chart Info</div>
                  <div className="space-y-1">
                    <div><span className="font-medium">Symbol:</span> {visiblePairs[detailModal.chartIndex]}</div>
                    <div><span className="font-medium">Interval:</span> {visibleIntervals[detailModal.chartIndex] || defaultInterval}</div>
                  </div>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setDetailModal({ show: false, chartIndex: -1 })}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Editable grid above the main chart grid */}
          <div className="w-full flex flex-col items-center mb-4">
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${gridWidth}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${gridHeight}, minmax(0, 1fr))`,
                maxWidth: 600,
                margin: '0 auto',
              }}
            >
              {Array.from({ length: maxCharts }).map((_, idx) => (
                <input
                  key={idx}
                  type="text"
                  value={editablePairs[idx] || ""}
                  onChange={e => handleEditablePairChange(idx, e.target.value)}
                  className="border rounded px-2 py-1 text-xs text-center bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100"
                  placeholder="PAIR"
                  style={{ minWidth: 0 }}
                />
              ))}
            </div>
            <button
              className="mt-2 px-4 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              onClick={handleSaveEditablePairs}
            >
              Save
            </button>
          </div>
        </>
      )}

      <div
        className="w-full grid gap-0"
        style={{
          gridTemplateColumns: `repeat(${gridWidth}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridHeight}, minmax(0, 1fr))`,
        }}
      >
        {visiblePairs.map((pair, idx) => {
          const isTechOpen = expandedTechIdx === idx;
          const isDetailOpen = expandedDetailIdx === idx;
          const isSidebarOpen = isTechOpen || isDetailOpen;
          return (
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
                  isGecko={pair.startsWith('GECKO:')}
                  geckoPoolAddress={(() => {
                    if (pair.startsWith('GECKO:')) {
                      const parts = pair.split(':');
                      return parts.length === 3 ? parts[2] : parts[1];
                    }
                    return undefined;
                  })()}
                />
              </div>
              
              {/* Permanent Sidebar - expandable for technicals or details */}
              <div className={`${isSidebarOpen ? "w-80" : "w-14"} transition-all duration-300 bg-gray-50 dark:bg-zinc-800 border-l border-gray-200 dark:border-zinc-700 flex flex-col items-center`}>
                {/* Chart Controls */}
                <div className="p-2 border-b border-gray-200 dark:border-zinc-700 flex flex-col gap-2 items-center w-full">
                  <button
                    className="w-8 h-8 flex items-center justify-center bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    onClick={() => handleRefreshChart(idx)}
                    title="Refresh chart with new symbol"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <button
                    className="w-8 h-8 flex items-center justify-center bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
                    onClick={() => handleRemoveChart(idx)}
                    title="Remove chart"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <button
                    className={`w-8 h-8 flex items-center justify-center ${isDetailOpen ? "bg-blue-700 text-white" : "bg-gray-300 dark:bg-zinc-600 text-gray-700 dark:text-gray-300"} rounded-md hover:bg-blue-600 transition-colors`}
                    onClick={() => {
                      setExpandedDetailIdx(isDetailOpen ? null : idx);
                      setExpandedTechIdx(null);
                    }}
                    title="Chart details"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0A9 9 0 11 3 12a9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <button
                    className={`w-8 h-8 flex items-center justify-center ${isTechOpen ? "bg-blue-700 text-white" : "bg-gray-300 dark:bg-zinc-600 text-gray-700 dark:text-gray-300"} rounded-md hover:bg-blue-600 transition-colors`}
                    onClick={() => {
                      setExpandedTechIdx(isTechOpen ? null : idx);
                      setExpandedDetailIdx(null);
                    }}
                    title="Technicals"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                </div>
                {/* Sidebar Content Area (details or technicals) */}
                <div className="flex-1 p-2 flex flex-col items-center justify-center w-full">
                  {isDetailOpen && (
                    <div className="w-full">
                      <div className="font-medium text-xs text-gray-700 dark:text-gray-200 mb-2">Chart Info</div>
                      <div className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                        <div className="space-y-1">
                          <div><span className="font-medium">Symbol:</span> {pair}</div>
                          <div><span className="font-medium">Interval:</span> {visibleIntervals[idx] || defaultInterval}</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {isTechOpen && (
                    <div className="w-full">
                      <div className="font-medium text-xs text-gray-700 dark:text-gray-200 mb-2">Technicals</div>
                      <div className="tradingview-widget-container" style={{ minHeight: 350, width: '100%' }}>
                        <div id={`tv-tech-widget-${idx}`}></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
