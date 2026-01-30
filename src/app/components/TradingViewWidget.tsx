"use client";
import { useEffect, useRef, useState } from "react";
import PolymarketWidget from "./PolymarketWidget";

interface TradingViewWidgetProps {
  symbol: string;
  width?: string | number;
  height?: string | number;
  interval?: string;
  onSymbolChange?: (symbol: string) => void;
  onIntervalChange?: (interval: string) => void;
  isGecko?: boolean;
  geckoPoolAddress?: string;
  isHLWhale?: boolean;
  hlWhaleType?: 'stream' | 'holders';
  hlWhaleToken?: string;
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

export default function TradingViewWidget({ symbol, width = "100%", height = 400, interval = "D", onSymbolChange, onIntervalChange, isGecko = false, geckoPoolAddress, isHLWhale = false, hlWhaleType, hlWhaleToken, isPolymarket = false, polymarketMarketId, refreshKey = 0, autoRefreshEnabled = false }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const systemTheme = useSystemTheme();
  const lastSymbolRef = useRef(symbol);
  const lastIntervalRef = useRef(interval);

  // Always call hooks in the same order, regardless of isGecko, isHLWhale, or isPolymarket
  // Only render TradingView if not isGecko, not isHLWhale, and not isPolymarket
  useEffect(() => {
    if (isGecko || isHLWhale || isPolymarket || !containerRef.current) return;
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
  }, [isGecko, isHLWhale, isPolymarket, symbol, interval, systemTheme]);

  // Polling hack: check for symbol and interval changes in the widget DOM
  useEffect(() => {
    if (isGecko || isHLWhale || isPolymarket || !onSymbolChange && !onIntervalChange) return;
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
  }, [isGecko, isHLWhale, isPolymarket, onSymbolChange, onIntervalChange, symbol, interval]);

  // Listen for symbol and interval change events from the widget
  useEffect(() => {
    if (isGecko || isHLWhale || isPolymarket || !onSymbolChange && !onIntervalChange) return;
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
  }, [isGecko, isHLWhale, isPolymarket, onSymbolChange, onIntervalChange]);

  // Track interval prop changes
  useEffect(() => {
    if (isGecko || isHLWhale || isPolymarket) return;
    if (interval !== lastIntervalRef.current) {
      lastIntervalRef.current = interval;
      if (onIntervalChange) onIntervalChange(interval);
    }
  }, [isGecko, isHLWhale, isPolymarket, interval, onIntervalChange]);

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

  // Handle Hyperliquid whale widget rendering
  if (isHLWhale) {
    // Build CoinGlass URL based on widget type
    const baseUrl = 'https://www.coinglass.com/hyperliquid';
    // CoinGlass uses dark theme by default, we'll pass theme parameter if supported
    const themeParam = systemTheme === 'dark' ? '' : ''; // CoinGlass doesn't have documented theme params
    const coinglassUrl = hlWhaleToken
      ? `${baseUrl}?symbol=${hlWhaleToken.toUpperCase()}${themeParam}`
      : `${baseUrl}${themeParam}`;

    const widgetLabel = hlWhaleType === 'stream' ? 'Position Stream' : 'Top Holders';
    const tokenLabel = hlWhaleToken ? hlWhaleToken.toUpperCase() : 'All';

    // CSS crop values to show ONLY "Latest Whale Activity" section
    // These may need adjustment if CoinGlass changes their layout
    const cropTop = 330; // pixels to crop from top (header + nav + filter controls + ads)
    const cropLeft = 570; // pixels to crop from left (hide Position Stats panel)

    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
        <iframe
          key={refreshKey}
          src={coinglassUrl}
          style={{
            position: 'absolute',
            top: `-${cropTop}px`,
            left: `-${cropLeft}px`,
            width: '200%',
            height: '1050px',
            border: 'none',
          }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          allowFullScreen
          loading="lazy"
          title={`Hyperliquid Whale ${widgetLabel} - ${tokenLabel}`}
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
