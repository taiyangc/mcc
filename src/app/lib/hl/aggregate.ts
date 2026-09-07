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
  /** Signed notional change in USD: positive means exposure grew. */
  deltaUsd: number;
  positionValue: number;
  /**
   * How big the event is. A resize is judged by how much exposure moved, but an open,
   * close or flip is judged by the position itself: reversing a $200M long moves almost
   * no net notional and is still the biggest thing on the screen. Filter and rank on
   * this, never on `deltaUsd`, or flips vanish.
   */
  magnitude: number;
}

export interface FlatPosition {
  szi: number;
  positionValue: number;
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
      });
    }
  }
  return index;
}

function classify(prevSzi: number, nextSzi: number): PositionChangeKind {
  if (prevSzi === 0) return 'open';
  if (nextSzi === 0) return 'close';
  if (Math.sign(prevSzi) !== Math.sign(nextSzi)) return 'flip';
  return Math.abs(nextSzi) > Math.abs(prevSzi) ? 'increase' : 'reduce';
}

/**
 * Diff two cycles into a change feed.
 *
 * Both edges of cohort churn are artefacts, not news, and each is guarded here. An
 * address that dropped out must not be reported as having closed everything, so only
 * accounts present in `accounts` are considered. An address the discovery probe has
 * only just reached arrives with a full book that was there all along, so only accounts
 * in `knownUsers` — the addresses the previous pass actually read — are diffed at all.
 * Without that second guard a rotating probe reports twenty-five traders' entire books
 * as freshly opened every minute. `minUsd` filters out dust.
 */
export function diffPositions(
  previous: PositionIndex,
  accounts: AccountSnapshot[],
  now: number,
  knownUsers: ReadonlySet<string>,
  minUsd = 25_000,
): PositionChange[] {
  const changes: PositionChange[] = [];
  const seen = new Set<string>();

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
      const deltaUsd = nextValue - prevValue;
      const magnitude =
        kind === "increase" || kind === "reduce"
          ? Math.abs(deltaUsd)
          : Math.max(prevValue, nextValue);
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
    changes.push({
      t: now,
      user,
      tags: account.tags,
      coin,
      kind: 'close',
      side: before.szi > 0 ? 'long' : 'short',
      deltaUsd: -before.positionValue,
      positionValue: 0,
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
