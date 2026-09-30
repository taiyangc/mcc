import { hlInfo, mapWithConcurrency, RateLimitError, sharedCache } from './client';
import { getPerpStats } from './perpStats';
import type { CoinStat } from './perpStats';
import { getMoveHistory } from './moveHistory';
import {
  contextMoves, MINUTE, MOVE_BASELINE_WINDOWS, MOVE_MAX_COINS, MOVE_MIN_DAY_VOLUME,
  MOVE_MIN_OI_USD, MOVE_MINUTES, MOVE_WINDOWS, parseMoveCandles, updateMoveEvents, volumeMove,
} from './marketMoves';
import type { MarketMovesResponse, MoveCandle, MoveEvent, MoveReading, MoveRow } from './marketMoves';

const HISTORY_MINUTES = MOVE_MINUTES['1h'] * (MOVE_BASELINE_WINDOWS + 1);
interface CandleSnapshot { candles: MoveCandle[]; error: string | null }

/** Shared per coin across windows, selections and widgets. Only missing minutes refetch. */
async function candlesFor(coin: string): Promise<CandleSnapshot> {
  const cache = sharedCache<CandleSnapshot>('moveCandles_v1', 45_000, 256);
  return cache.get(coin, async () => {
    const previous = cache.peek(coin)?.candles ?? [];
    const endTime = Date.now();
    const historyStart = Math.floor(endTime / MINUTE) * MINUTE - HISTORY_MINUTES * MINUTE;
    let startTime = Math.max(historyStart, previous.at(-2)?.t ?? historyStart);
    // Repair an interior gap as well as appending new minutes. Missing data must not
    // leave a whole window unusable until it eventually ages out of the cache.
    for (let i = 1; i < previous.length; i++) {
      if (previous[i].t - previous[i - 1].t > MINUTE && previous[i].t > historyStart) {
        startTime = Math.min(startTime, Math.max(historyStart, previous[i - 1].t));
        break;
      }
    }
    // Include the response-size surcharge, rounded up, and the current partial candle.
    const weight = 20 + Math.ceil((Math.ceil((endTime - startTime) / MINUTE) + 1) / 60);
    try {
      const raw = await hlInfo<unknown>({ type: 'candleSnapshot', req: { coin, interval: '1m', startTime, endTime } }, { weight });
      if (!Array.isArray(raw)) throw new Error('Candle history unavailable');
      const incoming = parseMoveCandles(raw, coin);
      if (raw.length > 0 && incoming.length === 0) throw new Error('Invalid candle history');
      const merged = new Map(previous.map(c => [c.t, c]));
      for (const candle of incoming) merged.set(candle.t, candle);
      return { candles: Array.from(merged.values()).filter(c => c.t >= historyStart && c.t <= endTime).sort((a, b) => a.t - b.t).slice(-HISTORY_MINUTES - 1), error: null };
    } catch (err) {
      // Cache failures too: rapid refreshes must not repeatedly spend scarce rate budget.
      return { candles: previous, error: err instanceof RateLimitError ? 'Volume refresh rate limited' : 'Volume refresh unavailable' };
    }
  });
}

interface EventState { events: MoveEvent[] }
function eventState(): EventState {
  const root = globalThis as unknown as Record<string, EventState | undefined>;
  return root.__mccHlMoveEvents_v1 ??= { events: [] };
}

function recentOiUsd(coin: CoinStat): number {
  // Keep a large contraction eligible even when it falls below the current OI floor.
  return Math.max(coin.oiUsd, ...getMoveHistory(coin.coin).map(p => p.oiCoins * coin.markPx));
}

async function loadMarketMoves(selection: string[] | null): Promise<MarketMovesResponse> {
  const stats = await getPerpStats();
  const byCoin = new Map(stats.coins.map(c => [c.coin, c]));
  const liquid = (coin: CoinStat) => recentOiUsd(coin) >= MOVE_MIN_OI_USD && coin.dayNtlVlm >= MOVE_MIN_DAY_VOLUME;
  const selected = selection ?? stats.coins.filter(liquid).sort((a, b) => recentOiUsd(b) - recentOiUsd(a)).slice(0, MOVE_MAX_COINS).map(c => c.coin);
  const coins = selected.flatMap(coin => byCoin.has(coin) ? [byCoin.get(coin)!] : []);
  const candles = await mapWithConcurrency(coins, 3, coin => candlesFor(coin.coin));
  const now = Date.now();
  const readings: MoveReading[] = [];
  const windows = {} as MarketMovesResponse['windows'];

  for (const window of MOVE_WINDOWS) {
    const rows: MoveRow[] = coins.map((coin, i) => {
      const history = contextMoves(coin.coin, getMoveHistory(coin.coin), window, now);
      const volume = volumeMove(coin.coin, candles[i].candles, window, now);
      const eligible = liquid(coin);
      for (const reading of [history.oi, history.funding, volume]) {
        if (reading) {
          reading.qualifies &&= eligible;
          readings.push(reading);
        }
      }
      return {
        coin: coin.coin, markPx: coin.markPx, oiUsd: coin.oiUsd, fundingHourly: coin.fundingHourly,
        liquid: eligible, ...history, volume,
        volumeIssue: candles[i].error ?? (volume ? null : 'Waiting for complete candle history and a nonzero baseline'),
      };
    });
    windows[window] = { rows, events: [] };
  }
  const state = eventState();
  state.events = updateMoveEvents(state.events, readings, now);
  for (const window of MOVE_WINDOWS) windows[window].events = state.events.filter(e => e.window === window && selected.includes(e.coin));
  return {
    ts: now, asOf: stats.ts, windows, availableCoins: stats.coins.map(c => c.coin),
    missingCoins: selected.filter(c => !byCoin.has(c)),
  };
}

export function getMarketMoves(selection: string[] | null): Promise<MarketMovesResponse> {
  const normalized = selection?.slice().sort() ?? null;
  return sharedCache<MarketMovesResponse>('marketMoves_v1', 20_000, 32)
    .get(normalized?.join('-') ?? 'TOP', () => loadMarketMoves(normalized));
}
