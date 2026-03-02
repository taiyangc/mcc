"use client";
import { useEffect, useRef, useState } from "react";
import PolymarketWidget from "./PolymarketWidget";
import GexWidget from "./GexWidget";

interface TradingViewWidgetProps {
  symbol: string;
  width?: string | number;
  height?: string | number;
  interval?: string;
  onSymbolChange?: (symbol: string) => void;
  onIntervalChange?: (interval: string) => void;
  isGecko?: boolean;
  geckoPoolAddress?: string;
  isEmbed?: boolean;
  embedUrl?: string;
  embedCropTop?: number;
  embedCropLeft?: number;
  embedScale?: number;
  isGex?: boolean;
  gexCurrency?: string;
  gexExchange?: string;
  isPolymarket?: boolean;
  polymarketMarketId?: string;
  refreshKey?: number;
  autoRefreshEnabled?: boolean;
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

export default function TradingViewWidget({ symbol, width = "100%", height = 400, interval = "D", onSymbolChange, onIntervalChange, isGecko = false, geckoPoolAddress, isGex = false, gexCurrency, gexExchange, isEmbed = false, embedUrl, embedCropTop, embedCropLeft, embedScale, isPolymarket = false, polymarketMarketId, refreshKey = 0, autoRefreshEnabled = false }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const systemTheme = useSystemTheme();
  const lastSymbolRef = useRef(symbol);
  const lastIntervalRef = useRef(interval);

  // Always call hooks in the same order, regardless of isGecko, isEmbed, or isPolymarket
  // Only render TradingView if not isGecko, not isEmbed, not isGex, and not isPolymarket
  useEffect(() => {
    if (isGecko || isEmbed || isGex || isPolymarket || !containerRef.current) return;
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
  }, [isGecko, isEmbed, isGex, isPolymarket, symbol, interval, systemTheme]);

  // Polling hack: check for symbol and interval changes in the widget DOM
  useEffect(() => {
    if (isGecko || isEmbed || isGex || isPolymarket || !onSymbolChange && !onIntervalChange) return;
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
  }, [isGecko, isEmbed, isGex, isPolymarket, onSymbolChange, onIntervalChange, symbol, interval]);

  // Listen for symbol and interval change events from the widget
  useEffect(() => {
    if (isGecko || isEmbed || isGex || isPolymarket || !onSymbolChange && !onIntervalChange) return;
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
  }, [isGecko, isEmbed, isGex, isPolymarket, onSymbolChange, onIntervalChange]);

  // Track interval prop changes
  useEffect(() => {
    if (isGecko || isEmbed || isGex || isPolymarket) return;
    if (interval !== lastIntervalRef.current) {
      lastIntervalRef.current = interval;
      if (onIntervalChange) onIntervalChange(interval);
    }
  }, [isGecko, isEmbed, isGex, isPolymarket, interval, onIntervalChange]);

  // Handle Polymarket widget rendering
  if (isPolymarket && polymarketMarketId) {
    return (
      <PolymarketWidget
        marketId={polymarketMarketId}
        refreshKey={refreshKey}
        height={typeof height === 'number' ? height : 350}
      />
    );
  }

  // Handle GEX widget rendering
  if (isGex && gexCurrency) {
    return (
      <GexWidget
        currency={gexCurrency}
        exchange={gexExchange || 'DERIBIT'}
        refreshKey={refreshKey}
        height={typeof height === 'number' ? height : 350}
      />
    );
  }

  // Handle embedded page widget rendering
  if (isEmbed && embedUrl) {
    const s = (embedScale || 100) / 100;
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        <iframe
          key={refreshKey}
          src={embedUrl}
          style={{
            position: 'absolute',
            top: `${-(embedCropTop || 0)}px`,
            left: `${-(embedCropLeft || 0)}px`,
            width: `calc(${100 / s}% + ${(embedCropLeft || 0) / s}px)`,
            height: `calc(${100 / s}% + ${(embedCropTop || 0) / s}px)`,
            transform: `scale(${s})`,
            transformOrigin: 'top left',
            border: 'none',
          }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          allowFullScreen
          loading="lazy"
          title="Embedded Page"
        />
      </div>
    );
  }

  // Handle Gecko rendering after all hooks
  if (isGecko) {
    // Parse chain and address from symbol or geckoPoolAddress
    let geckoChain = 'polygon_pos';
    let geckoAddress = geckoPoolAddress;
    if (symbol.startsWith('GECKO:')) {
      const parts = symbol.split(':');
      if (parts.length === 3) {
        geckoChain = parts[1].toLowerCase();
        geckoAddress = parts[2];
      } else if (parts.length === 2) {
        geckoAddress = parts[1];
      }
    }
    if (!geckoAddress) {
      throw new Error('Invalid GeckoTerminal symbol: missing pool address.');
    }
    // Compose the GeckoTerminal embed URL as per example
    // light_chart=0 if dark, 1 if light
    const lightChart = systemTheme === 'dark' ? 0 : 1;
    // Map TradingView interval to GeckoTerminal resolution
    const intervalMap: Record<string, string> = {
      '1': '1m',
      '3': '3m',
      '5': '5m',
      '15': '15m',
      '30': '30m',
      '45': '45m',
      '60': '1h',
      '120': '2h',
      '180': '3h',
      '240': '4h',
      'D': '1d',
      'W': '1w',
      'M': '1M',
    };
    const mappedResolution = intervalMap[interval] || '1d';
    const geckoUrl = `https://www.geckoterminal.com/${geckoChain}/pools/${geckoAddress}?embed=1&info=0&swaps=0&light_chart=${lightChart}&resolution=${mappedResolution}`;
    console.log('GeckoTerminal iframe src:', geckoUrl);
    // Embed GeckoTerminal's own chart widget for the pool, fully expanded
    return (
      <iframe
        src={geckoUrl}
        style={{ width: '100%', height: '100%', border: 'none', borderRadius: 0, display: 'block' }}
        sandbox="allow-scripts allow-same-origin"
        allowFullScreen
        loading="lazy"
        title={`GeckoTerminal Pool`}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width, height }}
      className="tradingview-widget-container"
    />
  );
}
