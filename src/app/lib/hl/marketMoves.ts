// Pure calculations shared by the server, panel and replay tests.
export const MOVE_WINDOWS = ['5m', '15m', '1h'] as const;
export type MoveWindow = typeof MOVE_WINDOWS[number];
export const MOVE_METRICS = ['OI', 'FUNDING', 'VOLUME'] as const;
export type MoveMetric = typeof MOVE_METRICS[number];
export const MOVE_MINUTES: Record<MoveWindow, number> = { '5m': 5, '15m': 15, '1h': 60 };
export const MOVE_MAX_COINS = 12;
export const MOVE_MIN_OI_USD = 5_000_000;
export const MOVE_MIN_DAY_VOLUME = 1_000_000;
export const MINUTE = 60_000;
export const MOVE_SAMPLE_MAX_AGE = 90_000;
export const MOVE_VOLUME_MAX_AGE = 150_000;
export const MOVE_EVENT_TTL = 60 * MINUTE;
export const MOVE_BASELINE_WINDOWS = 12;

export interface MoveSample {
  t: number;
  markPx: number;
  oiCoins: number;
  fundingHourly: number;
}

export interface MoveCandle {
  t: number;
  o: number;
  c: number;
  v: number;
}

export interface MoveReading {
  coin: string;
  metric: MoveMetric;
  window: MoveWindow;
  t: number;
  from: number;
  /** OI fraction, funding delta in hourly bps, or volume ratio. */
  value: number;
  before: number;
  after: number;
  impactUsd: number | null;
  priceChange: number;
  direction: 'UP' | 'DOWN';
  severity: number;
  qualifies: boolean;
}

export interface MoveEvent extends MoveReading {
  id: string;
  firstSeen: number;
  lastSeen: number;
  peakSeverity: number;
  active: boolean;
  /** Episode bookkeeping, never advanced by a repeated cached observation. */
  lastObservation: number;
  quietCount: number;
}

export interface MoveRow {
  coin: string;
  markPx: number;
  oiUsd: number;
  fundingHourly: number;
  liquid: boolean;
  historyMinutes: number;
  oi: MoveReading | null;
  funding: MoveReading | null;
  volume: MoveReading | null;
  volumeIssue: string | null;
}

export interface MarketMovesResponse {
  ts: number;
  asOf: number;
  availableCoins: string[];
  missingCoins: string[];
  windows: Record<MoveWindow, { rows: MoveRow[]; events: MoveEvent[] }>;
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A gap restarts the observed window instead of fabricating intermediate history. */
export function appendMoveSample(history: MoveSample[], sample: MoveSample): MoveSample[] {
  if (!Object.values(sample).every(Number.isFinite) || sample.markPx <= 0 || sample.oiCoins < 0) return history;
  const last = history.at(-1);
  if (last && sample.t - last.t < 25_000) return history;
  if (last && sample.t - last.t > MOVE_SAMPLE_MAX_AGE) return [sample];
  return [...history.filter(p => sample.t - p.t <= 125 * MINUTE), sample].slice(-310);
}

function continuousHistory(samples: MoveSample[], now: number): MoveSample[] {
  const last = samples.at(-1);
  if (!last || last.t > now || now - last.t > MOVE_SAMPLE_MAX_AGE) return [];
  let start = samples.length - 1;
  while (start > 0) {
    const delta = samples[start].t - samples[start - 1].t;
    if (delta <= 0 || delta > MOVE_SAMPLE_MAX_AGE) break;
    start--;
  }
  return samples.slice(start);
}

export function contextMoves(coin: string, samples: MoveSample[], window: MoveWindow, now: number) {
  const history = continuousHistory(samples, now);
  const latest = history.at(-1);
  const historyMinutes = latest ? Math.floor((latest.t - history[0].t) / MINUTE) : 0;
  const empty = { oi: null, funding: null, historyMinutes };
  if (!latest) return empty;
  const target = latest.t - MOVE_MINUTES[window] * MINUTE;
  const before = history.findLast(p => p.t <= target);
  if (!before || target - before.t > MOVE_SAMPLE_MAX_AGE) return empty;
  if (![before, latest].every(p => Object.values(p).every(Number.isFinite) && p.markPx > 0 && p.oiCoins >= 0)) return empty;
  const base = { coin, window, t: latest.t, from: before.t, priceChange: latest.markPx / before.markPx - 1 };
  const oiChange = before.oiCoins > 0 ? latest.oiCoins / before.oiCoins - 1 : null;
  const impactUsd = (latest.oiCoins - before.oiCoins) * latest.markPx;
  const deltaBps = (latest.fundingHourly - before.fundingHourly) * 10_000;
  if (![base.priceChange, impactUsd, deltaBps / 0.5, (oiChange ?? 0) / 0.05].every(Number.isFinite)) return empty;
  const oi: MoveReading | null = oiChange === null ? null : {
    ...base, metric: 'OI', value: oiChange, before: before.oiCoins, after: latest.oiCoins,
    impactUsd, direction: oiChange >= 0 ? 'UP' : 'DOWN', severity: Math.abs(oiChange) / 0.05,
    qualifies: Math.abs(oiChange) >= 0.05 && Math.abs(impactUsd) >= 500_000,
  };
  const funding: MoveReading = {
    ...base, metric: 'FUNDING', value: deltaBps, before: before.fundingHourly, after: latest.fundingHourly,
    impactUsd: null, direction: deltaBps >= 0 ? 'UP' : 'DOWN', severity: Math.abs(deltaBps) / 0.5,
    qualifies: Math.abs(deltaBps) >= 0.5,
  };
  return { oi, funding, historyMinutes };
}

/** Validate the exchange payload, keep the last update of each minute, and sort. */
export function parseMoveCandles(raw: unknown, coin: string): MoveCandle[] {
  if (!Array.isArray(raw)) return [];
  const candles = new Map<number, MoveCandle>();
  for (const value of raw) {
    if (!value || typeof value !== 'object' || value.s !== coin || value.i !== '1m') continue;
    const t = finiteNumber(value.t), o = finiteNumber(value.o), c = finiteNumber(value.c), v = finiteNumber(value.v);
    if (t === null || o === null || c === null || v === null || t % MINUTE !== 0 || o <= 0 || c <= 0 || v < 0) continue;
    candles.set(t, { t, o, c, v });
  }
  return Array.from(candles.values()).sort((a, b) => a.t - b.t);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function volumeMove(coin: string, candles: MoveCandle[], window: MoveWindow, now: number): MoveReading | null {
  // The open minute is never compared to complete historical windows.
  const closed = candles.filter(c => c.t + MINUTE <= now);
  const latest = closed.at(-1);
  if (!latest || now - (latest.t + MINUTE) > MOVE_VOLUME_MAX_AGE) return null;
  const minutes = MOVE_MINUTES[window];
  const count = minutes * (MOVE_BASELINE_WINDOWS + 1);
  const tail = closed.slice(-count);
  if (tail.length !== count) return null;
  for (let i = 0; i < tail.length; i++) {
    const c = tail[i];
    if (![c.t, c.o, c.c, c.v].every(Number.isFinite) || c.o <= 0 || c.c <= 0 || c.v < 0) return null;
    if (i > 0 && c.t - tail[i - 1].t !== MINUTE) return null;
  }
  const sums: number[] = [];
  for (let i = 0; i < tail.length; i += minutes) sums.push(tail.slice(i, i + minutes).reduce((sum, c) => sum + c.v, 0));
  const before = median(sums.slice(0, -1));
  if (before <= 0) return null;
  const after = sums.at(-1)!;
  const ratio = after / before;
  const impactUsd = (after - before) * latest.c;
  const priceChange = latest.c / tail[tail.length - minutes].o - 1;
  if (![before, after, ratio, impactUsd, priceChange].every(Number.isFinite)) return null;
  return {
    coin, metric: 'VOLUME', window, t: latest.t + MINUTE, from: latest.t + MINUTE - minutes * MINUTE,
    value: ratio, before, after, impactUsd, priceChange,
    direction: ratio >= 1 ? 'UP' : 'DOWN', severity: Math.abs(Math.log(Math.max(ratio, 0.01))) / Math.log(3),
    qualifies: (ratio >= 3 || ratio <= 1 / 3) && before * latest.c >= 100_000 && Math.abs(impactUsd) >= 250_000,
  };
}

/** One episode per market/metric/window, rearmed after two quiet observations. */
export function updateMoveEvents(previous: MoveEvent[], readings: MoveReading[], now: number): MoveEvent[] {
  const events = previous.filter(e => now - e.lastSeen <= MOVE_EVENT_TTL).map(e => ({ ...e }));
  for (const reading of readings) {
    const active = events.findLast(e => e.active && e.coin === reading.coin && e.metric === reading.metric && e.window === reading.window);
    if (active && reading.t <= active.lastObservation) continue;
    if (active) {
      // A data gap ends the episode. It is not evidence that the signal went quiet.
      const gap = reading.t - active.lastObservation > MOVE_VOLUME_MAX_AGE;
      if (gap || (reading.qualifies && reading.direction !== active.direction)) active.active = false;
      else if (reading.qualifies) {
        Object.assign(active, reading, { lastSeen: reading.t, lastObservation: reading.t, quietCount: 0, peakSeverity: Math.max(active.peakSeverity, reading.severity) });
        continue;
      } else {
        active.lastObservation = reading.t;
        active.quietCount = reading.severity < 0.7 || reading.direction !== active.direction ? active.quietCount + 1 : 0;
        if (active.quietCount >= 2) active.active = false;
        continue;
      }
    }
    if (!reading.qualifies) continue;
    const id = `${reading.coin}:${reading.metric}:${reading.window}:${reading.t}`;
    if (events.some(e => e.id === id)) continue;
    events.push({ ...reading, id, firstSeen: reading.t, lastSeen: reading.t, peakSeverity: reading.severity, active: true, lastObservation: reading.t, quietCount: 0 });
  }
  return events.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 600);
}

export function moveRank(event: MoveEvent, now: number): number {
  return event.severity * Math.pow(0.5, Math.max(0, now - event.lastSeen) / (15 * MINUTE));
}
