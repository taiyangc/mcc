import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMoveSample, contextMoves, finiteNumber, MINUTE, MOVE_EVENT_TTL,
  moveRank, parseMoveCandles, updateMoveEvents, volumeMove,
} from '../src/app/lib/hl/marketMoves.ts';
import { getMoveHistory, recordMoveHistory } from '../src/app/lib/hl/moveHistory.ts';
import { parseHlPanel, serializeHlPanel, HL_PANEL_CATALOG } from '../src/app/lib/hl/panels.ts';
import { getSlotIds, normalizePairInput } from '../src/app/lib/pairs.ts';

const NOW = Date.UTC(2026, 8, 29, 16, 0);
const sample = (t, values = {}) => ({ t, markPx: 10, oiCoins: 1_000_000, fundingHourly: 0.00001, ...values });
const history = (last = {}, minutes = 5) => Array.from({ length: minutes + 1 }, (_, i) => sample(NOW - (minutes - i) * MINUTE, i === minutes ? last : {}));
function candles(ratio = 1, minutes = 5) {
  return Array.from({ length: minutes * 13 }, (_, i) => ({ t: NOW - (minutes * 13 - i) * MINUTE, o: 100, c: 100, v: i < minutes * 12 ? 2000 : 2000 * ratio }));
}
const reading = (values = {}) => ({ ...contextMoves('BTC', history({ oiCoins: 1_100_000 }), '5m', NOW).oi, ...values });

test('OI detects increases and contractions without counting price appreciation', () => {
  const priceOnly = contextMoves('BTC', history({ markPx: 15 }), '5m', NOW).oi;
  assert.equal(priceOnly.value, 0);
  assert.equal(priceOnly.impactUsd, 0);
  assert.equal(priceOnly.qualifies, false);
  for (const [oiCoins, direction] of [[1_100_000, 'UP'], [900_000, 'DOWN'], [0, 'DOWN']]) {
    const result = contextMoves('BTC', history({ oiCoins, markPx: 12 }), '5m', NOW).oi;
    assert.equal(result.direction, direction);
    assert.equal(result.impactUsd, (oiCoins - 1_000_000) * 12);
    assert.equal(result.qualifies, true);
  }
});

test('a large percent move in a tiny OI baseline does not create a major event', () => {
  const points = history().map(p => ({ ...p, oiCoins: 100 }));
  points.at(-1).oiCoins = 200;
  assert.equal(contextMoves('BTC', points, '5m', NOW).oi.qualifies, false);
  points[0].oiCoins = 0;
  assert.equal(contextMoves('BTC', points, '5m', NOW).oi, null);
});

test('funding deltas are signed absolute hourly basis points, including negative and zero rates', () => {
  for (const [before, after, direction] of [[-0.00002, 0.00004, 'UP'], [0.00003, -0.00004, 'DOWN'], [0, 0.00006, 'UP']]) {
    const points = history().map(p => ({ ...p, fundingHourly: before }));
    points.at(-1).fundingHourly = after;
    const result = contextMoves('BTC', points, '5m', NOW).funding;
    assert.ok(Math.abs(result.value - (after - before) * 10000) < 1e-10);
    assert.equal(result.direction, direction);
    assert.equal(result.qualifies, true);
  }
});

test('OI and funding wait for a full window and reject stale, gappy or invalid observations', () => {
  const assertMissing = (points, now = NOW) => {
    const result = contextMoves('BTC', points, '5m', now);
    assert.equal(result.oi, null);
    assert.equal(result.funding, null);
  };
  assertMissing(history().slice(1));
  assertMissing(history().filter((_, i) => i !== 2));
  assertMissing(history(), NOW + 100000);
  assertMissing(history({ markPx: NaN }));
  assertMissing(history(), NOW - MINUTE);
  assert.equal(contextMoves('BTC', history(), '5m', NOW).historyMinutes, 5);
});

test('sampling discards duplicates and out-of-order data and restarts after a gap', () => {
  let points = appendMoveSample([], sample(NOW));
  assert.equal(appendMoveSample(points, sample(NOW)), points);
  assert.equal(appendMoveSample(points, sample(NOW - MINUTE)), points);
  assert.equal(appendMoveSample(points, sample(NOW + 30000, { fundingHourly: Infinity })), points);
  points = appendMoveSample(points, sample(NOW + MINUTE));
  assert.equal(points.length, 2);
  points = appendMoveSample(points, sample(NOW + 4 * MINUTE));
  assert.equal(points.length, 1);
  assert.equal(points[0].t, NOW + 4 * MINUTE);
});

test('bad source fields never become fake zero-funding observations', () => {
  assert.equal(finiteNumber(''), null);
  assert.equal(finiteNumber(null), null);
  assert.equal(finiteNumber('garbage'), null);
  const universe = [{ name: 'TEST_MOVE', maxLeverage: 10, szDecimals: 2 }];
  recordMoveHistory(universe, [{ markPx: '10', openInterest: '1000', funding: '0' }], NOW);
  recordMoveHistory(universe, [{ markPx: '10', openInterest: '1000', funding: '' }], NOW + MINUTE);
  assert.equal(getMoveHistory('TEST_MOVE').length, 1);
  recordMoveHistory(universe, [{ markPx: '10', openInterest: '1000', funding: '0.0001' }], NOW + 2 * MINUTE);
  assert.equal(getMoveHistory('TEST_MOVE').length, 1);
});

test('volume detects surges and collapses against complete equal-window baselines', () => {
  for (const ratio of [4, 0.25, 0]) {
    const result = volumeMove('BTC', candles(ratio), '5m', NOW);
    assert.equal(result.value, ratio);
    assert.equal(result.qualifies, true);
    assert.equal(result.direction, ratio > 1 ? 'UP' : 'DOWN');
    assert.ok(Number.isFinite(result.severity));
    assert.equal(result.after / result.before, ratio);
  }
  assert.equal(volumeMove('BTC', candles(1), '5m', NOW).qualifies, false);
});

test('volume uses base units, keeping price direction independent of volume direction', () => {
  const priceOnly = candles().map(c => ({ ...c, c: 200 }));
  assert.equal(volumeMove('BTC', priceOnly, '5m', NOW).qualifies, false);
  const fallingPrice = candles(4).map(c => ({ ...c, c: 90 }));
  const result = volumeMove('BTC', fallingPrice, '5m', NOW);
  assert.equal(result.direction, 'UP');
  assert.ok(result.priceChange < 0);
});

test('a single historical volume spike does not dominate the median baseline', () => {
  const points = candles(4);
  for (let i = 0; i < 5; i++) points[i].v *= 100;
  assert.equal(volumeMove('BTC', points, '5m', NOW).value, 4);
});

test('unfinished candles, missing minutes and zero baselines cannot fabricate a volume alert', () => {
  const points = candles(1);
  points.push({ t: NOW, o: 100, c: 100, v: 1e9 });
  assert.equal(volumeMove('BTC', points, '5m', NOW + 1000).qualifies, false);
  assert.equal(volumeMove('BTC', candles().filter((_, i) => i !== 7), '5m', NOW), null);
  assert.equal(volumeMove('BTC', candles(), '5m', NOW + 3 * MINUTE), null);
  assert.equal(volumeMove('BTC', candles().map(c => ({ ...c, v: 0 })), '5m', NOW), null);
  assert.equal(volumeMove('BTC', candles().map(c => ({ ...c, v: NaN })), '5m', NOW), null);
});

test('every window requires its own complete volume baseline', () => {
  assert.equal(volumeMove('BTC', candles(4), '15m', NOW), null);
  assert.equal(volumeMove('BTC', candles(4, 15), '15m', NOW).value, 4);
  assert.equal(volumeMove('BTC', candles(4, 60), '1h', NOW).value, 4);
});

test('overflowing source values cannot produce nonfinite JSON readings', () => {
  assert.equal(contextMoves('BTC', history({ markPx: 1e308, oiCoins: 1e308 }), '5m', NOW).oi, null);
  assert.equal(contextMoves('BTC', history({ fundingHourly: 1e304 }), '5m', NOW).funding, null);
  assert.equal(volumeMove('BTC', candles().map(c => ({ ...c, v: 1e308 })), '5m', NOW), null);
});

test('candle ingestion validates symbol/interval/numbers and replaces repeated updates', () => {
  const raw = { s: 'kPEPE', i: '1m', t: NOW - MINUTE, o: '1', c: '2', v: '20' };
  const result = parseMoveCandles([raw, { ...raw, v: '25' }, { ...raw, t: NOW - 2 * MINUTE }, { ...raw, t: NOW, v: '' }, { ...raw, s: 'BTC' }, { ...raw, i: '5m' }], 'kPEPE');
  assert.deepEqual(result.map(c => c.t), [NOW - 2 * MINUTE, NOW - MINUTE]);
  assert.equal(result.at(-1).v, 25);
});

test('repeated refreshes update one episode, preserve its peak and do not invent new events', () => {
  let events = updateMoveEvents([], [reading()], NOW);
  const id = events[0].id;
  events = updateMoveEvents(events, [reading()], NOW + 1000);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, id);
  events = updateMoveEvents(events, [reading({ t: NOW + MINUTE, severity: 4 })], NOW + MINUTE);
  events = updateMoveEvents(events, [reading({ t: NOW + 2 * MINUTE, severity: 2 })], NOW + 2 * MINUTE);
  assert.equal(events.length, 1);
  assert.equal(events[0].firstSeen, NOW);
  assert.equal(events[0].lastSeen, NOW + 2 * MINUTE);
  assert.equal(events[0].peakSeverity, 4);
});

test('episodes rearm only after two distinct quiet observations', () => {
  let events = updateMoveEvents([], [reading()], NOW);
  const quiet = reading({ t: NOW + MINUTE, qualifies: false, severity: 0.2 });
  events = updateMoveEvents(events, [quiet, quiet], NOW + MINUTE);
  assert.equal(events[0].active, true);
  events = updateMoveEvents(events, [{ ...quiet, t: NOW + 2 * MINUTE }], NOW + 2 * MINUTE);
  assert.equal(events[0].active, false);
  events = updateMoveEvents(events, [reading({ t: NOW + 3 * MINUTE })], NOW + 3 * MINUTE);
  assert.equal(events.length, 2);
});

test('direction changes and data gaps start separate episodes; expired events disappear', () => {
  let events = updateMoveEvents([], [reading()], NOW);
  events = updateMoveEvents(events, [reading({ t: NOW + MINUTE, direction: 'DOWN', value: -0.1 })], NOW + MINUTE);
  assert.equal(events.length, 2);
  assert.equal(events.filter(e => e.active).length, 1);
  events = updateMoveEvents(events, [reading({ t: NOW + 5 * MINUTE })], NOW + 5 * MINUTE);
  assert.equal(events.length, 3);
  assert.deepEqual(updateMoveEvents(events, [], NOW + MOVE_EVENT_TTL + 6 * MINUTE), []);
});

test('ranking decays with age and treats either direction equally', () => {
  const [event] = updateMoveEvents([], [reading()], NOW);
  assert.equal(moveRank(event, NOW + 15 * MINUTE), moveRank(event, NOW) / 2);
  assert.equal(moveRank({ ...event, direction: 'DOWN' }, NOW), moveRank(event, NOW));
});

test('Market Moves is addable and all controls round-trip through a stable slot URL', () => {
  const entry = HL_PANEL_CATALOG.find(e => e.key === 'moves');
  assert.ok(entry);
  assert.deepEqual(parseHlPanel('HLMOVES'), { kind: 'moves', window: '15m', metric: 'ALL', layout: 'EVENTS', coins: null, direction: 'BOTH' });
  for (const pair of [entry.defaultPair, 'HLMOVES:5m:OI:PAIRS:kPEPE-BTC:DOWN', 'HLMOVES:1h:VOLUME:EVENTS:TOP:UP']) {
    assert.equal(serializeHlPanel(parseHlPanel(pair)), pair);
    assert.equal(normalizePairInput(pair), pair);
    assert.deepEqual(getSlotIds([pair]), ['HLMOVES#0']);
  }
  for (const pair of ['HLMOVES:2m', 'HLMOVES:5m:PRICE', 'HLMOVES:5m:OI:CHART', 'HLMOVES:5m:OI:PAIRS:BTC:SIDEWAYS', 'HLMOVES:5m:ALL:EVENTS:BTC:BOTH:extra', `HLMOVES:5m:ALL:EVENTS:${Array.from({ length: 13 }, (_, i) => `COIN${i}`).join('-')}:BOTH`]) assert.equal(parseHlPanel(pair), null, pair);
});
