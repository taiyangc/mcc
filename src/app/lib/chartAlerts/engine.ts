// Server-only entry point: never import the native addon from client components.
import talib from "talib";
import { TALIB_PATTERNS } from "./catalog.ts";
import { MIN_CANDLES, validHistory } from "./validation.ts";
import type { Candle, CandlePatternMatch } from "./types.ts";

// The binding's `version` property is a stale wrapper constant, not the C version.
export const PATTERN_ENGINE = "TA-Lib · 61 recognizers";

/** Run full histories for lookbacks, returning just the two bars the UI observes. */
export function recognizeCandles(candles: Candle[], intervalMs: number): CandlePatternMatch[] {
  if (candles.length < MIN_CANDLES || !validHistory(candles, intervalMs)) return [];
  const input = {
    startIdx: 0, endIdx: candles.length - 1,
    open: candles.map(c => c.open), high: candles.map(c => c.high),
    low: candles.map(c => c.low), close: candles.map(c => c.close),
  };
  const matches: CandlePatternMatch[] = [];
  for (const definition of TALIB_PATTERNS) {
    const output = talib.execute({ name: definition.code, ...input,
      ...(definition.penetration == null ? {} : { optInPenetration: definition.penetration }) });
    const values = output.result?.outInteger;
    // The C output starts at begIndex, NOT at the first input candle. Never pad
    // or guess an offset: a shifted result would identify the wrong candle.
    if (!Array.isArray(values) || !Number.isInteger(output.begIndex) || output.begIndex < 0
      || output.nbElement !== values.length || output.begIndex + values.length > candles.length) {
      throw new Error("Pattern engine returned an invalid candle alignment.");
    }
    for (let offset = Math.max(0, candles.length - 2 - output.begIndex); offset < values.length; offset++) {
      const value = values[offset];
      if (!value) continue;
      if (![80, 100, 200].includes(Math.abs(value))) throw new Error("Pattern engine returned an unknown pattern value.");
      const index = output.begIndex + offset;
      let setupIndex = index;
      if (Math.abs(value) === 200) {
        // Hikkake's confirmation is a new event, anchored to the earlier setup.
        const setup = values.slice(Math.max(0, offset - 3), offset).findLastIndex(v => v === value / 2);
        if (!definition.maxCandles || setup < 0) continue;
        setupIndex = output.begIndex + Math.max(0, offset - 3) + setup;
      }
      matches.push({ code: definition.code, index, startIndex: setupIndex - definition.candles + 1, value });
    }
  }
  return matches;
}
