import type { PatternCategory, PatternDirection } from "./catalog.ts";

export interface Candle {
  /** UTC milliseconds; endTime is exclusive. */
  time: number;
  endTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartAlertSettings {
  enabled: boolean;
  live: boolean;
  minMovePct: number;
  atrMultiple: number;
  momentum: boolean;
  breakouts: boolean;
  reversals: boolean;
  continuations: boolean;
  basics: boolean;
  neutral: boolean;
  flashNeutral: boolean;
}

export const DEFAULT_CHART_ALERTS: ChartAlertSettings = {
  enabled: false, live: true, minMovePct: 0.75, atrMultiple: 1.5,
  momentum: true, breakouts: true, reversals: true,
  continuations: true, basics: true, neutral: true, flashNeutral: false,
};

export function parseChartAlertSettings(raw: unknown): ChartAlertSettings {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const flag = (key: keyof ChartAlertSettings) => typeof value[key] === "boolean" ? value[key] as boolean : DEFAULT_CHART_ALERTS[key] as boolean;
  const number = (key: "minMovePct" | "atrMultiple", min: number, max: number) =>
    typeof value[key] === "number" && Number.isFinite(value[key])
      ? Math.max(min, Math.min(max, value[key])) : DEFAULT_CHART_ALERTS[key];
  return {
    enabled: flag("enabled"), live: flag("live"),
    minMovePct: number("minMovePct", 0.05, 25), atrMultiple: number("atrMultiple", 0.5, 10),
    momentum: flag("momentum"), breakouts: flag("breakouts"), reversals: flag("reversals"),
    continuations: flag("continuations"), basics: flag("basics"), neutral: flag("neutral"), flashNeutral: flag("flashNeutral"),
  };
}

export interface CandleSnapshot {
  symbol: string;
  interval: string;
  source: string;
  sourceSymbol: string;
  candles: Candle[];
  matches: CandlePatternMatch[];
  patternEngine: string | null;
  fetchedAt: number;
  error: string | null;
}

/** Raw shape results, aligned to the snapshot's candle indices on the server. */
export interface CandlePatternMatch {
  code: string;
  index: number;
  startIndex: number;
  /** TA-Lib encoding, never a probability: ±80 touching, ±100 shape, ±200 Hikkake confirmation. */
  value: number;
}

export interface PatternSignal {
  id: string;
  code: string;
  name: string;
  direction: PatternDirection;
  category: PatternCategory;
  candleCount: number;
  startTime: number;
  variant: "standard" | "touching" | "confirmed";
  time: number;
  endTime: number;
  provisional: boolean;
  changePct: number;
  reason: string;
}

export interface ChartAnalysis {
  status: "ready" | "waiting" | "stale" | "gap";
  message: string;
  signals: PatternSignal[];
  latest: Candle | null;
}
