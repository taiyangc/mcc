"use client";
import { useEffect, useRef, useState } from "react";

interface TradingViewWidgetProps {
  symbol: string;
  width?: string | number;
  height?: string | number;
  interval?: string;
  onSymbolChange?: (symbol: string) => void;
  onIntervalChange?: (interval: string) => void;
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

export default function TradingViewWidget({ symbol, width = "100%", height = 400, interval = "D", onSymbolChange, onIntervalChange }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const systemTheme = useSystemTheme();
  const lastSymbolRef = useRef(symbol);
  const lastIntervalRef = useRef(interval);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      theme: systemTheme,
      style: "1",
      locale: "en",
      allow_symbol_change: true,
    });
    containerRef.current.appendChild(script);
    return () => {
      containerRef.current && (containerRef.current.innerHTML = "");
    };
  }, [symbol, interval, systemTheme]);

  // Polling hack: check for symbol and interval changes in the widget DOM
  useEffect(() => {
    if (!onSymbolChange && !onIntervalChange) return;
    let polling = true;
    let lastSymbol = symbol;
    let lastInterval = interval;
    const poll = () => {
      if (!polling || !containerRef.current) return;
      // Try to find the symbol and interval in the widget DOM
      const widget = containerRef.current.querySelector("iframe");
      if (widget) {
        try {
          const title = widget.getAttribute("title") || "";
          // Example: "BINANCE:BTCUSDT Chart"
          const symbolMatch = title.match(/([A-Z0-9]+:[A-Z0-9]+)/);
          if (symbolMatch && symbolMatch[1] && symbolMatch[1] !== lastSymbol) {
            lastSymbol = symbolMatch[1];
            if (onSymbolChange) onSymbolChange(lastSymbol);
          }
          
          // Try to detect interval changes (this is more challenging as it's not in the title)
          // For now, we'll rely on the interval prop changes
        } catch {}
      }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 1000);
    return () => {
      polling = false;
    };
  }, [onSymbolChange, onIntervalChange, symbol, interval]);

  // Listen for symbol and interval change events from the widget
  useEffect(() => {
    if (!onSymbolChange && !onIntervalChange) return;
    function handleMessage(e: MessageEvent) {
      if (typeof e.data !== "object" || !e.data) return;
      // TradingView widget posts messages with eventName 'onSymbolChange'
      if (e.data.name === "onSymbolChange" && e.data.data && e.data.data.symbol) {
        if (onSymbolChange) onSymbolChange(e.data.data.symbol);
      }
      // Check for interval changes (if available)
      if (e.data.name === "onIntervalChange" && e.data.data && e.data.data.interval) {
        if (onIntervalChange) onIntervalChange(e.data.data.interval);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onSymbolChange, onIntervalChange]);

  // Track interval prop changes
  useEffect(() => {
    if (interval !== lastIntervalRef.current) {
      lastIntervalRef.current = interval;
      if (onIntervalChange) onIntervalChange(interval);
    }
  }, [interval, onIntervalChange]);

  return (
    <div
      ref={containerRef}
      style={{ width, height }}
      className="tradingview-widget-container"
    />
  );
} 