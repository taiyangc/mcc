import test from 'node:test';
import assert from 'node:assert/strict';
import talib from 'talib';
import { CANDLE_PATTERNS, TALIB_PATTERNS, PATTERN_BY_CODE } from '../src/app/lib/chartAlerts/catalog.ts';
import { recognizeCandles } from '../src/app/lib/chartAlerts/engine.ts';
import { analyzeCandles } from '../src/app/lib/chartAlerts/patterns.ts';
import { advanceAlerts } from '../src/app/lib/chartAlerts/notifications.ts';
import { DEFAULT_CHART_ALERTS, parseChartAlertSettings } from '../src/app/lib/chartAlerts/types.ts';

const PERIOD = 60_000;
const START = Date.UTC(2026, 9, 24);
const config = { ...DEFAULT_CHART_ALERTS, enabled: true, momentum: false, breakouts: false };
const bar = ([open, high, low, close], i) => ({ open, high, low, close, volume: 100, time: START + i * PERIOD, endTime: START + (i + 1) * PERIOD });
function fixture(rows, trend = 'down') {
  const slope = trend === 'up' ? 0.4 : trend === 'down' ? -0.4 : 0;
  const history = Array.from({ length: 40 }, (_, i) => {
    const close = 100 + (i - 39) * slope;
    const open = close - (slope > 0 ? 0.6 : slope < 0 ? -0.6 : i % 2 ? 0.6 : -0.6);
    return bar([open, Math.max(open, close) + 0.3, Math.min(open, close) - 0.3, close], i);
  });
  return [...history, ...rows.map((row, i) => bar(row, i + history.length))];
}
function analyze(candles, settings = config, now = candles.at(-1).endTime) {
  return analyzeCandles(candles, PERIOD, settings, now, now, recognizeCandles(candles, PERIOD));
}
const find = (candles, code, settings = config) => analyze(candles, settings).signals.find(s => s.code === code);
const mirror = rows => rows.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);

const engulfing = [[100, 100.2, 97.8, 98], [97.9, 100.3, 97.8, 100.2]];
const morning = [[100, 100.2, 95.8, 96], [95.3, 95.5, 94.8, 95.1], [95.5, 99, 95.3, 98.8]];
const morningDoji = [morning[0], [95.2, 95.5, 94.8, 95.21], morning[2]];
const methods = [[100, 106.2, 99.8, 106], [105.5, 105.7, 104.3, 104.5], [104.5, 104.7, 103.3, 103.5], [103.5, 103.7, 102.3, 102.5], [103, 107.2, 102.8, 107]];
const hikkake = [[100, 103, 97, 101], [100, 102, 98, 100], [99, 101, 96, 99]];

// Explicit OHLC examples exercise the native engine and the app's context layer,
// including both signed families and the four-/five-candle formations.
const examples = [
  ['CDLHAMMER', 'down', [[99.9, 100.15, 97.9, 100.1]], 'up'],
  ['CDLHANGINGMAN', 'up', [[100.4, 100.65, 98.5, 100.6]], 'down'],
  ['CDLINVERTEDHAMMER', 'down', [[99.5, 102, 99.45, 99.7]], 'up'],
  ['CDLSHOOTINGSTAR', 'up', [[100.5, 103, 100.25, 100.3]], 'down'],
  ['CDLMARUBOZU', 'flat', [[100, 104.01, 99.99, 104]], 'up'],
  ['CDLSPINNINGTOP', 'flat', [[100, 100.9, 99.5, 100.4]], 'neutral'],
  ['CDLSPINNINGTOP', 'flat', mirror([[100, 100.9, 99.5, 100.4]]), 'neutral'],
  ['CDLHIGHWAVE', 'flat', [[100, 104, 96, 100.3]], 'neutral'],
  ['CDLRICKSHAWMAN', 'flat', [[100, 103, 97, 100.02]], 'neutral'],
  ['CDLGRAVESTONEDOJI', 'flat', [[100, 104, 99.99, 100.02]], 'neutral'],
  ['CDLGRAVESTONEDOJI', 'up', [[100, 104, 99.99, 100.02]], 'down'],
  ['CDLENGULFING', 'down', engulfing, 'up'],
  ['CDLENGULFING', 'up', mirror(engulfing), 'down'],
  ['CDLHARAMI', 'down', [[100, 100.3, 95.7, 96], [97, 97.8, 96.6, 97.4]], 'up'],
  ['CDLHARAMICROSS', 'down', [[100, 100.3, 95.7, 96], [97, 97.8, 96.6, 97.02]], 'up'],
  ['CDLPIERCING', 'down', [[100, 100.2, 95.8, 96], [95.5, 99.2, 95.3, 99]], 'up'],
  ['CDLDARKCLOUDCOVER', 'up', [[100, 104.2, 99.8, 104], [104.5, 104.7, 100.8, 101]], 'down'],
  ['CDLMORNINGSTAR', 'down', morning, 'up'],
  ['CDLEVENINGSTAR', 'up', mirror(morning), 'down'],
  ['CDLMORNINGDOJISTAR', 'down', morningDoji, 'up'],
  ['CDLEVENINGDOJISTAR', 'up', mirror(morningDoji), 'down'],
  ['CDL3INSIDE', 'down', [[100, 100.3, 95.7, 96], [97, 97.8, 96.6, 97.4], [97.4, 100.5, 97.3, 100.2]], 'up'],
  ['CDL3OUTSIDE', 'down', [...engulfing, [100.1, 101.2, 100, 101]], 'up'],
  ['CDL3WHITESOLDIERS', 'down', [[100, 101.55, 99.9, 101.5], [101, 103.05, 100.9, 103], [102.5, 104.55, 102.4, 104.5]], 'up'],
  ['CDLABANDONEDBABY', 'down', [morning[0], [95.2, 95.4, 95, 95.21], [96, 99.1, 95.6, 99]], 'up'],
  ['CDLTRISTAR', 'down', [[100, 100.3, 99.7, 100.01], [99.5, 99.7, 99.3, 99.51], [99.8, 100, 99.6, 99.81]], 'up'],
  ['CDL3LINESTRIKE', 'up', [[100, 102.1, 99.9, 102], [101.5, 103.6, 101.4, 103.5], [103, 105.1, 102.9, 105], [105.5, 105.6, 98.9, 99]], 'up'],
  ['CDLCONCEALBABYSWALL', 'down', [[100, 100.05, 95.95, 96], [95.5, 95.55, 91.45, 91.5], [90.5, 92, 89.8, 90], [92.5, 92.7, 88.8, 89]], 'up'],
  ['CDLRISEFALL3METHODS', 'up', methods, 'up'],
  ['CDLRISEFALL3METHODS', 'down', mirror(methods), 'down'],
  ['CDLMATHOLD', 'up', [[100, 106.2, 99.8, 106], [107, 107.2, 106.3, 106.5], [106.3, 106.5, 105.3, 105.5], [105.5, 105.7, 104.8, 105], [105.5, 108.2, 105.3, 108]], 'up'],
  ['CDLBREAKAWAY', 'down', [[100, 100.2, 95.8, 96], [95, 95.2, 93.8, 94], [93.8, 94, 92.8, 93], [92.8, 93, 91.8, 92], [92, 95.7, 91.8, 95.5]], 'up'],
  ['TWEEZERBOTTOM', 'down', [[100, 100.2, 98.8, 99], [99.1, 100, 98.82, 99.8]], 'up'],
  ['TWEEZERTOP', 'up', mirror([[100, 100.2, 98.8, 99], [99.1, 100, 98.82, 99.8]]), 'down'],
];

for (const [code, trend, rows, direction] of examples) {
  test(`${code}: ${rows.length}-candle ${direction} recognition in ${trend} context`, () => {
    const candles = fixture(rows, trend);
    const signal = find(candles, code);
    assert.ok(signal, `Missing ${code}; got ${analyze(candles).signals.map(s => s.code).join(', ')}`);
    assert.equal(signal.direction, direction);
    assert.equal(signal.candleCount, rows.length);
    assert.equal(signal.startTime, candles[40].time);
    assert.equal(signal.time, candles.at(-1).time);
    assert.equal(signal.provisional, false);
    assert.ok(signal.reason.length > 30);
  });
}

test('all 61 native families have unique metadata, explanations and the correct candle counts', () => {
  assert.equal(CANDLE_PATTERNS.length, 63);
  assert.equal(PATTERN_BY_CODE.size, 63);
  assert.deepEqual(TALIB_PATTERNS.map(p => p.code).sort(), talib.functions.filter(f => f.name.startsWith('CDL')).map(f => f.name).sort());
  for (const definition of CANDLE_PATTERNS) {
    assert.ok(definition.summary.length > 40);
    assert.match(definition.source, /^https:\/\//);
    assert.ok(definition.candles >= 1 && definition.candles <= 5);
    for (const code of definition.suppresses ?? []) assert.ok(PATTERN_BY_CODE.has(code));
  }
  assert.equal(PATTERN_BY_CODE.get('CDL2CROWS').candles, 3);
  assert.equal(PATTERN_BY_CODE.get('CDL3LINESTRIKE').candles, 4);
  assert.equal(PATTERN_BY_CODE.get('CDLRISEFALL3METHODS').candles, 5);
  assert.equal(PATTERN_BY_CODE.get('CDLHIKKAKEMOD').maxCandles, 7);
});

test('neutral shapes ignore the library sign, prefer specific names and only flash on opt-in', () => {
  const candles = fixture([[100, 103, 97, 100.02]], 'flat');
  const raw = recognizeCandles(candles, PERIOD).filter(m => m.index === 40);
  assert.ok(raw.some(m => m.code === 'CDLDOJI' && m.value === 100));
  const analysis = analyze(candles);
  assert.deepEqual(analysis.signals.map(s => [s.code, s.direction]), [['CDLRICKSHAWMAN', 'neutral']]);
  const now = candles.at(-1).endTime;
  const armed = advanceAlerts(null, { ...analysis, signals: [] }, now - 30_000).cursor;
  assert.deepEqual(advanceAlerts(armed, analysis, now).alerts, []);
  assert.equal(advanceAlerts(armed, analysis, now, true).alerts[0].direction, 'neutral');
});

test('trend is measured before the whole formation and never manufactured by the pattern itself', () => {
  const trending = fixture(morning, 'down');
  const flat = fixture(morning, 'flat');
  assert.ok(recognizeCandles(flat, PERIOD).some(m => m.code === 'CDLMORNINGSTAR' && m.index === 42));
  assert.ok(find(trending, 'CDLMORNINGSTAR'));
  assert.equal(find(flat, 'CDLMORNINGSTAR'), undefined);
  assert.equal(find(fixture(morning, 'up'), 'CDLMORNINGSTAR'), undefined);
  assert.equal(find(fixture(methods, 'flat'), 'CDLRISEFALL3METHODS'), undefined);
});

test('traditional gaps and body penetration are not relaxed for 24/7 markets', () => {
  const noGap = morning.map(row => [...row]);
  noGap[1] = [96.2, 96.4, 95.8, 96.1];
  assert.equal(find(fixture(noGap), 'CDLMORNINGSTAR'), undefined);
  const shallow = morning.map(row => [...row]);
  shallow[2] = [95.5, 97.2, 95.3, 97.1]; // Less than 30% into the first body.
  assert.equal(find(fixture(shallow), 'CDLMORNINGSTAR'), undefined);
});

test('a doji-star subtype replaces its generic star and has its own explanation', () => {
  const analysis = analyze(fixture(morningDoji));
  assert.ok(analysis.signals.some(s => s.code === 'CDLMORNINGDOJISTAR'));
  assert.ok(!analysis.signals.some(s => s.code === 'CDLMORNINGSTAR'));
});

test('candle groups are independent of impulse thresholds and migrate from saved legacy settings', () => {
  const candles = fixture([[100, 104.01, 99.99, 104]], 'flat');
  assert.ok(find(candles, 'CDLMARUBOZU', { ...config, minMovePct: 25, atrMultiple: 10 }));
  assert.equal(find(candles, 'CDLMARUBOZU', { ...config, basics: false }), undefined);
  assert.equal(find(fixture(methods, 'up'), 'CDLRISEFALL3METHODS', { ...config, continuations: false }), undefined);
  assert.equal(find(fixture(morning), 'CDLMORNINGSTAR', { ...config, reversals: false }), undefined);
  assert.equal(find(fixture([[100, 103, 97, 100.02]], 'flat'), 'CDLRICKSHAWMAN', { ...config, neutral: false }), undefined);
  const saved = parseChartAlertSettings({ enabled: true, reversals: false });
  assert.equal(saved.reversals, false);
  assert.equal(saved.continuations, true);
  assert.equal(saved.basics, true);
  assert.equal(saved.neutral, true);
  assert.equal(saved.flashNeutral, false);
  assert.equal(parseChartAlertSettings({ flashNeutral: 'true', neutral: false }).flashNeutral, false);
});

test('native output offsets align exactly, without future candles changing a closed reading', () => {
  const candles = fixture(morning);
  const first = analyze(candles, { ...config, live: false });
  const extended = [...candles, bar([98.8, 150, 70, 140], candles.length)];
  const fetchedAt = candles.at(-1).endTime + 10_000;
  const second = analyze(extended, { ...config, live: false }, fetchedAt);
  assert.deepEqual(second.signals, first.signals);
  for (const definition of TALIB_PATTERNS) {
    const result = talib.execute({ name: definition.code, startIdx: 0, endIdx: candles.length - 1,
      open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close),
      ...(definition.penetration == null ? {} : { optInPenetration: definition.penetration }) });
    const expected = result.result.outInteger.at(-1);
    const actual = recognizeCandles(candles, PERIOD).find(m => m.code === definition.code && m.index === candles.length - 1)?.value ?? 0;
    assert.equal(actual, expected, `${definition.code} lost its output offset`);
  }
});

test('Hikkake confirmation is anchored to the setup and distinct from candle-close status', () => {
  const setup = fixture(hikkake, 'flat');
  const initial = find(setup, 'CDLHIKKAKE');
  assert.ok(initial);
  assert.equal(initial.variant, 'standard');
  assert.match(initial.reason, /Setup only/);
  assert.equal(initial.candleCount, 3);
  const confirmed = fixture([...hikkake, [100, 103.5, 99, 103]], 'flat');
  const signal = find(confirmed, 'CDLHIKKAKE');
  assert.ok(signal);
  assert.equal(signal.variant, 'confirmed');
  assert.equal(signal.candleCount, 4);
  assert.equal(signal.startTime, initial.startTime);
  assert.notEqual(signal.id, initial.id);
  const forming = analyze(confirmed, config, confirmed.at(-1).endTime - 30_000).signals.find(s => s.variant === 'confirmed');
  assert.equal(forming.provisional, true);
  assert.equal(forming.id, signal.id);
  const noConfirmation = fixture([...hikkake, [99, 101.5, 97, 100]], 'flat');
  assert.equal(find(noConfirmation, 'CDLHIKKAKE')?.variant === 'confirmed', false);
});

test('touching engulfing edges are labeled, and strengthening to strict engulfing does not re-alert', () => {
  const touching = fixture([engulfing[0], [98, 100.3, 97.8, 100.2]]);
  const strict = fixture(engulfing);
  const initial = find(touching, 'CDLENGULFING');
  const strengthened = find(strict, 'CDLENGULFING');
  assert.equal(initial.variant, 'touching');
  assert.equal(strengthened.variant, 'standard');
  assert.equal(initial.id, strengthened.id);
  assert.match(initial.reason, /Touching-boundary/);
});

test('Hikkake confirmation windows include the third later candle but expire after it', () => {
  const pause = [[99, 101.5, 96.5, 100], [100, 101.6, 96.6, 100]];
  const breakout = [100, 103.5, 99, 103];
  const lastChance = find(fixture([...hikkake, ...pause, breakout], 'flat'), 'CDLHIKKAKE');
  assert.equal(lastChance.variant, 'confirmed');
  assert.equal(lastChance.candleCount, 6);
  const expired = find(fixture([...hikkake, ...pause, [100, 101.7, 96.7, 100], breakout], 'flat'), 'CDLHIKKAKE');
  assert.equal(expired?.variant === 'confirmed', false);
  const modified = [[100, 104, 96, 101], [100, 103, 97, 97.1], [99, 102, 98, 100], [99, 101, 96, 99]];
  const signal = find(fixture([...modified, ...pause, breakout]), 'CDLHIKKAKEMOD');
  assert.equal(signal.variant, 'confirmed');
  assert.equal(signal.candleCount, 7);
  assert.equal(signal.startTime, START + 40 * PERIOD);
});

test('tweezer tolerance rejects merely similar extrema and requires a preceding trend', () => {
  const rows = [[100, 100.2, 98.8, 99], [99.1, 100, 98.82, 99.8]];
  assert.ok(find(fixture(rows), 'TWEEZERBOTTOM'));
  assert.equal(find(fixture(rows, 'flat'), 'TWEEZERBOTTOM'), undefined);
  assert.equal(find(fixture([rows[0], [99.1, 100, 98.65, 99.8]]), 'TWEEZERBOTTOM'), undefined);
});

test('malformed and interrupted histories are rejected before calling the native engine', () => {
  const candles = fixture(morning);
  const broken = candles.map(c => ({ ...c })); broken[10].close = NaN;
  assert.deepEqual(recognizeCandles(broken, PERIOD), []);
  assert.deepEqual(recognizeCandles(candles.filter((_, i) => i !== 10), PERIOD), []);
  assert.deepEqual(recognizeCandles(candles.slice(-20), PERIOD), []);
  assert.deepEqual(recognizeCandles(candles, NaN), []);
  const flat = candles.map(c => ({ ...c, open: 100, high: 100, low: 100, close: 100 }));
  assert.deepEqual(analyze(flat).signals, []);
  assert.equal(analyzeCandles(candles, PERIOD, config, NaN).status, 'stale');
});
