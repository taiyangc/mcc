"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import PolymarketWidget from "./PolymarketWidget";
import GexWidget from "./GexWidget";
import HypeUnstakingWidget from "./HypeUnstakingWidget";
import HyperliquidPanel from "./hl/HyperliquidPanel";
import { parseHlPanel } from "../lib/hl/panels";
import { useSystemTheme } from "../lib/useSystemTheme";

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
  isUnstaking?: boolean;
  /** Writes an edited panel configuration back to this cell's pair string. */
  onPairChange?: (pair: string) => void;
  refreshKey?: number;
}

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  } catch {
    return "Etc/UTC";
  }
}

// The free Advanced Chart is a third-party iframe with no public dispose or price-scale
// API. Replacing its iframe bounds a long-running chart's memory and restores its initial
// price scale. Stagger renewals so a dashboard does not reload every chart at once.
const TV_MAX_LIFETIME_MS = 20 * 60_000;
const TV_RENEWAL_JITTER_MS = 2 * 60_000;

export default function TradingViewWidget({ symbol, width = "100%", height = 400, interval = "D", onSymbolChange, onIntervalChange, isGecko = false, geckoPoolAddress, isGex = false, gexCurrency, gexExchange, isEmbed = false, embedUrl, embedCropTop, embedCropLeft, embedScale, isPolymarket = false, polymarketMarketId, isUnstaking = false, onPairChange, refreshKey = 0 }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const systemTheme = useSystemTheme();
  const onSymbolChangeRef = useRef(onSymbolChange);
  const onIntervalChangeRef = useRef(onIntervalChange);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [renewal, setRenewal] = useState(0);

  useEffect(() => {
    onSymbolChangeRef.current = onSymbolChange;
    onIntervalChangeRef.current = onIntervalChange;
  }, [onSymbolChange, onIntervalChange]);

  // Parsing here (not in the page's render loop) keeps the spec object stable across the
  // page re-renders that the auto-refresh tick causes.
  const hlPanel = useMemo(() => parseHlPanel(symbol), [symbol]);

  // Every non-TradingView widget short-circuits the chart effects. One flag keeps the
  // guards and their dependency arrays in step as widget types are added.
  const isNonTv = isGecko || isEmbed || isGex || isPolymarket || isUnstaking || !!hlPanel;

  useEffect(() => {
    if (isNonTv || !containerRef.current) return;
    const container = containerRef.current;
    if (!('IntersectionObserver' in window)) return;
    // Lazy-load once, then retain the iframe when scrolling away or changing tabs.
    // Tearing it down on visibility changes discards the chart's current view.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasEnteredViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [isNonTv]);

  useEffect(() => {
    if (isNonTv) return;
    const updateVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, [isNonTv]);

  const showTv = !isNonTv && hasEnteredViewport;

  useEffect(() => {
    // Pause maintenance while hidden without touching the mounted chart. Start a new
    // countdown on return so background timer throttling cannot cause a reload burst.
    if (!showTv || !pageVisible) return;
    const timer = window.setTimeout(
      () => {
        if (!document.hidden) setRenewal(value => value + 1);
      },
      TV_MAX_LIFETIME_MS + Math.random() * TV_RENEWAL_JITTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [showTv, pageVisible, symbol, interval, systemTheme, refreshKey, renewal]);

  useEffect(() => {
    if (!showTv || !containerRef.current) return;
    const container = containerRef.current;
    container.replaceChildren();
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: getBrowserTimezone(),
      theme: systemTheme,
      style: "1",
      locale: "en",
      allow_symbol_change: true,
    });
    container.appendChild(script);
    return () => {
      // Remove the loader and the iframe it created. Capturing this node matters when
      // React reuses the component for a different chart after a grid reorder.
      script.remove();
      container.replaceChildren();
    };
  }, [showTv, symbol, interval, systemTheme, refreshKey, renewal]);

  // The embed may report a symbol change by postMessage or by changing its iframe title.
  // Scope both paths to this iframe; messages from other grid cells must never change it.
  useEffect(() => {
    if (!showTv) return;
    let lastSymbol = symbol;
    let receivedSymbolMessage = false;
    const poll = () => {
      if (document.hidden || receivedSymbolMessage) return;
      const widget = containerRef.current?.querySelector("iframe");
      if (widget) {
        const title = widget.getAttribute("title") || "";
        const symbolMatch = title.match(/([A-Z0-9_.-]+:[A-Z0-9_.-]+)/i);
        if (symbolMatch && symbolMatch[1] !== lastSymbol) {
          lastSymbol = symbolMatch[1];
          onSymbolChangeRef.current?.(lastSymbol);
        }
      }
    };
    function handleMessage(e: MessageEvent) {
      const frame = containerRef.current?.querySelector("iframe");
      if (!frame || e.source !== frame.contentWindow) return;
      if (typeof e.data !== "object" || !e.data) return;
      const eventName = e.data.name ?? e.data.eventName;
      if (eventName === "onSymbolChange" && typeof e.data.data?.symbol === "string") {
        receivedSymbolMessage = true;
        const nextSymbol = e.data.data.symbol;
        if (nextSymbol !== lastSymbol) {
          lastSymbol = nextSymbol;
          onSymbolChangeRef.current?.(nextSymbol);
        }
      }
      if (eventName === "onIntervalChange" && typeof e.data.data?.interval === "string") {
        onIntervalChangeRef.current?.(e.data.data.interval);
      }
    }
    const timer = window.setInterval(poll, 1000);
    window.addEventListener("message", handleMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("message", handleMessage);
    };
  }, [showTv, symbol, interval, systemTheme, refreshKey, renewal]);

  // Handle Hyperliquid data panel rendering
  if (hlPanel) {
    return (
      <HyperliquidPanel
        spec={hlPanel}
        refreshKey={refreshKey}
        height={typeof height === 'number' ? height : 350}
        onPairChange={onPairChange}
      />
    );
  }

  // Handle Unstaking widget rendering
  if (isUnstaking) {
    return (
      <HypeUnstakingWidget
        refreshKey={refreshKey}
        height={typeof height === 'number' ? height : 350}
      />
    );
  }

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
