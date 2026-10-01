import type { TrendQuote, TrendResult } from "./trends.ts";
import { getTrendFeed, getTrendPreset, normalizeTrendSymbol } from "./trends.ts";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** This parser expects range=1d; chartPreviousClose is relative to the requested range. */
export function parseTrendQuote(symbol: string, payload: unknown, fetchedAt: number): TrendQuote {
  const chart = record(record(payload).chart);
  const result = record(Array.isArray(chart.result) ? chart.result[0] : null);
  const meta = record(result.meta);
  const indicators = record(result.indicators);
  const bar = record(Array.isArray(indicators.quote) ? indicators.quote[0] : null);
  const times = Array.isArray(result.timestamp) ? result.timestamp : [];
  const index = times.length - 1;
  const at = (field: string) => number(Array.isArray(bar[field]) ? bar[field][index] : null);
  const price = number(meta.regularMarketPrice) ?? at("close");
  const asOf = number(meta.regularMarketTime) ?? number(times[index]);
  if (chart.error || price === null || asOf === null || asOf <= 0) {
    throw new Error("Quote unavailable. Check the symbol or try again later.");
  }
  const previousClose = number(meta.chartPreviousClose);
  return {
    symbol,
    name: typeof meta.longName === "string" ? meta.longName : typeof meta.shortName === "string" ? meta.shortName : symbol,
    currency: getTrendPreset(symbol)?.yield ? "" : typeof meta.currency === "string" ? meta.currency : "",
    price,
    previousClose,
    open: at("open"),
    high: number(meta.regularMarketDayHigh) ?? at("high"),
    low: number(meta.regularMarketDayLow) ?? at("low"),
    asOf: asOf * 1000,
    fetchedAt,
    source: "yahoo",
    exchange: typeof meta.fullExchangeName === "string" ? meta.fullExchangeName : undefined,
    delayed: typeof meta.exchangeDataDelayedBy === "number" ? meta.exchangeDataDelayedBy > 0 : undefined,
  };
}

/** CNBC's Treasury OHLC fields are yields; bond_*_price fields are a different instrument value. */
export function parseCnbcTrendQuote(symbol: string, payload: unknown, fetchedAt: number): TrendQuote {
  const feed = getTrendFeed(symbol);
  const quotes = record(record(payload).QuickQuoteResult).QuickQuote;
  const quote = record(Array.isArray(quotes) ? quotes.find(q => record(q).symbol === feed?.providerSymbol) : null);
  const numeric = (value: unknown) => typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())
    ? number(Number(value)) : number(value);
  const price = numeric(quote.last);
  // CNBC's numeric timestamp can apply the wrong timezone to foreign markets,
  // or even contain the request time for a date-only quote. Prefer the dated quote.
  let asOf: number | null = null;
  let asOfDate: string | undefined;
  if (typeof quote.last_time === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(quote.last_time)) {
      const time = Date.parse(`${quote.last_time}T00:00:00Z`);
      if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === quote.last_time) {
        asOf = time;
        asOfDate = quote.last_time;
      }
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(quote.last_time)) {
      asOf = number(Date.parse(quote.last_time));
    }
  } else {
    asOf = numeric(quote.last_time_msec);
  }
  if (feed?.source !== "cnbc" || String(quote.code) !== "0" || quote.assetType !== feed.cnbcType || price === null || asOf === null || asOf <= 0 || !Number.isFinite(new Date(asOf).getTime())) {
    throw new Error("Intraday quote unavailable. Retrying in a minute.");
  }
  return {
    symbol,
    name: typeof quote.name === "string" ? quote.name : symbol,
    currency: getTrendPreset(symbol)?.yield ? "" : typeof quote.currencyCode === "string" ? quote.currencyCode : "",
    price,
    previousClose: numeric(quote.previous_day_closing),
    open: numeric(quote.open),
    high: numeric(quote.high),
    low: numeric(quote.low),
    asOf,
    asOfDate,
    fetchedAt,
    source: "cnbc",
    exchange: typeof quote.exchange === "string" ? quote.exchange : undefined,
    delayed: quote.realTime === "false" ? true : quote.realTime === "true" ? false : undefined,
  };
}

/** FRED CSVs contain daily observations; never manufacture a candle from them. */
export function parseFredTrendQuote(symbol: string, csv: string, fetchedAt: number): TrendQuote {
  const feed = getTrendFeed(symbol);
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (feed?.source !== "fred" || header !== `observation_date,${feed.providerSymbol}`) throw new Error("Daily rate data unavailable.");
  const observations = new Map<string, number>();
  const today = new Date(fetchedAt).toISOString().slice(0, 10);
  for (const line of lines) {
    const [date, raw] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || !raw?.trim() || raw === ".") continue;
    const value = Number(raw);
    const time = Date.parse(`${date}T00:00:00Z`);
    if (Number.isFinite(value) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date) observations.set(date, value);
  }
  const points = [...observations].sort(([a], [b]) => a.localeCompare(b));
  const last = points.at(-1);
  if (!last) throw new Error("Daily rate data unavailable.");
  return {
    symbol,
    name: getTrendPreset(symbol)?.description ?? symbol,
    currency: "",
    price: last[1],
    previousClose: points.at(-2)?.[1] ?? null,
    open: null, high: null, low: null,
    asOf: Date.parse(`${last[0]}T00:00:00Z`),
    fetchedAt,
    source: "fred",
    observationDate: last[0],
  };
}

const CACHE_MS = 60_000;
const DAILY_CACHE_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 128;

/** Bounded snapshots and shared in-flight requests; failures retain the original timestamps. */
export function createTrendQuoteLoader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { result: TrendResult; expires: number }>();
  const pending = new Map<string, Promise<TrendResult>>();

  return function getQuote(value: string): Promise<TrendResult> {
    const symbol = normalizeTrendSymbol(value);
    if (!symbol) return Promise.resolve({ symbol: value, quote: null, error: "Unsupported market or source." });
    const existing = cache.get(symbol);
    if (existing && existing.expires > now()) return Promise.resolve(existing.result);
    const inflight = pending.get(symbol);
    if (inflight) return inflight;

    const request = (async (): Promise<TrendResult> => {
      let result: TrendResult;
      const feed = getTrendFeed(symbol)!;
      const fredSeries = feed.source === "fred" ? feed.providerSymbol : null;
      const cnbcSymbol = feed.source === "cnbc" ? feed.providerSymbol : null;
      try {
        // Only the last three weeks are needed for two valid observations across weekends/holidays.
        const since = new Date(now() - 21 * 86_400_000).toISOString().slice(0, 10);
        const response = await fetcher(
          fredSeries
            ? `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(fredSeries)}&cosd=${since}`
            : cnbcSymbol
            ? `https://quote.cnbc.com/quote-html-webservice/quote.htm?symbols=${encodeURIComponent(cnbcSymbol)}&noform=1&partnerId=2&output=json`
            : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(feed.providerSymbol)}?interval=1d&range=1d`,
          {
            cache: "no-store",
            headers: { "User-Agent": "Mozilla/5.0", Accept: fredSeries ? "text/csv" : "application/json" },
            signal: AbortSignal.timeout(8_000),
          },
        );
        if (!response.ok) throw new Error(response.status === 429
          ? "Quote provider is busy. Retrying in a minute."
          : "Quote unavailable. Check the symbol or try again later.");
        const quote = fredSeries
          ? parseFredTrendQuote(symbol, await response.text(), now())
          : cnbcSymbol
          ? parseCnbcTrendQuote(symbol, await response.json(), now())
          : parseTrendQuote(symbol, await response.json(), now());
        result = { symbol, quote, error: null };
      } catch (error) {
        result = {
          symbol,
          quote: existing?.result.quote ?? null,
          error: error instanceof Error && error.name !== "TimeoutError" ? error.message : "Quote request timed out. Retrying in a minute.",
        };
      }
      cache.delete(symbol);
      cache.set(symbol, { result, expires: now() + (fredSeries && !result.error ? DAILY_CACHE_MS : CACHE_MS) });
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      return result;
    })().finally(() => pending.delete(symbol));
    pending.set(symbol, request);
    return request;
  };
}

export const getTrendQuote = createTrendQuoteLoader();
