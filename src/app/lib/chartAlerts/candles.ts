import { hlInfo, RateLimitError, sharedCache } from "../hl/client.ts";
import { validCandle } from "./validation.ts";
import type { CandleFeed } from "./markets.ts";
import type { Candle, CandleSnapshot } from "./types.ts";

const CANDLE_COUNT = 100;
const CACHE_MS = 25_000;

function numeric(value: unknown): number {
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
}

export function parseCandles(raw: unknown, venue: CandleFeed["venue"]): Candle[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("No candles returned for this market.");
  const candles = new Map<number, Candle>();
  for (const item of raw) {
    let c: Candle;
    if (venue === "hyperliquid") {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid candle data.");
      c = { time: numeric(item.t), endTime: numeric(item.T) + 1, open: numeric(item.o), high: numeric(item.h), low: numeric(item.l), close: numeric(item.c), volume: numeric(item.v) };
    } else {
      if (!Array.isArray(item) || item.length < 7) throw new Error("Invalid candle data.");
      c = { time: numeric(item[0]), endTime: numeric(item[6]) + 1, open: numeric(item[1]), high: numeric(item[2]), low: numeric(item[3]), close: numeric(item[4]), volume: numeric(item[5]) };
    }
    if (!validCandle(c)) throw new Error("Invalid candle data.");
    candles.set(c.time, c);
  }
  return [...candles.values()].sort((a, b) => a.time - b.time).slice(-CANDLE_COUNT);
}

/** Resolve actual API casing (e.g. kPEPE) and confirm that a HIP-3 market exists. */
export function resolveHyperliquidCoin(raw: unknown, ticker: string, dex: string): string {
  const universe = raw && typeof raw === "object" && "universe" in raw ? raw.universe : null;
  if (!Array.isArray(universe)) throw new Error("Hyperliquid market metadata is unavailable.");
  const expected = `${dex ? `${dex}:` : ""}${ticker}`.toUpperCase();
  const matches = universe.filter(asset => asset && typeof asset.name === "string" && asset.name.toUpperCase() === expected && !asset.isDelisted);
  if (matches.length !== 1) throw new Error("This perpetual could not be matched to the exchange's listed markets.");
  return matches[0].name;
}

export async function getCandleSnapshot(feed: CandleFeed): Promise<CandleSnapshot> {
  const cache = sharedCache<CandleSnapshot>("chart-alert-candles-v2", CACHE_MS, 128);
  const key = `${feed.symbol}:${feed.interval}`;
  return cache.get(key, async () => {
    let sourceSymbol = feed.ticker;
    try {
      let raw: unknown;
      if (feed.venue === "hyperliquid") {
        const meta = await sharedCache<unknown>("chart-alert-meta-v1", 3_600_000, 32).get(feed.dex, async () => {
          const result = await hlInfo<unknown>({ type: "meta", dex: feed.dex });
          if (!result) throw new Error("Hyperliquid market metadata is unavailable.");
          return result;
        });
        sourceSymbol = resolveHyperliquidCoin(meta, feed.ticker, feed.dex);
        const endTime = Date.now();
        raw = await hlInfo<unknown>({ type: "candleSnapshot", req: { coin: sourceSymbol, interval: feed.upstreamInterval, startTime: endTime - CANDLE_COUNT * feed.intervalMs, endTime } }, { weight: 20 + Math.ceil((CANDLE_COUNT + 1) / 60) });
        if (!raw) throw new Error("Hyperliquid candles are unavailable; retrying shortly.");
        // Reject an unexpected market/period instead of analyzing a mismatched response.
        if (!Array.isArray(raw) || raw.some(c => c?.s !== sourceSymbol || c?.i !== feed.upstreamInterval)) throw new Error("The candle feed returned a different market or interval.");
      } else {
        const url = new URL(feed.venue === "binance-spot" ? "https://data-api.binance.vision/api/v3/klines" : "https://fapi.binance.com/fapi/v1/klines");
        url.search = new URLSearchParams({ symbol: feed.ticker, interval: feed.upstreamInterval, limit: String(CANDLE_COUNT) }).toString();
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
        if (response.status === 429 || response.status === 418) throw new RateLimitError("Candle feed rate limited; retrying shortly.");
        if (response.status === 451 || response.status === 403) throw new Error("This exchange's candle feed is unavailable from the server's region.");
        if (!response.ok) throw new Error(`Candle feed unavailable (HTTP ${response.status}). Check the symbol or retry shortly.`);
        raw = await response.json();
      }
      const candles = parseCandles(raw, feed.venue);
      const fetchedAt = Date.now();
      const { recognizeCandles, PATTERN_ENGINE } = await import("./engine.ts");
      const matches = recognizeCandles(candles, feed.intervalMs);
      return { symbol: feed.symbol, interval: feed.interval, source: feed.label, sourceSymbol,
        candles, matches, patternEngine: PATTERN_ENGINE, fetchedAt, error: null };
    } catch (error) {
      const previous = cache.peek(key);
      return {
        symbol: feed.symbol, interval: feed.interval, source: feed.label, sourceSymbol: previous?.sourceSymbol ?? sourceSymbol,
        candles: previous?.candles ?? [], fetchedAt: previous?.fetchedAt ?? 0,
        matches: [], patternEngine: previous?.patternEngine ?? null,
        error: error instanceof Error && error.name !== "TimeoutError" ? error.message : "Candle feed timed out; retrying shortly.",
      };
    }
  });
}
