export type TrendDisplay = "range" | "compact" | "ohlc";
export type TrendSide = "left" | "right";
export interface TrendConfig {
  left: string[];
  right: string[];
  display: TrendDisplay;
}

export const MAX_TRENDS_PER_SIDE = 4;
export const TREND_STORAGE_KEY = "mcc.trends.v1";
export const TREND_CATEGORIES = ["Rates", "Indices", "FX", "Commodities", "Crypto"] as const;
export type TrendCategory = typeof TREND_CATEGORIES[number];
export type TrendSource = "yahoo" | "cnbc" | "fred";
export interface TrendFeed {
  /** Persist the feed, not just the market, so source choices survive sharing and reloads. */
  symbol: string;
  source: TrendSource;
  providerSymbol: string;
  label: string;
  description: string;
  cnbcType?: "BOND" | "INDEX" | "CURRENCY" | "DERIVATIVE";
}
export interface TrendPreset {
  symbol: string;
  label: string;
  description: string;
  category: TrendCategory;
  yield?: boolean;
  /** The first feed is the category's default for this instrument. */
  sources: TrendFeed[];
  aliases: string[];
}

const yahoo = (symbol: string, description = "Yahoo Finance session OHLC. Quotes may be delayed.", label = "Yahoo Finance", id = symbol): TrendFeed => ({
  symbol: id, providerSymbol: symbol, source: "yahoo", label, description,
});
const cnbc = (symbol: string, cnbcType: TrendFeed["cnbcType"], description = "CNBC session OHLC. Quotes may be delayed.", label = "CNBC"): TrendFeed => ({
  symbol: `CNBC:${symbol}`, providerSymbol: symbol, source: "cnbc", label, description, cnbcType,
});
const fred = (symbol: string): TrendFeed => ({
  symbol: `FRED:${symbol}`, providerSymbol: symbol, source: "fred", label: "FRED · daily",
  description: "Federal Reserve daily observations. No intraday OHLC.",
});
function market(label: string, description: string, category: TrendCategory, sources: TrendFeed[], aliases: string[] = [], isYield = false): TrendPreset {
  return { symbol: sources[0].symbol, label, description, category, sources, aliases, yield: isYield };
}
function treasury(label: string, maturity: string, symbol: string, oldFred: string, cboe?: string): TrendPreset {
  const sources = [cnbc(symbol, "BOND", "Intraday Treasury benchmark yield from Tradeweb via CNBC, with session OHLC.", "CNBC · Tradeweb")];
  if (cboe) sources.push(yahoo(cboe, "Cboe Treasury yield index via Yahoo. Intraday OHLC; benchmark and session can differ from Tradeweb.", "Yahoo · Cboe", `YAHOO:${cboe}`));
  return market(label, `US ${maturity} Treasury yield`, "Rates", sources, [symbol, `TVC:${label}`, `FRED:${oldFred}`, ...(cboe ? [cboe] : [])], true);
}
function indexMarket(label: string, description: string, yahooSymbol: string, cnbcSymbol: string, aliases: string[] = []): TrendPreset {
  return market(label, description, "Indices", [yahoo(yahooSymbol), cnbc(cnbcSymbol, "INDEX")], aliases);
}
function fx(label: string, description: string, yahooSymbol: string, cnbcSymbol: string, aliases: string[]): TrendPreset {
  return market(label, description, "FX", [
    yahoo(yahooSymbol, "Yahoo Finance FX session OHLC. Quote contributors and daily cutoff can differ from CNBC."),
    cnbc(cnbcSymbol, "CURRENCY", "CNBC FX session OHLC. Quote contributors and daily cutoff can differ from Yahoo."),
  ], aliases);
}
function commodity(label: string, description: string, yahooSymbol: string, cnbcSymbol?: string, aliases: string[] = []): TrendPreset {
  const sources = [yahoo(yahooSymbol, "Yahoo Finance futures session OHLC. Quotes may be delayed; check the current contract in the card details.")];
  if (cnbcSymbol) sources.push(cnbc(cnbcSymbol, "DERIVATIVE", "CNBC futures session OHLC from the same exchange. Quotes may be delayed; contract roll timing can differ."));
  return market(label, description, "Commodities", sources, aliases);
}
function crypto(label: string, name: string): TrendPreset {
  return market(label, `${name} / USD`, "Crypto", [
    yahoo(`${label}-USD`, "Yahoo Finance USD spot quote. Aggregation and daily cutoff differ from Coin Metrics."),
    cnbc(`${label}.CM=`, "INDEX", "Coin Metrics USD reference quote via CNBC. Aggregation and daily cutoff differ from Yahoo.", "CNBC · Coin Metrics"),
  ]);
}

export const TREND_SOURCE_NOTES: Record<TrendCategory, string> = {
  Rates: "Treasuries default to CNBC / Tradeweb. SOFR and Fed funds use FRED daily observations (†).",
  Indices: "Default: Yahoo Finance. CNBC is also available for each index; delays can differ.",
  FX: "Default: Yahoo Finance. CNBC is also available; daily cutoffs and quote contributors can differ.",
  Commodities: "Default: Yahoo Finance futures. CNBC alternatives use the same exchange; contract rolls can differ. Brent uses Yahoo / NYMEX only.",
  Crypto: "Default: Yahoo Finance. CNBC / Coin Metrics is also available; aggregation and daily cutoffs differ.",
};

export const TREND_PRESETS: TrendPreset[] = [
  treasury("US01M", "1-month", "US1M", "DGS1MO"),
  treasury("US03M", "3-month", "US3M", "DGS3MO"),
  treasury("US06M", "6-month", "US6M", "DGS6MO"),
  treasury("US01Y", "1-year", "US1Y", "DGS1"),
  treasury("US02Y", "2-year", "US2Y", "DGS2"),
  treasury("US03Y", "3-year", "US3Y", "DGS3"),
  treasury("US05Y", "5-year", "US5Y", "DGS5", "^FVX"),
  treasury("US07Y", "7-year", "US7Y", "DGS7"),
  treasury("US10Y", "10-year", "US10Y", "DGS10", "^TNX"),
  treasury("US20Y", "20-year", "US20Y", "DGS20"),
  treasury("US30Y", "30-year", "US30Y", "DGS30", "^TYX"),
  market("SOFR", "Secured overnight financing rate", "Rates", [fred("SOFR")], [], true),
  market("FEDFUNDS", "Effective federal funds rate", "Rates", [fred("DFF")], ["EFFR"], true),
  indexMarket("SPX", "S&P 500", "^GSPC", ".SPX", ["SP500", "SP:SPX"]),
  indexMarket("NDX", "Nasdaq 100", "^NDX", ".NDX", ["NASDAQ:NDX"]),
  indexMarket("DJI", "Dow Jones Industrial Average", "^DJI", ".DJI", ["DOW"]),
  indexMarket("RUT", "Russell 2000", "^RUT", ".RUT", ["RUSSELL2000"]),
  indexMarket("VIX", "Cboe Volatility Index", "^VIX", ".VIX", ["CBOE:VIX"]),
  indexMarket("DAX", "Germany DAX", "^GDAXI", ".GDAXI"),
  indexMarket("FTSE", "UK FTSE 100", "^FTSE", ".FTSE", ["FTSE100"]),
  indexMarket("NIKKEI", "Japan Nikkei 225", "^N225", ".N225", ["NIKKEI225"]),
  indexMarket("HSI", "Hong Kong Hang Seng", "^HSI", ".HSI", ["HANGSENG"]),
  market("DXY", "US Dollar Index", "FX", [yahoo("DX-Y.NYB"), cnbc(".DXY", "INDEX")], ["TVC:DXY"]),
  fx("EURUSD", "Euro / US dollar", "EURUSD=X", "EUR=", ["EUR/USD"]),
  fx("USDJPY", "US dollar / Japanese yen", "JPY=X", "JPY=", ["USD/JPY"]),
  fx("GBPUSD", "British pound / US dollar", "GBPUSD=X", "GBP=", ["GBP/USD"]),
  fx("AUDUSD", "Australian dollar / US dollar", "AUDUSD=X", "AUD=", ["AUD/USD"]),
  fx("USDCAD", "US dollar / Canadian dollar", "CAD=X", "CAD=", ["USD/CAD"]),
  fx("USDCHF", "US dollar / Swiss franc", "CHF=X", "CHF=", ["USD/CHF"]),
  fx("USDCNH", "US dollar / offshore Chinese yuan", "CNH=X", "CNH=", ["USD/CNH"]),
  commodity("GOLD", "Gold futures", "GC=F", "@GC.1"),
  commodity("SILVER", "Silver futures", "SI=F", "@SI.1"),
  commodity("COPPER", "Copper futures", "HG=F", "@HG.1"),
  commodity("WTI", "WTI crude oil futures", "CL=F", "@CL.1", ["OIL"]),
  // CNBC's @LCO.1 is ICE Brent, not the NYMEX contract represented by Yahoo's BZ=F.
  commodity("BRENT", "NYMEX Brent crude oil futures", "BZ=F"),
  commodity("NATGAS", "Natural gas futures", "NG=F", "@NG.1", ["NATURALGAS"]),
  crypto("BTC", "Bitcoin"),
  crypto("ETH", "Ethereum"),
  crypto("SOL", "Solana"),
];

export const DEFAULT_TRENDS: TrendConfig = {
  left: ["CNBC:US10Y", "DX-Y.NYB"],
  right: ["BTC-USD", "ETH-USD"],
  display: "range",
};

export function normalizeTrendSymbol(value: string): string | null {
  const symbol = value.trim().toUpperCase();
  // Explicit source selections win over market aliases and default migrations.
  if (TREND_PRESETS.some(p => p.sources.some(feed => feed.symbol === symbol))) return symbol;
  const preset = TREND_PRESETS.find(p => p.symbol === symbol || p.label === symbol || p.aliases.includes(symbol));
  if (preset) return preset.symbol;
  // Yahoo tickers only: no URLs, expressions, or unrecognised exchange prefixes.
  return /^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/.test(symbol) ? symbol : null;
}

export function getTrendPreset(value: string): TrendPreset | undefined {
  const symbol = normalizeTrendSymbol(value);
  return TREND_PRESETS.find(p => p.sources.some(feed => feed.symbol === symbol));
}

export function getTrendFeed(value: string): TrendFeed | null {
  const symbol = normalizeTrendSymbol(value);
  if (!symbol) return null;
  return getTrendPreset(symbol)?.sources.find(feed => feed.symbol === symbol) ?? yahoo(symbol);
}

function symbolList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(s => typeof s === "string")) return null;
  const symbols = value.map(normalizeTrendSymbol);
  if (symbols.some(s => s === null)) return null;
  return [...new Set(symbols as string[])].slice(0, MAX_TRENDS_PER_SIDE);
}

function isDisplay(value: unknown): value is TrendDisplay {
  return value === "range" || value === "compact" || value === "ohlc";
}

/** An explicitly empty URL list hides that side; absent URL values use saved preferences. */
export function parseTrendConfig(params: URLSearchParams, saved: unknown = null): TrendConfig {
  const stored = saved && typeof saved === "object" ? saved as Partial<TrendConfig> : {};
  const readSide = (side: TrendSide, key: string) => {
    const raw = params.get(key);
    if (raw !== null) return symbolList(raw === "" ? [] : raw.split(",")) ?? [...DEFAULT_TRENDS[side]];
    return symbolList(stored[side]) ?? [...DEFAULT_TRENDS[side]];
  };
  const display = params.get("td") ?? stored.display;
  return {
    left: readSide("left", "tl"),
    right: readSide("right", "tr"),
    display: isDisplay(display) ? display : DEFAULT_TRENDS.display,
  };
}

export function writeTrendParams(params: URLSearchParams, config: TrendConfig): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("tl", config.left.join(","));
  next.set("tr", config.right.join(","));
  next.set("td", config.display);
  return next;
}

export interface TrendQuote {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  asOf: number;
  fetchedAt: number;
  source?: TrendSource;
  exchange?: string;
  delayed?: boolean;
  /** Some closed-market quotes provide a date but no reliable time of day. */
  asOfDate?: string;
  /** Daily series have an observation date, not an intraday quote time or OHLC. */
  observationDate?: string;
}

export interface TrendResult {
  symbol: string;
  quote: TrendQuote | null;
  error: string | null;
}

export function trendChange(quote: TrendQuote): { value: number; unit: "%" | "bp" } | null {
  if (quote.previousClose === null) return null;
  const delta = quote.price - quote.previousClose;
  // All rate providers quote in percentage points. Changes also work across zero.
  if (getTrendPreset(quote.symbol)?.yield) return { value: delta * 100, unit: "bp" };
  return quote.previousClose > 0 ? { value: delta / quote.previousClose * 100, unit: "%" } : null;
}
