import { PATTERN_BY_CODE, patternName } from "./catalog.ts";
import type { PatternCategory, PatternDirection } from "./catalog.ts";
import { MAX_SNAPSHOT_AGE_MS, MIN_CANDLES, validHistory } from "./validation.ts";
import type { Candle, CandlePatternMatch, ChartAlertSettings, ChartAnalysis, PatternSignal } from "./types.ts";

const LOOKBACK = 20;
const ATR_PERIOD = 14;

/** Wilder ATR using preceding candles only; the observed pattern cannot inflate it. */
function atr(candles: Candle[]): number {
  const ranges = candles.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close)));
  let result = ranges.slice(0, ATR_PERIOD).reduce((a, b) => a + b, 0) / ATR_PERIOD;
  for (const value of ranges.slice(ATR_PERIOD)) result = (result * (ATR_PERIOD - 1) + value) / ATR_PERIOD;
  return result;
}

/** Context ends BEFORE the first candle of a formation, including Hikkake setups. */
function trendBefore(candles: Candle[], start: number): PatternDirection {
  const history = candles.slice(0, start);
  if (history.length < LOOKBACK) return "neutral";
  const recent = history.slice(-LOOKBACK);
  const baseline = atr(history);
  const slow = recent.reduce((sum, c) => sum + c.close, 0) / LOOKBACK;
  const fast = recent.slice(-5).reduce((sum, c) => sum + c.close, 0) / 5;
  if (baseline > 0 && fast < slow - 0.25 * baseline && recent.at(-1)!.close < recent.at(-5)!.close) return "down";
  if (baseline > 0 && fast > slow + 0.25 * baseline && recent.at(-1)!.close > recent.at(-5)!.close) return "up";
  return "neutral";
}

function tweezerMatches(candles: Candle[], index: number): CandlePatternMatch[] {
  if (index < LOOKBACK + 1) return [];
  const prior = candles[index - 1];
  const c = candles[index];
  const baseline = atr(candles.slice(0, index - 1));
  if (baseline <= 0 || Math.abs(prior.close - prior.open) < 0.1 * baseline || Math.abs(c.close - c.open) < 0.1 * baseline) return [];
  const bottom = prior.close < prior.open && c.close > c.open && Math.abs(prior.low - c.low) <= 0.05 * baseline;
  const top = prior.close > prior.open && c.close < c.open && Math.abs(prior.high - c.high) <= 0.05 * baseline;
  return bottom || top ? [{ code: bottom ? "TWEEZERBOTTOM" : "TWEEZERTOP", index, startIndex: index - 1, value: bottom ? 100 : -100 }] : [];
}

function patternsAt(candles: Candle[], index: number, settings: ChartAlertSettings, observedAt: number, matches: CandlePatternMatch[]): PatternSignal[] {
  const c = candles[index];
  const history = candles.slice(0, index);
  const prior = history.at(-1)!;
  const recent = history.slice(-LOOKBACK);
  const baseline = atr(history);
  const range = c.high - c.low;
  // A zero-range candle has no useful shape (even if a library calls it a doji).
  if (baseline <= 0 || range <= 0) return [];
  const change = c.close - prior.close;
  const changePct = change / prior.close * 100;
  const signals: PatternSignal[] = [];
  const add = (code: string, name: string, direction: PatternDirection, category: PatternCategory, reason: string,
    startIndex = index, variant: PatternSignal["variant"] = "standard") => {
    signals.push({ id: `${c.time}:${code}:${direction}:${variant === "confirmed" ? "confirmed" : "shape"}`,
      code, name, direction, category, candleCount: index - startIndex + 1, startTime: candles[startIndex].time,
      time: c.time, endTime: c.endTime, provisional: c.endTime > observedAt, changePct, reason, variant });
  };
  const signed = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
  if (settings.momentum && Math.abs(changePct) >= settings.minMovePct && Math.abs(change) >= settings.atrMultiple * baseline) {
    const direction = change > 0 ? "up" : "down";
    const nearExtreme = change > 0 ? (c.close - c.low) / range >= 0.75 : (c.high - c.close) / range >= 0.75;
    if (nearExtreme) add(`impulse-${direction}`, change > 0 ? "Bullish impulse" : "Bearish impulse", direction, "momentum",
      `${signed} from the previous close; ${(Math.abs(change) / baseline).toFixed(1)}× prior ATR(14). Sudden ${change > 0 ? "upward" : "downward"} momentum, finishing near the candle's ${change > 0 ? "high" : "low"}.`);
  }
  if (settings.breakouts) {
    const resistance = Math.max(...recent.map(bar => bar.high));
    const support = Math.min(...recent.map(bar => bar.low));
    if (c.close > resistance + 0.1 * baseline) add("breakout", "Range breakout", "up", "breakouts", "Price is above the preceding 20-bar high by more than 0.1× ATR.");
    if (c.close < support - 0.1 * baseline) add("breakdown", "Range breakdown", "down", "breakouts", "Price is below the preceding 20-bar low by more than 0.1× ATR.");
  }

  for (const match of [...matches.filter(item => item.index === index), ...tweezerMatches(candles, index)]) {
    const definition = PATTERN_BY_CODE.get(match.code);
    if (!definition || !settings[definition.group] || !Number.isInteger(match.startIndex) || match.startIndex < 0) continue;
    const count = index - match.startIndex + 1;
    const magnitude = Math.abs(match.value);
    if (![80, 100, 200].includes(magnitude) || count < definition.candles || count > (definition.maxCandles ?? definition.candles)) continue;
    const trend = trendBefore(candles, match.startIndex);
    let direction: PatternDirection;
    switch (definition.direction) {
      case "signed": direction = match.value > 0 ? "up" : "down"; break;
      case "lower-rejection": direction = trend === "down" ? "up" : "neutral"; break;
      case "upper-rejection": direction = trend === "up" ? "down" : "neutral"; break;
      default: direction = definition.direction;
    }
    if (definition.trend === "opposite" && (trend === "neutral" || direction === trend)) continue;
    if (definition.trend === "same" && direction !== trend) continue;
    const variant = magnitude === 200 ? "confirmed" : magnitude === 80 ? "touching" : "standard";
    const context = definition.trend !== "none" || definition.direction.endsWith("rejection")
      ? ` Prior trend: ${trend === "up" ? "rising" : trend === "down" ? "falling" : "not established"}, measured before the formation.` : "";
    const detail = variant === "confirmed" ? " The later candle crossed the setup's confirmation level."
      : variant === "touching" ? " Touching-boundary variant: a body edge meets rather than strictly crosses the other body."
      : definition.maxCandles ? " Setup only; the confirmation breakout has not occurred." : "";
    add(definition.code, `${patternName(definition, direction)}${variant === "confirmed" ? " · confirmed" : ""}`,
      direction, definition.group, definition.summary + context + detail, match.startIndex, variant);
  }

  // Prefer specific names over generic aliases on the SAME candle. Keep
  // independent and opposing observations; their count is not confidence.
  const suppressed = new Set(signals.flatMap(signal => PATTERN_BY_CODE.get(signal.code)?.suppresses ?? []));
  return signals.filter(signal => !suppressed.has(signal.code)).sort((a, b) => {
    const priority = (signal: PatternSignal) => signal.candleCount * 10 + (signal.direction === "neutral" ? 0 : 5)
      + (signal.category === "momentum" || signal.category === "breakouts" ? 20 : 0);
    return priority(a) - priority(b);
  });
}

/** Combine server shape recognition with per-chart context and notification preferences. */
export function analyzeCandles(candles: Candle[], intervalMs: number, settings: ChartAlertSettings,
  fetchedAt: number, now = Date.now(), matches: CandlePatternMatch[] = []): ChartAnalysis {
  const latest = candles.at(-1) ?? null;
  const fail = (status: ChartAnalysis["status"], message: string): ChartAnalysis => ({ status, message, signals: [], latest });
  if (!latest || candles.length < MIN_CANDLES) return fail("waiting", `Waiting for at least ${MIN_CANDLES} candles to establish pattern and trend baselines.`);
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(now) || now - fetchedAt > MAX_SNAPSHOT_AGE_MS
    || fetchedAt > now + 5_000 || latest.time > fetchedAt || fetchedAt - latest.endTime > 60_000) {
    return fail("stale", "No recent candle data. Alerts are paused until the feed catches up.");
  }
  if (!validHistory(candles, intervalMs)) return fail("gap", "Candle history has a gap or invalid values. Alerts are paused.");
  const lastClosed = candles.findLastIndex(c => c.endTime <= fetchedAt);
  const indices = lastClosed >= LOOKBACK ? [lastClosed] : [];
  if (settings.live && latest.endTime > fetchedAt && candles.length - 1 >= LOOKBACK) indices.push(candles.length - 1);
  return {
    status: "ready", latest,
    message: settings.live ? "Watching forming and closed candles · checked every 30s" : "Watching closed candles · checked every 30s",
    signals: indices.flatMap(index => patternsAt(candles, index, settings, fetchedAt, matches)),
  };
}
