export const ALERT_INTERVALS = [
  { value: "1", label: "1m", ms: 60_000 },
  { value: "3", label: "3m", ms: 180_000 },
  { value: "5", label: "5m", ms: 300_000 },
  { value: "15", label: "15m", ms: 900_000 },
  { value: "30", label: "30m", ms: 1_800_000 },
  { value: "60", label: "1h", ms: 3_600_000 },
  { value: "120", label: "2h", ms: 7_200_000 },
  { value: "240", label: "4h", ms: 14_400_000 },
  { value: "D", label: "1d", ms: 86_400_000 },
  { value: "W", label: "1w", ms: 604_800_000 },
] as const;

export interface CandleFeed {
  symbol: string;
  interval: string;
  upstreamInterval: string;
  intervalMs: number;
  venue: "binance-spot" | "binance-perp" | "hyperliquid";
  ticker: string;
  dex: string;
  label: string;
}

/** Explicit instrument mappings only: never substitute another exchange or spot for a perp. */
export function resolveCandleFeed(symbol: string, interval: string): CandleFeed | string {
  const canonical = interval === "1D" ? "D" : interval === "1W" ? "W" : interval;
  const period = ALERT_INTERVALS.find(item => item.value === canonical);
  if (!period) return "Alerts support 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1d and 1w candles. Choose one below.";
  const match = /^([A-Z0-9]{2,24}):([A-Z0-9_]{2,40})(\.P)?$/.exec(symbol);
  if (!match) return "No candle feed is connected for this symbol.";
  const [, exchange, ticker, perpetual] = match;
  const base = { symbol, interval: canonical, upstreamInterval: period.label, intervalMs: period.ms, dex: "" };
  if (exchange === "BINANCE") {
    if (perpetual && !/(?:USDT|USDC)$/.test(ticker)) return "Binance alerts currently support spot and USDT/USDC perpetuals only.";
    return { ...base, venue: perpetual ? "binance-perp" : "binance-spot", ticker, label: perpetual ? "Binance USDⓈ-M perpetual" : "Binance spot" };
  }
  if (exchange === "HYPERLIQUID" || /^HIP3[A-Z0-9]+$/.test(exchange)) {
    if (!perpetual || !ticker.endsWith("USDC")) return "Hyperliquid alerts currently support USDC perpetual chart symbols only; spot mappings are not connected.";
    const dex = exchange === "HYPERLIQUID" ? "" : exchange.slice(4).toLowerCase();
    return { ...base, venue: "hyperliquid", ticker: ticker.slice(0, -4), dex, label: dex ? `Hyperliquid · ${dex}` : "Hyperliquid perpetual" };
  }
  return "No candle feed is connected for this exchange yet. Alerts support Binance spot / USDT or USDC perps and Hyperliquid / HIP-3 perps.";
}
