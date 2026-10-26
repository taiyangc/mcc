import type { ChartAnalysis, PatternSignal } from "./types.ts";

export interface AlertCursor {
  seen: string[];
  lastPollAt: number;
  lastAlertAt: number | null;
}

/** Quiet on arm/resume/recovery; one event per candle/pattern, with a one-minute cooldown. */
export function advanceAlerts(cursor: AlertCursor | null, analysis: ChartAnalysis, now: number, flashNeutral = false): { cursor: AlertCursor | null; alerts: PatternSignal[] } {
  if (analysis.status !== "ready") return { cursor: null, alerts: [] };
  const seen = new Set(cursor?.seen ?? []);
  const fresh = analysis.signals.filter(signal => !seen.has(signal.id) && (flashNeutral || signal.direction !== "neutral"));
  for (const signal of analysis.signals) seen.add(signal.id);
  const quiet = !cursor || now - cursor.lastPollAt > 90_000;
  const cooling = cursor?.lastAlertAt != null && now - cursor.lastAlertAt < 60_000;
  const alerts = quiet || cooling ? [] : fresh;
  return {
    cursor: { seen: [...seen].slice(-512), lastPollAt: now, lastAlertAt: alerts.length ? now : cursor?.lastAlertAt ?? null },
    alerts,
  };
}
