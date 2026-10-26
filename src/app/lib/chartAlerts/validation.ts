import type { Candle } from "./types.ts";

// Twenty bars of trend context before even the longest confirmation sequence.
export const MIN_CANDLES = 30;
export const MAX_SNAPSHOT_AGE_MS = 65_000;

export function validCandle(c: Candle): boolean {
  return !!c && [c.time, c.endTime, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
    && Number.isSafeInteger(c.time) && Number.isSafeInteger(c.endTime) && c.time >= 0 && c.endTime > c.time
    && c.low > 0 && c.volume >= 0 && c.high >= Math.max(c.open, c.close)
    && c.low <= Math.min(c.open, c.close);
}

export function validHistory(candles: Candle[], intervalMs: number): boolean {
  return Number.isSafeInteger(intervalMs) && intervalMs > 0 && candles.every((c, i) => validCandle(c)
    && c.endTime - c.time === intervalMs && (i === 0 || candles[i - 1].endTime === c.time));
}
