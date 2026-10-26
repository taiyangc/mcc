import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCandles } from '../src/app/lib/chartAlerts/patterns.ts';
import { recognizeCandles } from '../src/app/lib/chartAlerts/engine.ts';
import { advanceAlerts } from '../src/app/lib/chartAlerts/notifications.ts';
import { resolveCandleFeed } from '../src/app/lib/chartAlerts/markets.ts';
import { DEFAULT_CHART_ALERTS, parseChartAlertSettings } from '../src/app/lib/chartAlerts/types.ts';
import { parseCandles, resolveHyperliquidCoin, getCandleSnapshot } from '../src/app/lib/chartAlerts/candles.ts';
import { parseDashboardConfig, writeDashboardParams, applyDashboardEdits } from '../src/app/lib/dashboard.ts';

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 24);
const NOW = START + 31 * MINUTE;
const settings = { ...DEFAULT_CHART_ALERTS, enabled: true, neutral: false };
function bars(last = {}, slope = 0) {
  return Array.from({ length: 31 }, (_, i) => {
    const open = 100 + i * slope;
    const close = open + slope;
    return { time: START + i * MINUTE, endTime: START + (i + 1) * MINUTE,
      open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 100,
      ...(i === 30 ? last : {}),
    };
  });
}
const analyze = (candles, config = settings, fetched = NOW, now = fetched) => analyzeCandles(candles, MINUTE, config, fetched, now, recognizeCandles(candles, MINUTE));
const names = result => result.signals.map(signal => signal.name);
const impulse = () => bars({ open: 100, close: 105, high: 105.1, low: 99.9 });
const rawBinance = candles => candles.map(c => [c.time, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume), c.endTime - 1]);

test('sudden pull-ups and drops get directional names and an independent volatility baseline', () => {
  const up = analyze(impulse());
  assert.equal(up.status, 'ready');
  assert.ok(names(up).includes('Bullish impulse'));
  assert.ok(names(up).includes('Range breakout'));
  assert.ok(names(up).includes('Bullish marubozu'));
  assert.match(up.signals.find(s => s.code === 'impulse-up').reason, /5\.0× prior ATR/);
  assert.equal(up.signals[0].direction, 'up');
  const down = analyze(bars({ open: 100, close: 95, high: 100.1, low: 94.9 }));
  assert.ok(names(down).includes('Bearish impulse'));
  assert.ok(names(down).includes('Range breakdown'));
  assert.ok(names(down).includes('Bearish marubozu'));
  assert.equal(down.signals[0].changePct, -5);
});

test('ordinary noise, a wicked spike that fully retraces, and dojis are not impulses', () => {
  assert.deepEqual(analyze(bars()).signals, []);
  const retraced = analyze(bars({ high: 110, close: 100.1 }));
  assert.equal(names(retraced).includes('Bullish impulse'), false);
  assert.equal(names(retraced).includes('Range breakout'), false);
});

test('momentum must exceed both the percent and ATR thresholds; groups are independent', () => {
  assert.ok(!names(analyze(impulse(), { ...settings, minMovePct: 6 })).includes('Bullish impulse'));
  assert.ok(!names(analyze(impulse(), { ...settings, atrMultiple: 6 })).includes('Bullish impulse'));
  assert.deepEqual(analyze(impulse(), { ...settings, momentum: false, breakouts: false, reversals: false, continuations: false, basics: false }).signals, []);
  assert.deepEqual(names(analyze(impulse(), { ...settings, momentum: false, reversals: false, basics: false })), ['Range breakout']);
});

test('hammer and shooting star require the appropriate prior trend', () => {
  const hammer = { open: 84.7, close: 84.9, low: 82, high: 85 };
  assert.ok(names(analyze(bars(hammer, -0.5))).includes('Hammer'));
  assert.ok(!names(analyze(bars({ open: 100, close: 100.5, low: 97, high: 100.6 }))).includes('Hammer'));
  const star = { open: 115.5, close: 115.3, low: 115.2, high: 118 };
  assert.ok(names(analyze(bars(star, 0.5))).includes('Shooting star'));
  assert.ok(!names(analyze(bars({ open: 100, close: 99.5, low: 99.4, high: 103 }))).includes('Shooting star'));
});

test('engulfing requires an opposite-color body that contains the previous body after a trend', () => {
  assert.ok(names(analyze(bars({ open: 84.9, close: 87, low: 84.8, high: 87.1 }, -0.5))).includes('Bullish engulfing'));
  assert.ok(names(analyze(bars({ open: 115.1, close: 113, low: 112.9, high: 115.2 }, 0.5))).includes('Bearish engulfing'));
  assert.ok(!names(analyze(bars({ open: 85.1, close: 87, low: 85, high: 87.1 }, -0.5))).includes('Bullish engulfing'));
});

test('forming patterns are labeled, closed-only waits, and identity survives candle close', () => {
  const live = analyze(impulse(), settings, NOW - 30_000);
  assert.ok(live.signals.length > 0);
  assert.ok(live.signals.every(signal => signal.provisional));
  assert.equal(analyze(impulse(), { ...settings, live: false }, NOW - 30_000).signals.length, 0);
  const closed = analyze(impulse(), settings, NOW);
  assert.ok(closed.signals.every(signal => !signal.provisional));
  assert.deepEqual(live.signals.map(s => s.id), closed.signals.map(s => s.id));
});

test('insufficient, stale, future, gapped or malformed candles never emit signals', () => {
  assert.equal(analyze(bars().slice(-10)).status, 'waiting');
  assert.equal(analyze(impulse(), settings, NOW, NOW + 66_000).status, 'stale');
  assert.equal(analyze(impulse(), settings, NOW + 120_000).status, 'stale');
  assert.equal(analyze(impulse(), settings, NOW - 120_000).status, 'stale');
  const gap = impulse(); gap.splice(20, 1);
  assert.equal(analyze(gap).status, 'gap');
  const invalid = impulse(); invalid[20].close = NaN;
  assert.deepEqual(analyze(invalid).signals, []);
  const period = impulse(); period[20].endTime++;
  assert.equal(analyze(period).status, 'gap');
});

test('arming is quiet; a new pattern flashes once even when the forming bar later closes', () => {
  const empty = analyze(bars(), settings, NOW - 30_000);
  const armed = advanceAlerts(null, empty, NOW - 30_000);
  assert.deepEqual(armed.alerts, []);
  const first = advanceAlerts(armed.cursor, analyze(impulse(), settings, NOW - 15_000), NOW - 15_000);
  assert.ok(first.alerts.length > 0);
  assert.deepEqual(advanceAlerts(first.cursor, analyze(impulse()), NOW).alerts, []);
  assert.deepEqual(advanceAlerts(first.cursor, analyze(impulse()), NOW + 70_000).alerts, []);
  assert.deepEqual(advanceAlerts(null, analyze(impulse()), NOW).alerts, []);
});

test('cooldown, recovery and returning after a polling gap suppress old events', () => {
  const reading = analyze(impulse());
  const armed = advanceAlerts(null, analyze(bars()), NOW - 60_000);
  const first = advanceAlerts(armed.cursor, reading, NOW);
  const next = { ...reading, signals: reading.signals.map(s => ({ ...s, id: `${s.id}:new` })) };
  const cooling = advanceAlerts(first.cursor, next, NOW + 30_000);
  assert.deepEqual(cooling.alerts, []);
  // Suppressed events are marked seen, so they cannot become delayed alarms.
  assert.deepEqual(advanceAlerts(cooling.cursor, next, NOW + 61_000).alerts, []);
  assert.deepEqual(advanceAlerts(first.cursor, next, NOW + 91_000).alerts, []);
  assert.equal(advanceAlerts(first.cursor, { ...reading, status: 'stale' }, NOW).cursor, null);
});

test('maps exact venues, quote currencies and intervals without substituting feeds', () => {
  assert.equal(resolveCandleFeed('BINANCE:BTCUSDT', '1').venue, 'binance-spot');
  assert.equal(resolveCandleFeed('BINANCE:BTCUSDT.P', '60').venue, 'binance-perp');
  assert.equal(resolveCandleFeed('BINANCE:BTCUSDC.P', '1D').upstreamInterval, '1d');
  assert.equal(resolveCandleFeed('HIP3XYZ:XYZ100USDC.P', '5').dex, 'xyz');
  assert.equal(resolveCandleFeed('HYPERLIQUID:KPEPEUSDC.P', '1').ticker, 'KPEPE');
  for (const [symbol, interval] of [['BINANCE:BTCUSD.P','1'], ['COINBASE:BTCUSD','1'], ['HYPERLIQUID:HYPEUSDC','1'], ['BINANCE:BTCUSDT','45'], ['BINANCE:BTCUSDT','M'], ['https://example.com','1']]) {
    assert.equal(typeof resolveCandleFeed(symbol, interval), 'string');
  }
});

test('Hyperliquid resolves case from metadata and refuses delisted or mismatched markets', () => {
  const meta = { universe: [{ name: 'kPEPE' }, { name: 'xyz:XYZ100' }, { name: 'OLD', isDelisted: true }] };
  assert.equal(resolveHyperliquidCoin(meta, 'KPEPE', ''), 'kPEPE');
  assert.equal(resolveHyperliquidCoin(meta, 'XYZ100', 'xyz'), 'xyz:XYZ100');
  assert.throws(() => resolveHyperliquidCoin(meta, 'XYZ100', 'abc'));
  assert.throws(() => resolveHyperliquidCoin(meta, 'OLD', ''));
  assert.throws(() => resolveHyperliquidCoin(null, 'BTC', ''));
});

test('candle parsers sort, deduplicate and normalize inclusive close times', () => {
  const candles = bars();
  const raw = rawBinance(candles);
  assert.deepEqual(parseCandles([...raw].reverse().concat([raw[0]]), 'binance-spot'), candles);
  const hl = candles.map(c => ({ t: c.time, T: c.endTime - 1, o: String(c.open), h: String(c.high), l: String(c.low), c: String(c.close), v: String(c.volume) }));
  assert.deepEqual(parseCandles(hl, 'hyperliquid'), candles);
  for (const broken of [null, [], [[1, '', 2, 1, 1, 0, 60_000]], [[1, 10, 2, 1, 10, 0, 60_000]], [[1, 1, 2, 1, 1, -1, 60_000]]]) {
    assert.throws(() => parseCandles(broken, 'binance-spot'));
  }
});

test('same-market reads share an in-flight call; a failed refresh keeps its old timestamp', async t => {
  delete globalThis.__mccHlState_v1;
  let now = NOW;
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls > 1) return new Response('', { status: 451 });
    await new Promise(resolve => setTimeout(resolve, 10));
    return Response.json(rawBinance(bars()));
  });
  const feed = resolveCandleFeed('BINANCE:BTCUSDT', '1');
  const [a, b] = await Promise.all([getCandleSnapshot(feed), getCandleSnapshot(feed)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  now += 30_000;
  const failure = await getCandleSnapshot(feed);
  assert.equal(failure.fetchedAt, NOW);
  assert.deepEqual(failure.candles, a.candles);
  assert.match(failure.error, /region/);
  await getCandleSnapshot(feed);
  assert.equal(calls, 2, 'errors are cached to prevent a retry storm');
});

test('perpetuals use their own endpoint and never fall back to spot when blocked', async t => {
  delete globalThis.__mccHlState_v1;
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(String(url)); return new Response('', { status: 451 }); });
  const result = await getCandleSnapshot(resolveCandleFeed('BINANCE:BTCUSDT.P', '1'));
  assert.match(urls[0], /^https:\/\/fapi\.binance\.com\/fapi\/v1\/klines/);
  assert.equal(urls.length, 1);
  assert.equal(result.fetchedAt, 0);
  assert.match(result.error, /region/);
});

test('Hyperliquid requests confirmed metadata names and rejects a wrong-symbol response', async t => {
  delete globalThis.__mccHlState_v1;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (body.type === 'meta') return Response.json({ universe: [{ name: 'kPEPE' }] });
    return Response.json([{ s: 'BTC', i: '1m' }]);
  });
  const result = await getCandleSnapshot(resolveCandleFeed('HYPERLIQUID:KPEPEUSDC.P', '1'));
  assert.equal(requests[1].req.coin, 'kPEPE');
  assert.match(result.error, /different market/);
});

test('alert settings are sanitized and survive save/share separately for duplicate charts', () => {
  const config = parseDashboardConfig(new URLSearchParams('pairs=BINANCE:BTCUSDT,BINANCE:BTCUSDT'));
  config.chartAlerts = { 0: settings, 1: { ...settings, enabled: false, minMovePct: 3, live: false } };
  assert.deepEqual(parseDashboardConfig(writeDashboardParams(new URLSearchParams(), config)), config);
  assert.deepEqual(parseDashboardConfig(new URLSearchParams(), JSON.parse(JSON.stringify(config))), config);
  const removed = applyDashboardEdits(config, ['', 'BINANCE:BTCUSDT']);
  assert.deepEqual(removed.chartAlerts, { 0: config.chartAlerts[1] });
  const changed = applyDashboardEdits(config, ['BINANCE:ETHUSDT', 'BINANCE:BTCUSDT']);
  assert.equal(changed.chartAlerts[0], undefined);
  const shared = parseDashboardConfig(new URLSearchParams('pairs=BINANCE:ETHUSDT'), config);
  assert.deepEqual(shared.chartAlerts, {});
  assert.deepEqual(parseDashboardConfig(new URLSearchParams('ca=broken')).chartAlerts, {});
  const invalid = parseChartAlertSettings({ enabled: 'yes', live: 1, minMovePct: -1, atrMultiple: Infinity });
  assert.equal(invalid.enabled, false);
  assert.equal(invalid.live, true);
  assert.equal(invalid.minMovePct, 0.05);
  assert.equal(invalid.atrMultiple, 1.5);
});
