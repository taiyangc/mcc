// Funding-rate normalization.
//
// Venues quote funding per settlement interval, and the interval differs by venue and
// even by coin (Hyperliquid settles hourly, Binance 8h for majors but 4h for some
// alts, OKX 8h). Comparing raw rates side by side is misleading, so everything is
// normalized to an annual rate for display, with the raw rate kept as secondary.

export const VENUES = ['HL', 'BINANCE', 'BYBIT', 'OKX'] as const;
export type Venue = (typeof VENUES)[number];

export const VENUE_LABELS: Record<Venue, string> = {
  HL: 'Hyperliquid',
  BINANCE: 'Binance',
  BYBIT: 'Bybit',
  OKX: 'OKX',
};

/** Hyperliquid's predictedFundings venue keys. */
export const HL_VENUE_KEYS: Record<string, Venue> = {
  HlPerp: 'HL',
  BinPerp: 'BINANCE',
  BybitPerp: 'BYBIT',
};

const HOURS_PER_YEAR = 24 * 365;

/** Default settlement interval when a venue omits it. */
export function defaultIntervalHours(venue: Venue): number {
  return venue === 'HL' ? 1 : 8;
}

/** Annualized funding: a 0.01%/8h rate becomes ~10.95%/yr. */
export function toApr(rate: number, intervalHours: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(intervalHours) || intervalHours <= 0) return NaN;
  return rate * (HOURS_PER_YEAR / intervalHours);
}

/** Rate rescaled to a common 8-hour window, for comparing venues at a glance. */
export function to8h(rate: number, intervalHours: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(intervalHours) || intervalHours <= 0) return NaN;
  return rate * (8 / intervalHours);
}

export interface FundingPoint {
  t: number;
  rate: number;
}

export interface VenueFunding {
  venue: Venue;
  rate: number;
  intervalHours: number;
  apr: number;
  rate8h: number;
  nextFundingTime: number | null;
  history?: FundingPoint[];
}

export interface CoinFunding {
  coin: string;
  venues: Partial<Record<Venue, VenueFunding | null>>;
}

export function buildVenueFunding(
  venue: Venue,
  rate: number,
  intervalHours: number,
  nextFundingTime: number | null,
  history?: FundingPoint[],
): VenueFunding {
  return {
    venue,
    rate,
    intervalHours,
    apr: toApr(rate, intervalHours),
    rate8h: to8h(rate, intervalHours),
    nextFundingTime,
    history,
  };
}

/** OKX instrument id for a coin's USDT-margined perpetual. */
export function okxInstId(coin: string): string {
  return `${coin.toUpperCase()}-USDT-SWAP`;
}

/**
 * The next settlement at or after `now`.
 *
 * Venues do not all keep this field current — Hyperliquid's predicted funding can report
 * a settlement that has already passed — so the time is advanced by whole intervals
 * rather than displayed as "now" forever.
 */
export function nextFundingAfter(
  nextFundingTime: number | null,
  intervalHours: number,
  now: number,
): number | null {
  if (nextFundingTime === null || !Number.isFinite(nextFundingTime)) return null;
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) return nextFundingTime;
  const step = intervalHours * 3_600_000;
  if (nextFundingTime > now) return nextFundingTime;
  const periods = Math.floor((now - nextFundingTime) / step) + 1;
  return nextFundingTime + periods * step;
}

/**
 * Spread between the highest and lowest annualized funding across venues, which is the
 * number a basis trade actually cares about.
 */
export function aprSpread(coin: CoinFunding): number | null {
  const aprs = Object.values(coin.venues)
    .filter((v): v is VenueFunding => !!v && Number.isFinite(v.apr))
    .map(v => v.apr);
  if (aprs.length < 2) return null;
  return Math.max(...aprs) - Math.min(...aprs);
}
