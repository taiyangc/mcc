// Hyperliquid data panel specs.
//
// A panel is encoded as a single "pair" string in the URL's comma-separated `pairs`
// list, so a spec may never contain a comma. Lists inside a spec use "-" instead.
// Coin names are case-sensitive (Hyperliquid has kPEPE, kBONK, kSHIB) and may not
// contain ":", "-" or "," — that also excludes HIP-3 dex-qualified names.

export type HlCohort = 'ALL' | 'VOL' | 'PNL' | 'WHALE';
export type HlOiScope = 'CORE' | 'ALL';

export interface HlOiSpec {
  kind: 'oi';
  scope: HlOiScope;
}

export interface HlMarginSpec {
  kind: 'margin';
  cohort: HlCohort;
}

export interface HlWhalesSpec {
  kind: 'whales';
  minUsd: number;
  /** null means "top coins by open interest, resolved at render time". */
  coins: string[] | null;
}

export interface HlFundingSpec {
  kind: 'funding';
  coins: string[];
}

export interface HlLongShortSpec {
  kind: 'longshort';
  coins: string[];
  cohort: HlCohort;
}

export type HlPanelSpec =
  | HlOiSpec
  | HlMarginSpec
  | HlWhalesSpec
  | HlFundingSpec
  | HlLongShortSpec;

export type HlPanelKind = HlPanelSpec['kind'];

export const HL_PREFIXES = ['HLOI:', 'HLMARGIN:', 'HLWHALES:', 'HLFUNDING:', 'HLLS:'] as const;

export const DEFAULT_MAJORS = ['BTC', 'ETH', 'HYPE'];

export const MAJOR_COIN_CHOICES = [
  'BTC', 'ETH', 'HYPE', 'SOL', 'XRP', 'DOGE', 'SUI', 'AVAX',
  'LINK', 'LTC', 'BNB', 'ADA', 'AAVE', 'ARB', 'OP', 'TRX',
];

export const WHALE_MIN_USD_CHOICES = [25_000, 50_000, 100_000, 250_000, 1_000_000, 5_000_000];

export const COHORT_LABELS: Record<HlCohort, string> = {
  ALL: 'All tracked',
  PNL: 'Smart money',
  VOL: 'Most active',
  WHALE: 'Whales ($1M+)',
};

const COHORTS: HlCohort[] = ['ALL', 'VOL', 'PNL', 'WHALE'];

function isCohort(value: string): value is HlCohort {
  return (COHORTS as string[]).includes(value);
}

/** A coin symbol usable inside a pair string. */
function isValidCoin(coin: string): boolean {
  return coin.length > 0 && coin.length <= 24 && /^[A-Za-z0-9_.@]+$/.test(coin);
}

function parseCoinList(raw: string): string[] | null {
  const coins = raw.split('-').filter(c => c.length > 0);
  if (coins.length === 0) return null;
  if (!coins.every(isValidCoin)) return null;
  // Preserve order, drop duplicates.
  return coins.filter((c, i) => coins.indexOf(c) === i);
}

export function isHlPanelPair(pair: string): boolean {
  return HL_PREFIXES.some(prefix => pair.startsWith(prefix));
}

/** Parse a pair string into a panel spec, or null if it is not a valid HL panel. */
export function parseHlPanel(pair: string): HlPanelSpec | null {
  const parts = pair.split(':');
  const head = parts[0];

  if (head === 'HLOI') {
    const scope = (parts[1] || 'CORE').toUpperCase();
    if (scope !== 'CORE' && scope !== 'ALL') return null;
    return { kind: 'oi', scope };
  }

  if (head === 'HLMARGIN') {
    const cohort = (parts[1] || 'ALL').toUpperCase();
    if (!isCohort(cohort)) return null;
    return { kind: 'margin', cohort };
  }

  if (head === 'HLWHALES') {
    const minUsd = parseInt(parts[1] || '', 10);
    if (!Number.isFinite(minUsd) || minUsd <= 0) return null;
    const rawCoins = parts[2] || 'TOP';
    if (rawCoins.toUpperCase() === 'TOP') return { kind: 'whales', minUsd, coins: null };
    const coins = parseCoinList(rawCoins);
    if (!coins) return null;
    return { kind: 'whales', minUsd, coins };
  }

  if (head === 'HLFUNDING') {
    const coins = parseCoinList(parts[1] || '');
    if (!coins) return null;
    return { kind: 'funding', coins };
  }

  if (head === 'HLLS') {
    const coins = parseCoinList(parts[1] || '');
    if (!coins) return null;
    const cohort = (parts[2] || 'ALL').toUpperCase();
    if (!isCohort(cohort)) return null;
    return { kind: 'longshort', coins, cohort };
  }

  return null;
}

/** Inverse of parseHlPanel. */
export function serializeHlPanel(spec: HlPanelSpec): string {
  switch (spec.kind) {
    case 'oi':
      return `HLOI:${spec.scope}`;
    case 'margin':
      return `HLMARGIN:${spec.cohort}`;
    case 'whales':
      return `HLWHALES:${spec.minUsd}:${spec.coins ? spec.coins.join('-') : 'TOP'}`;
    case 'funding':
      return `HLFUNDING:${spec.coins.join('-')}`;
    case 'longshort':
      return `HLLS:${spec.coins.join('-')}:${spec.cohort}`;
  }
}

export interface HlPanelCatalogEntry {
  key: HlPanelKind;
  label: string;
  description: string;
  defaultPair: string;
}

/** Drives the "Hyperliquid data panels" list in the add-chart modal. */
export const HL_PANEL_CATALOG: HlPanelCatalogEntry[] = [
  {
    key: 'oi',
    label: 'Open Interest & Long/Short',
    description: 'Total perp OI, 24h volume, and long vs short notional among tracked traders.',
    defaultPair: 'HLOI:CORE',
  },
  {
    key: 'margin',
    label: 'Margin & Leverage',
    description: 'Account value, margin used and long vs short margin for the tracked cohort.',
    defaultPair: 'HLMARGIN:ALL',
  },
  {
    key: 'whales',
    label: 'Whale Activity (live)',
    description: 'Large trades streamed over websocket, position changes and biggest open positions.',
    defaultPair: 'HLWHALES:250000:TOP',
  },
  {
    key: 'funding',
    label: 'Funding Rates',
    description: 'Hyperliquid vs Binance, Bybit and OKX funding, annualized, with history.',
    defaultPair: `HLFUNDING:${DEFAULT_MAJORS.join('-')}`,
  },
  {
    key: 'longshort',
    label: 'Smart Money Long/Short',
    description: 'Per-market long vs short split for top traders, whales or smart money.',
    defaultPair: `HLLS:${DEFAULT_MAJORS.join('-')}:ALL`,
  },
];
