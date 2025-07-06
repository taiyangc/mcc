"use client";
import React, { useState, useEffect } from "react";
import TradingViewWidget from "./components/TradingViewWidget";

// Default pairs for demonstration
const DEFAULT_PAIRS = ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT"];

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

function updateUrl(pairs: string[], width: number, height: number) {
  const params = new URLSearchParams(window.location.search);
  params.set("pairs", pairs.join(","));
  params.set("width", String(width));
  params.set("height", String(height));
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
  const [interval, setInterval] = useState("D");

  // Load interval from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedInterval = localStorage.getItem("tvInterval");
      if (savedInterval) setInterval(savedInterval);
    }
  }, []);

  // Save interval to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("tvInterval", interval);
    }
  }, [interval]);

  // Keep URL in sync with pairs, width, and height
  useEffect(() => {
    updateUrl(pairs, gridWidth, gridHeight);
  }, [pairs, gridWidth, gridHeight]);

  // On mount, sync state with URL
  useEffect(() => {
    const urlPairs = parsePairsFromUrl();
    setPairs(urlPairs);
    const grid = parseGridFromUrl();
    setGridWidth(grid.width);
    setGridHeight(grid.height);
  }, []);

  const handleAddChart = () => {
    setPairs((prev) => [...prev, "BINANCE:BTCUSDT"]);
  };

  const handleRemoveChart = (idx: number) => {
    setPairs((prev) => prev.filter((_, i) => i !== idx));
  };

  // Share charts button handler
  const handleShareCharts = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
    }
  };

  // Calculate the number of charts to display based on grid size
  const maxCharts = gridWidth * gridHeight;
  const visiblePairs = pairs.slice(0, maxCharts);

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
      <div
        className="w-full grid gap-0"
        style={{
          gridTemplateColumns: `repeat(${gridWidth}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridHeight}, minmax(0, 1fr))`,
        }}
      >
        {visiblePairs.map((pair, idx) => (
          <div key={idx} className="relative bg-white dark:bg-zinc-900" style={{ minHeight: 350 }}>
            <button
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-white/80 dark:bg-zinc-800/80 hover:bg-red-100 dark:hover:bg-red-900 text-red-500 shadow z-10"
              onClick={() => handleRemoveChart(idx)}
              title="Remove chart"
            >
              ×
            </button>
            <TradingViewWidget
              symbol={pair}
              height={350}
              interval={interval}
              onSymbolChange={newSymbol => {
                setPairs(prev => {
                  const updated = [...prev];
                  updated[idx] = newSymbol;
                  // Immediately update URL after symbol change
                  updateUrl(updated, gridWidth, gridHeight);
                  return updated;
                });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
