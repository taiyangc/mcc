// Pure aggregation for the tracked-trader cohort.
//
// Hyperliquid publishes no protocol-wide long/short or margin figure — open interest
// is symmetric by construction, so every "long vs short" number on any dashboard is a
// sample of some address set. Here that set is the tracked cohort, and these functions
// turn per-account snapshots into the per-cohort and per-coin aggregates the panels show.

export type CohortTag = 'VOL' | 'PNL' | 'WHALE';
export type CohortKey = 'ALL' | CohortTag;

export const COHORT_KEYS: CohortKey[] = ['ALL', 'VOL', 'PNL', 'WHALE'];

export interface AccountPosition {
  coin: string;
  /** Signed size: positive is long, negative is short. */
  szi: number;
  /** Absolute notional in USD. */
  positionValue: number;
  marginUsed: number;
  entryPx: number | null;
  liquidationPx: number | null;
  leverage: number;
  unrealizedPnl: number;
}

export interface AccountSnapshot {
  user: string;
  tags: CohortTag[];
  accountValue: number;
  totalMarginUsed: number;
  positions: AccountPosition[];
  /** When this account's state was last fetched successfully. */
  updatedAt: number;
}

export interface CoinSplit {
  coin: string;
  longUsd: number;
  shortUsd: number;
  longPct: number;
  nLong: number;
  nShort: number;
  longMargin: number;
  shortMargin: number;
}

export interface CohortStats {
  n: number;
  nWithPositions: number;
  longUsd: number;
  shortUsd: number;
  longPct: number;
  accountValue: number;
  marginUsed: number;
  longMarginUsed: number;
  shortMarginUsed: number;
  perCoin: CoinSplit[];
}

export function emptyCohortStats(): CohortStats {
  return {
    n: 0,
    nWithPositions: 0,
    longUsd: 0,
    shortUsd: 0,
    longPct: 0,
    accountValue: 0,
    marginUsed: 0,
    longMarginUsed: 0,
    shortMarginUsed: 0,
    perCoin: [],
  };
}

function longFraction(longUsd: number, shortUsd: number): number {
  const total = longUsd + shortUsd;
  return total > 0 ? longUsd / total : 0;
}

/** Aggregate one cohort's accounts into totals plus a per-coin breakdown. */
export function aggregateCohort(accounts: AccountSnapshot[], maxCoins = 40): CohortStats {
  const stats = emptyCohortStats();
  stats.n = accounts.length;

  const byCoin = new Map<string, CoinSplit>();

  for (const account of accounts) {
    stats.accountValue += account.accountValue;
    stats.marginUsed += account.totalMarginUsed;
    if (account.positions.length > 0) stats.nWithPositions += 1;

    for (const position of account.positions) {
      if (position.szi === 0 || position.positionValue === 0) continue;
      const isLong = position.szi > 0;
      const notional = Math.abs(position.positionValue);
      const margin = Math.abs(position.marginUsed);

      if (isLong) {
        stats.longUsd += notional;
        stats.longMarginUsed += margin;
      } else {
        stats.shortUsd += notional;
        stats.shortMarginUsed += margin;
      }

      let split = byCoin.get(position.coin);
      if (!split) {
        split = {
          coin: position.coin,
          longUsd: 0,
          shortUsd: 0,
          longPct: 0,
          nLong: 0,
          nShort: 0,
          longMargin: 0,
          shortMargin: 0,
        };
        byCoin.set(position.coin, split);
      }
      if (isLong) {
        split.longUsd += notional;
        split.longMargin += margin;
        split.nLong += 1;
      } else {
        split.shortUsd += notional;
        split.shortMargin += margin;
        split.nShort += 1;
      }
    }
  }

  stats.longPct = longFraction(stats.longUsd, stats.shortUsd);

  const perCoin = Array.from(byCoin.values());
  for (const split of perCoin) {
    split.longPct = longFraction(split.longUsd, split.shortUsd);
  }
  perCoin.sort((a, b) => (b.longUsd + b.shortUsd) - (a.longUsd + a.shortUsd));
  stats.perCoin = perCoin.slice(0, maxCoins);

  return stats;
}

/** Aggregate every cohort in one pass over the snapshot list. */
export function aggregateAllCohorts(
  accounts: AccountSnapshot[],
  maxCoins = 40,
): Record<CohortKey, CohortStats> {
  const result = {} as Record<CohortKey, CohortStats>;
  for (const key of COHORT_KEYS) {
    const subset = key === 'ALL' ? accounts : accounts.filter(a => a.tags.includes(key));
    result[key] = aggregateCohort(subset, maxCoins);
  }
  return result;
}

export type PositionChangeKind = 'open' | 'increase' | 'reduce' | 'close' | 'flip';

export interface PositionChange {
  t: number;
  user: string;
  tags: CohortTag[];
  coin: string;
  kind: PositionChangeKind;
  /** Side after the change, or the side that was closed. */
  side: 'long' | 'short';
  /**
   * What the trade was worth: the change in size, valued at one price.
   *
   * Comparing the two cycles' notionals instead would measure the price drift between
   * them as well as the trade, and for the small trades on large books this feed now
   * carries, the drift is the larger of the two — a quarter of rows came out with a sign
   * that contradicted their own action. Positive means exposure grew, always.
   */
  deltaUsd: number;
  positionValue: number;
  /**
   * Average entry of the position this row is about — the new one where the position
   * survives, the one that vanished where it does not. Null only when the upstream
   * omitted it.
   */
  entryPx: number | null;
  /**
   * What the coin was worth when the change was seen. Null when no tracked account still
   * holds the coin, which can happen on the close that emptied it.
   */
  markPx: number | null;
  /**
   * How big the position is, taking the larger of before and after — never how much of
   * it moved. A $100K trim of a $5M book is a $5M trader doing something, and someone
   * watching for size wants to see it; judging the row by the $100K would hide it, and
   * would hide a flip entirely, since reversing a $200M long moves almost no net
   * notional. Filter and rank on this, never on `deltaUsd`.
   */
  magnitude: number;
}

export interface FlatPosition {
  szi: number;
  positionValue: number;
  /** Kept so a position that vanishes can still report what it was entered at. */
  entryPx: number | null;
}

/** user|coin → position, for diffing consecutive cycles. */
export type PositionIndex = Map<string, FlatPosition>;

export function indexPositions(accounts: AccountSnapshot[]): PositionIndex {
  const index: PositionIndex = new Map();
  for (const account of accounts) {
    for (const position of account.positions) {
      if (position.szi === 0) continue;
      index.set(`${account.user}|${position.coin}`, {
        szi: position.szi,
        positionValue: Math.abs(position.positionValue),
        entryPx: position.entryPx,
      });
    }
  }
  return index;
}

/**
 * Mark price per coin, read back out of the positions themselves.
 *
 * Hyperliquid values every position at the same mark, so `positionValue / |szi|` recovers
 * it exactly and the cohort job needs no second call to learn what anything cost. Summing
 * before dividing weights the answer by size, so one small position's rounding cannot
 * move it.
 */
export function markPrices(accounts: AccountSnapshot[]): Map<string, number> {
  const notional = new Map<string, { usd: number; coins: number }>();
  for (const account of accounts) {
    for (const position of account.positions) {
      const size = Math.abs(position.szi);
      const value = Math.abs(position.positionValue);
      if (size === 0 || value === 0) continue;
      const running = notional.get(position.coin) ?? { usd: 0, coins: 0 };
      running.usd += value;
      running.coins += size;
      notional.set(position.coin, running);
    }
  }
  const marks = new Map<string, number>();
  for (const [coin, { usd, coins }] of notional) {
    if (coins > 0) marks.set(coin, usd / coins);
  }
  return marks;
}

function classify(prevSzi: number, nextSzi: number): PositionChangeKind {
  if (prevSzi === 0) return 'open';
  if (nextSzi === 0) return 'close';
  if (Math.sign(prevSzi) !== Math.sign(nextSzi)) return 'flip';
  return Math.abs(nextSzi) > Math.abs(prevSzi) ? 'increase' : 'reduce';
}

/**
 * The smallest position the change feed keeps at all.
 *
 * The ring buffer holds a fixed number of rows, so anything stored below the lowest
 * threshold the UI offers is buffer spent on rows nobody can ever select. Keep this at
 * or below `WHALE_MIN_USD_CHOICES[0]`; a test guards the pair.
 */
export const CHANGE_MIN_USD = 50_000;

/**
 * Diff two cycles into a change feed.
 *
 * Both edges of cohort churn are artefacts, not news, and each is guarded here. An
 * address that dropped out must not be reported as having closed everything, so only
 * accounts present in `accounts` are considered. An address the discovery probe has
 * only just reached arrives with a full book that was there all along, so only accounts
 * in `knownUsers` — the addresses the previous pass actually read — are diffed at all.
 * Without that second guard a rotating probe reports twenty-five traders' entire books
 * as freshly opened every minute. `minUsd` drops books too small to be worth a row.
 */
export function diffPositions(
  previous: PositionIndex,
  accounts: AccountSnapshot[],
  now: number,
  knownUsers: ReadonlySet<string>,
  minUsd = CHANGE_MIN_USD,
): PositionChange[] {
  const changes: PositionChange[] = [];
  const seen = new Set<string>();
  const marks = markPrices(accounts);

  for (const account of accounts) {
    if (!knownUsers.has(account.user)) continue;
    const tags = account.tags;
    for (const position of account.positions) {
      const key = `${account.user}|${position.coin}`;
      seen.add(key);
      const before = previous.get(key);
      const prevSzi = before ? before.szi : 0;
      const prevValue = before ? before.positionValue : 0;
      const nextValue = Math.abs(position.positionValue);
      if (position.szi === prevSzi) continue;
      const kind = classify(prevSzi, position.szi);
      const mark = marks.get(position.coin) ?? null;
      // Falls back to the notional difference only when nothing prices the coin, which
      // cannot happen here — the account holding it is the one being read.
      const deltaUsd =
        mark !== null
          ? (Math.abs(position.szi) - Math.abs(prevSzi)) * mark
          : nextValue - prevValue;
      const magnitude = Math.max(prevValue, nextValue);
      if (magnitude < minUsd) continue;
      changes.push({
        t: now,
        user: account.user,
        tags,
        coin: position.coin,
        kind,
        side: position.szi > 0 ? 'long' : 'short',
        deltaUsd,
        positionValue: nextValue,
        entryPx: position.entryPx,
        markPx: mark,
        magnitude,
      });
    }
  }

  // Positions that vanished for accounts we still track are closes.
  const tracked = new Map(accounts.map(a => [a.user, a] as const));
  for (const [key, before] of previous) {
    if (seen.has(key)) continue;
    const separator = key.lastIndexOf('|');
    const user = key.slice(0, separator);
    const coin = key.slice(separator + 1);
    const account = tracked.get(user);
    if (!account) continue;
    if (before.positionValue < minUsd) continue;
    const mark = marks.get(coin) ?? null;
    changes.push({
      t: now,
      user,
      tags: account.tags,
      coin,
      kind: 'close',
      side: before.szi > 0 ? 'long' : 'short',
      deltaUsd: mark !== null ? -Math.abs(before.szi) * mark : -before.positionValue,
      positionValue: 0,
      entryPx: before.entryPx ?? null,
      markPx: mark,
      magnitude: before.positionValue,
    });
  }

  changes.sort((a, b) => b.magnitude - a.magnitude);
  return changes;
}

export interface LargestPosition extends AccountPosition {
  user: string;
  tags: CohortTag[];
  side: 'long' | 'short';
  /** When this account was last read: a cycle that failed to reach it leaves it behind. */
  updatedAt: number;
}

/** Biggest open positions across the cohort, largest notional first. */
export function largestPositions(accounts: AccountSnapshot[], limit = 100): LargestPosition[] {
  const all: LargestPosition[] = [];
  for (const account of accounts) {
    for (const position of account.positions) {
      if (position.szi === 0) continue;
      all.push({
        ...position,
        user: account.user,
        tags: account.tags,
        side: position.szi > 0 ? 'long' : 'short',
        updatedAt: account.updatedAt,
      });
    }
  }
  all.sort((a, b) => Math.abs(b.positionValue) - Math.abs(a.positionValue));
  return all.slice(0, limit);
}
