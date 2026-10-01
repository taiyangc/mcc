import { migratePair, normalizePairInput } from "./pairs.ts";
import { isHlPanelPair } from "./hl/panels.ts";
import { parseTrendConfig, writeTrendParams } from "./trends.ts";
import type { TrendConfig } from "./trends.ts";

export const DASHBOARD_STORAGE_KEY = "mcc.dashboard.v1";
export interface DashboardConfig {
  pairs: string[];
  width: number;
  height: number;
  defaultInterval: string;
  intervals: string[];
  chartSizes: Record<number, { cols: number; rows: number }>;
  refreshIntervals: Record<number, number>;
  autoRefreshEnabled: Record<number, boolean>;
  trends: TrendConfig;
}

const DEFAULT_PAIRS = ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT"];
const CHART_PARAMS = ["pairs", "width", "height", "interval", "iv", "sizes", "ri", "ar"];
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
function dimension(value: unknown, fallback: number): number {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(10, Math.trunc(n))) : fallback;
}
function interval(value: unknown, fallback = "D"): string {
  return typeof value === "string" && /^(?:[1-9]\d{0,4}[SDWM]?|[DWM])$/.test(value) ? value : fallback;
}
function pairs(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(p => typeof p === "string" && p.trim())) return [...DEFAULT_PAIRS];
  return value.map(p => normalizePairInput(migratePair(p.trim())));
}

/** A shared chart URL is self-contained: index-based settings never leak from another saved layout. */
export function parseDashboardConfig(params: URLSearchParams, saved: unknown = null, legacyTrends: unknown = null, legacyInterval: unknown = null): DashboardConfig {
  const stored = record(saved);
  const fromUrl = CHART_PARAMS.some(key => params.has(key));
  const base = fromUrl ? {} : stored;
  const rawPairs = params.get("pairs");
  const symbols = pairs(rawPairs === null ? base.pairs : rawPairs === "" ? [] : rawPairs.split(","));
  const defaultInterval = interval(params.get("interval") ?? base.defaultInterval, fromUrl || saved ? "D" : interval(legacyInterval));
  const rawIntervals = params.has("iv") ? params.get("iv")!.split(",") : base.intervals;
  const rawSizes = params.has("sizes") ? params.get("sizes")!.split(",").map(value => {
    const match = value.match(/^(\d+)x(\d+)$/);
    return match ? { cols: Number(match[1]), rows: Number(match[2]) } : null;
  }) : base.chartSizes;
  const rawRefresh = params.has("ri") ? params.get("ri")!.split(",").map(Number) : base.refreshIntervals;
  const rawAuto = params.has("ar") ? params.get("ar")!.split(",").map(value => value === "1") : base.autoRefreshEnabled;
  const chartSizes: DashboardConfig["chartSizes"] = {};
  const refreshIntervals: DashboardConfig["refreshIntervals"] = {};
  const autoRefreshEnabled: DashboardConfig["autoRefreshEnabled"] = {};
  symbols.forEach((symbol, i) => {
    const size = record(record(rawSizes)[i]);
    const cols = dimension(size.cols, 1);
    const rows = dimension(size.rows, 1);
    if (cols > 1 || rows > 1) chartSizes[i] = { cols, rows };
    const refresh = record(rawRefresh)[i];
    if (typeof refresh === "number" && Number.isFinite(refresh) && refresh > 0) refreshIntervals[i] = refresh;
    const auto = record(rawAuto)[i];
    autoRefreshEnabled[i] = typeof auto === "boolean" ? auto : isHlPanelPair(symbol);
  });
  return {
    pairs: symbols,
    width: dimension(params.get("width") ?? base.width, 2),
    height: dimension(params.get("height") ?? base.height, 2),
    defaultInterval,
    intervals: symbols.map((_, i) => interval(record(rawIntervals)[i], defaultInterval)),
    chartSizes, refreshIntervals, autoRefreshEnabled,
    trends: parseTrendConfig(params, stored.trends ?? legacyTrends),
  };
}

export function writeDashboardParams(params: URLSearchParams, config: DashboardConfig): URLSearchParams {
  const next = writeTrendParams(params, config.trends);
  next.set("pairs", config.pairs.join(","));
  next.set("width", String(config.width));
  next.set("height", String(config.height));
  next.set("interval", config.defaultInterval);
  const intervals = config.pairs.map((_, i) => config.intervals[i] ?? config.defaultInterval);
  if (intervals.some(value => value !== config.defaultInterval)) next.set("iv", intervals.join(","));
  else next.delete("iv");
  const sizes = config.pairs.map((_, i) => {
    const size = config.chartSizes[i];
    return size ? `${size.cols}x${size.rows}` : "1x1";
  });
  if (sizes.some(size => size !== "1x1")) next.set("sizes", sizes.join(","));
  else next.delete("sizes");
  const refresh = config.pairs.map((_, i) => config.refreshIntervals[i] ?? 0);
  if (refresh.some(Boolean)) next.set("ri", refresh.join(","));
  else next.delete("ri");
  // Explicit zeroes matter: omitting them would re-enable Hyperliquid's default polling.
  next.set("ar", config.pairs.map((pair, i) => (config.autoRefreshEnabled[i] ?? isHlPanelPair(pair)) ? "1" : "0").join(","));
  return next;
}

/** Stable comparison of every saved setting, excluding live quotes and open/closed UI state. */
export function dashboardKey(config: DashboardConfig): string {
  return writeDashboardParams(new URLSearchParams(), config).toString();
}

/** Apply chart inputs without losing per-chart settings, even when an empty cell removes a chart. */
export function applyDashboardEdits(config: DashboardConfig, draftPairs: string[], trends = config.trends): DashboardConfig {
  const next: DashboardConfig = { ...config, trends, pairs: [], intervals: [], chartSizes: {}, refreshIntervals: {}, autoRefreshEnabled: {} };
  for (let i = 0; i < Math.max(config.pairs.length, draftPairs.length); i++) {
    const pair = normalizePairInput(draftPairs[i] ?? config.pairs[i] ?? "");
    if (!pair) continue;
    const index = next.pairs.length;
    const changed = pair !== config.pairs[i];
    next.pairs.push(pair);
    next.intervals.push(changed ? config.defaultInterval : config.intervals[i] ?? config.defaultInterval);
    if (config.chartSizes[i]) next.chartSizes[index] = config.chartSizes[i];
    if (config.refreshIntervals[i]) next.refreshIntervals[index] = config.refreshIntervals[i];
    next.autoRefreshEnabled[index] = changed && isHlPanelPair(pair) ? true : config.autoRefreshEnabled[i] ?? isHlPanelPair(pair);
  }
  return next;
}
