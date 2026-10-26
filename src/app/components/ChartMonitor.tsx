"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ALERT_INTERVALS, resolveCandleFeed } from "../lib/chartAlerts/markets";
import { analyzeCandles } from "../lib/chartAlerts/patterns";
import { advanceAlerts } from "../lib/chartAlerts/notifications";
import type { AlertCursor } from "../lib/chartAlerts/notifications";
import { parseChartAlertSettings } from "../lib/chartAlerts/types";
import { PATTERN_GROUPS } from "../lib/chartAlerts/catalog";
import type { PatternDirection } from "../lib/chartAlerts/catalog";
import type { CandleSnapshot, ChartAlertSettings, ChartAnalysis, PatternSignal } from "../lib/chartAlerts/types";
import PatternHelp from "./PatternHelp";
import PatternLibrary from "./PatternLibrary";
import PatternBadges, { isUnusualMove } from "./PatternBadges";
import styles from "./ChartMonitor.module.css";

interface Props {
  isChart: boolean;
  symbol: string;
  interval: string;
  settings: ChartAlertSettings;
  onSettingsChange: (settings: ChartAlertSettings) => void;
  onIntervalChange: (interval: string) => void;
  children: ReactNode;
}

interface Reading {
  snapshot: CandleSnapshot | null;
  analysis: ChartAnalysis | null;
  error: string | null;
  paused: boolean;
  events: PatternSignal[];
}

interface Pulse { id: number; direction: PatternDirection | "mixed"; label: string; signals?: PatternSignal[] }

// Non-chart panels keep their existing layout and never poll candle data.
export default function ChartMonitor(props: Props) {
  if (!props.isChart) return props.children;
  return <Monitor key={props.symbol} {...props} />;
}

function Monitor({ symbol, interval, settings, onSettingsChange, onIntervalChange, children }: Props) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState<Reading>({ snapshot: null, analysis: null, error: null, paused: false, events: [] });
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const dialogId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const feed = resolveCandleFeed(symbol, interval);
  const supported = typeof feed !== "string";
  const settingsKey = JSON.stringify(settings);

  useEffect(() => {
    const config = parseChartAlertSettings(JSON.parse(settingsKey));
    const source = resolveCandleFeed(symbol, interval);
    setReading({ snapshot: null, analysis: null, error: null, paused: false, events: [] });
    setPulse(null);
    if (!config.enabled || typeof source === "string") return;
    let disposed = false;
    let cursor: AlertCursor | null = null;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (disposed || document.hidden) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const query = new URLSearchParams({ symbol, interval });
        const response = await fetch(`/api/chart-alerts?${query}`, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]), cache: "no-store" });
        const data = await response.json();
        if (disposed || request.signal.aborted || document.hidden) return;
        if (!response.ok || !Array.isArray(data.candles)) throw new Error(data.error || "Candle feed is unavailable.");
        const snapshot = data as CandleSnapshot;
        if (snapshot.symbol !== symbol || snapshot.interval !== (interval === "1D" ? "D" : interval === "1W" ? "W" : interval)) throw new Error("Candle feed does not match this chart.");
        const now = Date.now();
        if (!snapshot.error && (!Array.isArray(snapshot.matches) || !snapshot.patternEngine)) throw new Error("Pattern recognition is unavailable; retrying shortly.");
        const analysis = snapshot.error ? null : analyzeCandles(snapshot.candles, source.intervalMs, config, snapshot.fetchedAt, now, snapshot.matches);
        const next = analysis ? advanceAlerts(cursor, analysis, now, config.flashNeutral) : { cursor: null, alerts: [] };
        cursor = next.cursor;
        setReading(previous => ({ snapshot, analysis, error: snapshot.error, paused: false, events: [...next.alerts, ...previous.events].slice(0, 8) }));
        if (next.alerts.length) {
          const directions = new Set(next.alerts.map(signal => signal.direction).filter(direction => direction !== "neutral"));
          setPulse({ id: now, direction: directions.size > 1 ? "mixed" : directions.has("up") ? "up" : directions.has("down") ? "down" : "neutral",
            label: next.alerts.map(signal => signal.name).join(" · "), signals: next.alerts });
        } else if (snapshot.error || analysis?.status !== "ready") setPulse(null);
      } catch (error) {
        if (disposed || request.signal.aborted || document.hidden) return;
        cursor = null;
        setPulse(null);
        setReading(previous => ({ ...previous, analysis: null, error: error instanceof Error ? error.message : "Candle feed is unavailable.", paused: false }));
      } finally {
        if (!disposed && !request.signal.aborted && !document.hidden) timer = setTimeout(poll, 30_000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      cursor = null;
      setPulse(null);
      setReading(previous => ({ ...previous, analysis: null, paused: document.hidden }));
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    if (!document.hidden) void poll();
    else setReading(previous => ({ ...previous, paused: true }));
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [symbol, interval, settingsKey]);

  useEffect(() => {
    if (!pulse) return;
    const timer = setTimeout(() => setPulse(null), 4_000);
    return () => clearTimeout(timer);
  }, [pulse]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !toggleRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const update = (patch: Partial<ChartAlertSettings>) => onSettingsChange(parseChartAlertSettings({ ...settings, ...patch }));
  const problem = !supported ? feed as string : reading.error ?? (reading.analysis && reading.analysis.status !== "ready" ? reading.analysis.message : null);
  const current = reading.analysis?.signals.at(-1);
  const summarySignals = pulse?.signals ?? (!pulse && settings.enabled && !problem && current ? [current] : []);
  const status = !settings.enabled ? "Alerts off" : !supported || problem ? "Alerts paused" : reading.paused ? "Tab paused" : !reading.analysis ? "Connecting…" : "Watching";
  const close = () => { setOpen(false); toggleRef.current?.focus(); };

  return (
    <div className={styles.monitor} data-chart-monitor={symbol}>
      <div className={styles.toolbar}>
        <button ref={toggleRef} type="button" className={styles.toggle} aria-label={`Chart alerts for ${symbol}`} aria-expanded={open} aria-controls={dialogId} onClick={() => setOpen(value => !value)}>
          <span aria-hidden="true" className={settings.enabled && !problem ? styles.active : ""}>◉</span> {status}
        </button>
        <div className={styles.summaries}>
          {summarySignals.length ? summarySignals.map(signal => <div key={signal.id} className={styles.summaryItem}>
            <PatternHelp className={styles.summary} direction={signal.direction} unusual={isUnusualMove(signal)} explanation={signal.reason}
              name={`${signal.provisional ? "Forming · " : "Closed · "}${signal.name}`} />
            <PatternBadges directions={[signal.direction]} unusual={isUnusualMove(signal)} />
          </div>) : <PatternHelp className={styles.summary}
            explanation={pulse ? "A preview of this chart's alert border; no market event was generated." : problem ?? reading.analysis?.message ?? "Read candle patterns and flash this chart when a new pattern appears."}
            name={pulse ? pulse.label : settings.enabled ? problem ? "Feed unavailable" : reading.analysis ? "No pattern" : "Connecting…" : "Patterns & flash alerts"} />}
        </div>
        {settings.enabled && <span className={styles.period}>{ALERT_INTERVALS.find(item => item.value === interval)?.label ?? interval}</span>}
      </div>
      <div className={styles.chart}>{children}</div>
      {pulse && <div key={pulse.id} className={`${styles.pulse} ${styles[pulse.direction]}`} data-alert-direction={pulse.direction} aria-hidden="true" />}
      <span className={styles.srOnly} role="status" aria-live="polite">{pulse ? `${symbol}: ${pulse.label}` : ""}</span>
      {open && (
        <div ref={panelRef} id={dialogId} className={styles.panel} role="dialog" aria-label={`Pattern alerts · ${symbol}`} tabIndex={-1} onKeyDown={event => { if (event.key === "Escape") close(); }}>
          <div className={styles.heading}><strong>Pattern alerts</strong><button type="button" aria-label="Close pattern alerts" onClick={close}>×</button></div>
          <div className={styles.market}>{symbol}</div>
          <label className={styles.check}><input type="checkbox" checked={settings.enabled} disabled={!supported && !settings.enabled} onChange={event => update({ enabled: event.target.checked })} /> Watch this chart and flash new patterns</label>
          <div className={styles.fields}>
            <label>Chart timeframe<select value={interval === "1D" ? "D" : interval === "1W" ? "W" : interval} onChange={event => onIntervalChange(event.target.value)}>
              {!ALERT_INTERVALS.some(item => item.value === interval) && interval !== "1D" && interval !== "1W" && <option value={interval}>{interval} (unsupported)</option>}
              {ALERT_INTERVALS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select></label>
            <label>Timing<select value={settings.live ? "live" : "closed"} onChange={event => update({ live: event.target.value === "live" })}><option value="live">Early + candle close</option><option value="closed">Candle close only</option></select></label>
            <label>Impulse move (%)<input type="number" min="0.05" max="25" step="0.05" value={settings.minMovePct} onChange={event => { if (event.target.value) update({ minMovePct: Number(event.target.value) }); }} /></label>
            <label>Impulse size (× ATR)<input type="number" min="0.5" max="10" step="0.25" value={settings.atrMultiple} onChange={event => { if (event.target.value) update({ atrMultiple: Number(event.target.value) }); }} /></label>
          </div>
          <div className={styles.groups}>
            <label><input type="checkbox" checked={settings.momentum} onChange={event => update({ momentum: event.target.checked })} /> Momentum</label>
            <label><input type="checkbox" checked={settings.breakouts} onChange={event => update({ breakouts: event.target.checked })} /> Breakouts</label>
            {PATTERN_GROUPS.map(group => <label key={group.key}><input type="checkbox" checked={settings[group.key]} onChange={event => update({ [group.key]: event.target.checked })} /> {group.label}</label>)}
          </div>
          <label className={styles.check}><input type="checkbox" checked={settings.flashNeutral} onChange={event => update({ flashNeutral: event.target.checked })} /> Also flash neutral observations</label>
          <div className={styles.patternLegend} role="group" aria-label="Pattern color legend"><PatternBadges directions={["up", "down", "neutral"]} unusual /></div>
          <p className={styles.note}>Unusual labels flag sudden impulses and range breaks, alongside their bullish or bearish direction.</p>
          <p className={styles.note}>Neutral patterns appear in the readings without a flash by default. Blue means neutral; amber means opposing directions.</p>
          <p className={styles.note}>Early patterns can change before close. These are price observations, not trade recommendations. Alerts run while this tab is visible; each chart has a 1-minute cooldown.</p>
          {problem && <p className={styles.problem} role="status">{problem}</p>}
          {supported && <p className={styles.note}>{feed.label}{reading.snapshot?.sourceSymbol ? ` · ${reading.snapshot.sourceSymbol}` : ""} · {reading.snapshot?.fetchedAt ? `Fetched ${new Date(reading.snapshot.fetchedAt).toLocaleTimeString()}` : "Checked every 30s when enabled"}. Uses exchange candles. Set symbol and timeframe in dashboard controls to keep the reading matched.</p>}
          {reading.analysis && <p className={styles.note}>{reading.analysis.signals.length ? "Current observations · hover or focus a name for the explanation" : "No patterns match the selected groups and trend context."}</p>}
          {reading.analysis?.signals.toReversed().map(signal => <div key={signal.id} className={styles.signal}>
            <div className={styles.patternHeading}>
              <PatternHelp name={`${signal.direction === "up" ? "↑" : signal.direction === "down" ? "↓" : "◇"} ${signal.name}`} direction={signal.direction} unusual={isUnusualMove(signal)} explanation={signal.reason} />
              <PatternBadges directions={[signal.direction]} unusual={isUnusualMove(signal)} />
            </div>
            <span>{signal.provisional ? "Forming" : "Closed"} · {signal.candleCount} candle{signal.candleCount === 1 ? "" : "s"}{signal.variant === "touching" ? " · Touching variant" : ""} · {new Date(signal.time).toLocaleTimeString()}</span>
          </div>)}
          {!!reading.events.length && <details><summary>Recent alerts ({reading.events.length})</summary>{reading.events.map(signal => <div key={signal.id} className={styles.signal}>
            <div className={styles.patternHeading}>
              <PatternHelp name={signal.name} direction={signal.direction} unusual={isUnusualMove(signal)} explanation={signal.reason} />
              <PatternBadges directions={[signal.direction]} unusual={isUnusualMove(signal)} />
            </div>
            <span>{new Date(signal.time).toLocaleTimeString()} · {signal.provisional ? "Forming when detected" : "Closed"}</span>
          </div>)}</details>}
          <div className={styles.previews}><span>Preview flash</span>{(["up", "down", "neutral"] as const).map(direction => <button key={direction} type="button" onClick={() => setPulse({ id: Date.now(), direction, label: `Preview · ${direction === "up" ? "upward" : direction === "down" ? "downward" : "neutral"} alert` })}>{direction === "up" ? "↑ Up" : direction === "down" ? "↓ Down" : "◇ Neutral"}</button>)}</div>
          <PatternLibrary />
        </div>
      )}
    </div>
  );
}
