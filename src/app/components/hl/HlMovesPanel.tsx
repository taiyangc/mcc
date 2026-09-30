"use client";

import Link from 'next/link';
import { useState } from 'react';
import { useSystemTheme } from '../../lib/useSystemTheme';
import { formatAge, formatClock, formatCompact, formatPx, formatRatePct, formatUsd } from '../../lib/format';
import {
  MINUTE, MOVE_EVENT_TTL, MOVE_MAX_COINS, MOVE_METRICS, MOVE_MINUTES, MOVE_SAMPLE_MAX_AGE,
  MOVE_VOLUME_MAX_AGE, MOVE_WINDOWS, moveRank,
} from '../../lib/hl/marketMoves';
import type { MarketMovesResponse, MoveEvent, MoveReading, MoveRow } from '../../lib/hl/marketMoves';
import type { HlMovesSpec } from '../../lib/hl/panels';
import { PanelShell } from './PanelChrome';
import { panelTheme, signTextClass } from './panelTheme';
import type { PanelTheme } from './panelTheme';
import { usePolledJson } from './usePolledJson';
import { useNow } from './useNow';
import CoinPicker from './CoinPicker';

interface Props {
  spec: HlMovesSpec;
  refreshKey: number;
  height: number;
  onSpecChange: (spec: HlMovesSpec) => void;
}

const LABELS = { OI: 'Open interest', FUNDING: 'Funding', VOLUME: 'Volume' };
const HELP = 'Default-DEX perpetuals. Top 12 follows the largest liquid markets by recent open interest, or choose up to 12 pairs. Major moves require $5M recent OI and $1M daily volume. OI: ±5% and ±$500K, excluding price changes. Funding: ±0.5 hourly basis points. Volume: ≥3× or ≤⅓× the median of 12 prior equal windows, with ≥$100K baseline and ≥$250K estimated change. Volume uses closed candles; dollar impact is approximate. Arrows describe the metric, not buy/sell pressure. OI and live funding history accumulates while panels refresh; leave auto-refresh at 1m or faster. History and observed events reset on server restart. Gaps restart warm-up. Events retain the last hour; strength is a threshold multiple, decayed with age.';

function fresh(reading: MoveReading | null, now: number): MoveReading | null {
  return reading && now - reading.t <= (reading.metric === 'VOLUME' ? MOVE_VOLUME_MAX_AGE : MOVE_SAMPLE_MAX_AGE) ? reading : null;
}

function magnitude(reading: MoveReading): string {
  if (reading.metric === 'OI') return formatRatePct(reading.value, 2);
  if (reading.metric === 'FUNDING') return `${reading.value > 0 ? '+' : ''}${reading.value.toFixed(2)} bp/h`;
  return `${reading.value.toFixed(2)}× typical`;
}

function endpoints(reading: MoveReading): string {
  if (reading.metric === 'FUNDING') return `${(reading.before * 10_000).toFixed(2)} → ${(reading.after * 10_000).toFixed(2)} bp/h`;
  return `${formatCompact(reading.before)} → ${formatCompact(reading.after)} ${reading.coin}`;
}

function impact(reading: MoveReading): string {
  return reading.impactUsd === null ? endpoints(reading) : `${reading.metric === 'VOLUME' ? '~' : ''}${formatUsd(reading.impactUsd, { sign: true })}`;
}

function MarketLink({ coin }: { coin: string }) {
  return <Link
    href={{ pathname: '/', query: { pairs: `HYPERLIQUID:${coin.toUpperCase()}USDC.P`, width: '1', height: '1' } }}
    target="_blank" rel="noopener noreferrer" prefetch={false}
    className="font-semibold hover:underline" title={`Open ${coin} chart`}
  >{coin}</Link>;
}

function EventRow({ event, now, theme }: { event: MoveEvent; now: number; theme: PanelTheme }) {
  const up = event.direction === 'UP';
  const hue = up ? 'text-emerald-500' : 'text-rose-500';
  const frame = event.severity >= 3 ? (up ? 'border-emerald-500 bg-emerald-500/10' : 'border-rose-500 bg-rose-500/10') : 'border-transparent';
  return <details className={`border-b border-l-2 ${theme.border} ${frame} ${theme.rowHoverBg}`}>
    <summary className="grid grid-cols-[minmax(65px,0.65fr)_minmax(105px,1fr)_minmax(125px,1.1fr)_70px] gap-2 items-center px-3 py-2 cursor-pointer list-none text-[11px]">
      <span><MarketLink coin={event.coin} /><span className={`block text-[9px] ${theme.secondaryText}`}>{event.window} move</span></span>
      <span className={`font-medium ${hue}`}>{up ? '↑' : '↓'} {LABELS[event.metric]}<span className={`block text-[9px] font-normal ${theme.secondaryText}`}>Price <span className={signTextClass(event.priceChange)}>{formatRatePct(event.priceChange, 2)}</span></span></span>
      <span className={`text-right tabular-nums font-semibold ${hue}`}>{magnitude(event)}<span className={`block text-[9px] font-normal ${theme.secondaryText}`}>{impact(event)}</span></span>
      <span className={`text-right text-[10px] ${theme.secondaryText}`}>{formatAge(event.lastSeen, now)}<span className="block text-[9px]">Details ▾</span></span>
    </summary>
    <dl className={`grid grid-cols-2 gap-x-4 gap-y-2 px-3 pb-3 text-[10px] ${theme.secondaryText}`}>
      <div><dt>{event.metric === 'VOLUME' ? 'Typical → observed volume' : 'Before → after'}</dt><dd className={theme.text}>{endpoints(event)}</dd></div>
      <div><dt>Measured window</dt><dd className={theme.text}>{formatClock(event.from)} → {formatClock(event.t)} ({((event.t - event.from) / MINUTE).toFixed(1)}m)</dd></div>
      <div><dt>First / last observed</dt><dd className={theme.text}>{formatClock(event.firstSeen)} / {formatClock(event.lastSeen)}</dd></div>
      <div><dt>Signal / peak threshold multiple</dt><dd className={theme.text}>{event.severity.toFixed(1)}× / {event.peakSeverity.toFixed(1)}×</dd></div>
      <div className="col-span-2">{event.metric === 'VOLUME' ? 'Baseline: median of 12 previous complete windows. USD impact is estimated from base volume at the latest candle close.' : event.metric === 'OI' ? 'OI change uses coin units. Dollar impact values both endpoints at the latest mark.' : 'Change in the current hourly funding rate, including moves across zero. 1 bp = 0.01%.'}</div>
    </dl>
  </details>;
}

function PairReading({ reading, now, theme, fallback }: { reading: MoveReading | null; now: number; theme: PanelTheme; fallback: string }) {
  const current = fresh(reading, now);
  if (!current) return <span className={theme.secondaryText} title={reading ? 'Observation is stale; waiting for a refresh' : fallback}>—</span>;
  return <span title={`${endpoints(current)} · ${formatAge(current.t, now)}`} className={current.qualifies ? `${current.direction === 'UP' ? 'text-emerald-500' : 'text-rose-500'} font-semibold` : theme.text}>
    {magnitude(current)}<span className={`block text-[9px] font-normal ${theme.secondaryText}`}>{impact(current)}</span>
  </span>;
}

function rowReadings(row: MoveRow, spec: HlMovesSpec, now: number): MoveReading[] {
  return [row.oi, row.funding, row.volume].flatMap(reading => {
    const value = fresh(reading, now);
    const unchanged = value?.value === (value?.metric === 'VOLUME' ? 1 : 0);
    return value && (spec.metric === 'ALL' || value.metric === spec.metric) && (spec.direction === 'BOTH' || (!unchanged && value.direction === spec.direction)) ? [value] : [];
  });
}

export default function HlMovesPanel({ spec, refreshKey, height, onSpecChange }: Props) {
  const theme = panelTheme(useSystemTheme());
  const now = useNow(10_000);
  const [sort, setSort] = useState<'strength' | 'recent'>('strength');
  const coinsKey = spec.coins?.slice().sort().join('-') ?? 'TOP';
  const request = usePolledJson<MarketMovesResponse>(`/api/hyperliquid/market-moves?coins=${encodeURIComponent(coinsKey)}`, refreshKey);
  const data = request.data;
  const snapshot = data?.windows[spec.window];
  const rows = snapshot?.rows ?? [];
  const stale = !!data && now - data.asOf > MOVE_SAMPLE_MAX_AGE;
  const oiReady = rows.filter(row => fresh(row.oi, now)).length;
  const fundingReady = rows.filter(row => fresh(row.funding, now)).length;
  const volumeReady = rows.filter(row => fresh(row.volume, now)).length;
  const volumeDelayed = rows.some(row => row.volumeIssue !== null);
  const observed = rows.length ? Math.min(...rows.map(row => row.historyMinutes)) : 0;
  const warming = (spec.metric === 'ALL' || spec.metric === 'OI' || spec.metric === 'FUNDING') && (oiReady < rows.length || fundingReady < rows.length);
  const events = (snapshot?.events ?? []).filter(event => now - event.lastSeen <= MOVE_EVENT_TTL &&
    (spec.metric === 'ALL' || event.metric === spec.metric) && (spec.direction === 'BOTH' || event.direction === spec.direction))
    .sort((a, b) => sort === 'recent' ? b.lastSeen - a.lastSeen : moveRank(b, now) - moveRank(a, now));
  const pairRows = rows.filter(row => spec.direction === 'BOTH' || rowReadings(row, spec, now).length > 0)
    .slice().sort((a, b) => {
      const score = (row: MoveRow) => Math.max(0, ...rowReadings(row, spec, now).map(reading => sort === 'strength' ? reading.severity : reading.t));
      return score(b) - score(a) || b.oiUsd - a.oiUsd;
    });
  const ready = spec.metric === 'OI' ? oiReady : spec.metric === 'FUNDING' ? fundingReady : spec.metric === 'VOLUME' ? volumeReady : oiReady + fundingReady + volumeReady;

  const controls = <>
    <div className={`flex rounded p-0.5 ${theme.bg}`} aria-label="Market moves layout">
      {(['EVENTS', 'PAIRS'] as const).map(layout => <button key={layout} type="button" aria-pressed={spec.layout === layout} onClick={() => onSpecChange({ ...spec, layout })} className={`rounded px-2 py-0.5 text-[10px] ${spec.layout === layout ? theme.tabActive : theme.tabIdle}`}>{layout === 'EVENTS' ? 'Events' : 'Pairs'}</button>)}
    </div>
    <select aria-label="Move window" value={spec.window} onChange={e => onSpecChange({ ...spec, window: e.target.value as HlMovesSpec['window'] })} className={theme.select}>
      {MOVE_WINDOWS.map(window => <option key={window}>{window}</option>)}
    </select>
    <select aria-label="Move metric" value={spec.metric} onChange={e => onSpecChange({ ...spec, metric: e.target.value as HlMovesSpec['metric'] })} className={theme.select}>
      <option value="ALL">All signals</option>{MOVE_METRICS.map(metric => <option key={metric} value={metric}>{LABELS[metric]}</option>)}
    </select>
    <select aria-label="Move direction" value={spec.direction} onChange={e => onSpecChange({ ...spec, direction: e.target.value as HlMovesSpec['direction'] })} className={theme.select}>
      <option value="BOTH">Both directions</option><option value="UP">↑ Increases</option><option value="DOWN">↓ Decreases</option>
    </select>
    <select aria-label="Move sort" value={sort} onChange={e => setSort(e.target.value as typeof sort)} className={theme.select}>
      <option value="strength">Strongest first</option><option value="recent">Most recent first</option>
    </select>
    <CoinPicker selected={spec.coins ?? []} suggestions={data?.availableCoins} theme={theme} max={MOVE_MAX_COINS} emptyLabel="Top 12 liquid" onChange={coins => onSpecChange({ ...spec, coins })} />
    {spec.coins && <button type="button" className={theme.select} onClick={() => onSpecChange({ ...spec, coins: null })}>Top 12</button>}
    <button type="button" aria-label="Refresh market moves" className={theme.select} onClick={request.refresh}>↻</button>
  </>;

  return <PanelShell title="HL Market Moves" theme={theme} height={height} controls={controls} help={HELP}
    subtitle={data ? `${rows.length} pairs · ${formatAge(data.asOf, now)}` : undefined}
    status={stale ? 'Data stale' : request.error ? 'Refresh failed' : volumeDelayed ? 'Partial volume coverage' : undefined}>
    {request.error && <div role="alert" className="px-3 py-2 text-xs text-amber-500">{request.error} <button type="button" className="underline" onClick={request.refresh}>Retry</button></div>}
    {!data ? <div className={`p-8 text-center text-xs ${theme.secondaryText}`}>{request.loading ? 'Reading markets and candle history…' : 'Market data could not be loaded.'}</div> : <>
      <div className={`px-3 py-2 text-[10px] border-b ${theme.border} ${theme.secondaryText}`} role="status">
        <div className="flex flex-wrap justify-between gap-1"><span>Ready: OI {oiReady}/{rows.length} · Funding {fundingReady}/{rows.length} · Volume {volumeReady}/{rows.length}</span><span>{spec.layout === 'EVENTS' ? 'Observed events · past hour' : 'Current changes'}</span></div>
        {stale ? <div className="mt-1 text-amber-500">Market data is stale. Refresh to resume observations.</div> : warming && <div className="mt-1">Collecting {spec.window} OI / funding history · {Math.min(observed, MOVE_MINUTES[spec.window])}m observed. Keep auto-refresh at 1m or faster.</div>}
        {volumeDelayed && <div className="mt-1">Some volume windows are unavailable or delayed. Complete candles are required.</div>}
        {data.missingCoins.length > 0 && <div className="mt-1 text-amber-500">Unavailable markets: {data.missingCoins.join(', ')}</div>}
      </div>
      {spec.layout === 'EVENTS' ? <div className="overflow-x-auto" aria-label="Market move events">
        {events.length === 0 ? <div className={`px-4 py-10 text-center ${theme.secondaryText}`}>
          <p className="text-sm">{rows.length === 0 ? 'No markets available for this selection.' : ready === 0 ? 'Waiting for enough history to detect moves.' : 'No major moves in this view yet.'}</p>
          <p className="mt-1 text-[11px]">{rows.length > 0 ? 'Use Pairs to see the current readings and changes.' : 'Choose another set of pairs or retry the refresh.'}</p>
        </div> : <div className="min-w-[470px]">{events.map(event => <EventRow key={event.id} event={event} now={now} theme={theme} />)}</div>}
      </div> : <div className="overflow-x-auto" aria-label="Market move pairs">
        <table className="w-full min-w-[650px] text-right text-[11px] tabular-nums">
          <thead className={`sticky top-0 text-[9px] uppercase ${theme.headerBg} ${theme.secondaryText}`}><tr>
            <th className="px-3 py-2 text-left">Pair / mark</th><th className="px-2 py-2">OI change</th><th className="px-2 py-2">Funding change</th><th className="px-2 py-2">Volume</th><th className="px-3 py-2">Price</th>
          </tr></thead>
          <tbody>{pairRows.map((row, index) => {
            const price = fresh(row.oi, now)?.priceChange ?? fresh(row.volume, now)?.priceChange;
            return <tr key={row.coin} className={`${index % 2 === 0 ? theme.rowEvenBg : ''} ${theme.rowHoverBg} border-b ${theme.border}`}>
              <td className="px-3 py-2 text-left"><MarketLink coin={row.coin} /><div className={`text-[9px] ${theme.secondaryText}`}>{formatPx(row.markPx)}{!row.liquid && <span title="Below the $5M recent OI / $1M daily volume alert floor"> · low liquidity</span>}</div></td>
              <td className="px-2 py-2"><PairReading reading={row.oi} now={now} theme={theme} fallback="Collecting open-interest history" /><div className={`text-[9px] ${theme.secondaryText}`}>{formatUsd(row.oiUsd)} OI</div></td>
              <td className="px-2 py-2"><PairReading reading={row.funding} now={now} theme={theme} fallback="Collecting current funding history" /><div className={`text-[9px] ${theme.secondaryText}`}>{(row.fundingHourly * 10_000).toFixed(2)} bp/h now</div></td>
              <td className="px-2 py-2"><PairReading reading={row.volume} now={now} theme={theme} fallback={row.volumeIssue ?? 'Waiting for candle history'} /></td>
              <td className={`px-3 py-2 ${price === undefined ? theme.secondaryText : signTextClass(price)}`}>{price === undefined ? '—' : formatRatePct(price, 2)}</td>
            </tr>;
          })}</tbody>
        </table>
        {pairRows.length === 0 && <p className={`p-8 text-center text-xs ${theme.secondaryText}`}>No pairs with available readings in this direction.</p>}
      </div>}
    </>}
  </PanelShell>;
}
