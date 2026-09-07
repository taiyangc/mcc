// Hyperliquid data panel specs.
//
// A panel is encoded as a single "pair" string in the URL's comma-separated `pairs`
// list, so a spec may never contain a comma. Lists inside a spec use "-" instead.
// Coin names are case-sensitive (Hyperliquid has kPEPE, kBONK, kSHIB) and may not
// contain ":", "-" or "," — that also excludes HIP-3 dex-qualified names.

export type HlCohort = 'ALL' | 'VOL' | 'PNL' | 'WHALE';

/** Exchange-wide totals: open interest, volume, margin, leverage and the long/short split. */
export interface HlCoreSpec {
  kind: 'core';
  cohort: HlCohort;
}

/** One row per market, carrying funding across venues and trader positioning together. */
export interface HlMarketsSpec {
  kind: 'markets';
  /** null means "the largest markets by open interest", resolved at render time. */
  coins: string[] | null;
  cohort: HlCohort;
}

export interface HlWhalesSpec {
  kind: 'whales';
  minUsd: number;
  /** null means "the largest markets by open interest", resolved at render time. */
  coins: string[] | null;
}

export type HlPanelSpec = HlCoreSpec | HlMarketsSpec | HlWhalesSpec;
export type HlPanelKind = HlPanelSpec['kind'];

/**
 * Prefixes recognised as Hyperliquid panels. The HLOI/HLMARGIN/HLFUNDING/HLLS forms are
 * the superseded panels, kept so existing links keep working; they parse into the merged
 * specs and are rewritten on save.
 */
export const HL_PREFIXES = [
  'HLCORE:', 'HLMARKETS:', 'HLWHALES:',
  'HLOI:', 'HLMARGIN:', 'HLFUNDING:', 'HLLS:',
] as const;

export const DEFAULT_MAJORS = ['BTC', 'ETH', 'HYPE'];

/** How many markets "top by open interest" resolves to, per panel. */
export const TOP_MARKETS_LIMIT = 8;

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

/** `TOP` selects the largest markets; anything else is an explicit list. */
function parseCoinSelection(raw: string): { ok: boolean; coins: string[] | null } {
  if (raw.toUpperCase() === 'TOP') return { ok: true, coins: null };
  const coins = parseCoinList(raw);
  return coins ? { ok: true, coins } : { ok: false, coins: null };
}

export function isHlPanelPair(pair: string): boolean {
  return HL_PREFIXES.some(prefix => pair.startsWith(prefix));
}

/** Parse a pair string into a panel spec, or null if it is not a valid HL panel. */
export function parseHlPanel(pair: string): HlPanelSpec | null {
  const parts = pair.split(':');
  const head = parts[0];

  if (head === 'HLCORE') {
    const cohort = (parts[1] || 'ALL').toUpperCase();
    if (!isCohort(cohort)) return null;
    return { kind: 'core', cohort };
  }

  if (head === 'HLMARKETS') {
    const selection = parseCoinSelection(parts[1] || 'TOP');
    if (!selection.ok) return null;
    const cohort = (parts[2] || 'ALL').toUpperCase();
    if (!isCohort(cohort)) return null;
    return { kind: 'markets', coins: selection.coins, cohort };
  }

  if (head === 'HLWHALES') {
    const minUsd = parseInt(parts[1] || '', 10);
    if (!Number.isFinite(minUsd) || minUsd <= 0) return null;
    const selection = parseCoinSelection(parts[2] || 'TOP');
    if (!selection.ok) return null;
    return { kind: 'whales', minUsd, coins: selection.coins };
  }

  // Superseded panels: open interest and margin merged into the core panel, funding and
  // long/short merged into the markets table.
  if (head === 'HLOI') {
    const scope = (parts[1] || 'CORE').toUpperCase();
    if (scope !== 'CORE' && scope !== 'ALL') return null;
    return { kind: 'core', cohort: 'ALL' };
  }

  if (head === 'HLMARGIN') {
    const cohort = (parts[1] || 'ALL').toUpperCase();
    if (!isCohort(cohort)) return null;
    return { kind: 'core', cohort };
  }

  if (head === 'HLFUNDING') {
    const selection = parseCoinSelection(parts[1] || '');
    if (!selection.ok) return null;
    return { kind: 'markets', coins: selection.coins, cohort: 'ALL' };
  }

  if (head === 'HLLS') {
    const selection = parseCoinSelection(parts[1] || '');
    if (!selection.ok) return null;
    const cohort = (parts[2] || 'ALL').toUpperCase();
    if (!isCohort(cohort)) return null;
    return { kind: 'markets', coins: selection.coins, cohort };
  }

  return null;
}

/** Inverse of parseHlPanel, always producing the current pair format. */
export function serializeHlPanel(spec: HlPanelSpec): string {
  switch (spec.kind) {
    case 'core':
      return `HLCORE:${spec.cohort}`;
    case 'markets':
      return `HLMARKETS:${spec.coins ? spec.coins.join('-') : 'TOP'}:${spec.cohort}`;
    case 'whales':
      return `HLWHALES:${spec.minUsd}:${spec.coins ? spec.coins.join('-') : 'TOP'}`;
  }
}

export interface HlPanelCatalogEntry {
  key: HlPanelKind;
  label: string;
  description: string;
  defaultPair: string;
  /** Grid span this panel wants when added: these are denser than a single chart cell. */
  defaultSize: { cols: number; rows: number };
}

/** Drives the "Hyperliquid data panels" list in the add-chart modal. */
export const HL_PANEL_CATALOG: HlPanelCatalogEntry[] = [
  {
    key: 'core',
    label: 'Exchange Overview',
    description: 'Open interest, volume, margin and leverage, with the long vs short split.',
    defaultPair: 'HLCORE:ALL',
    defaultSize: { cols: 1, rows: 2 },
  },
  {
    key: 'markets',
    label: 'Markets',
    description: 'One row per market: funding on every venue beside trader long/short.',
    defaultPair: `HLMARKETS:${DEFAULT_MAJORS.join('-')}:ALL`,
    defaultSize: { cols: 2, rows: 1 },
  },
  {
    key: 'whales',
    label: 'Whale Activity (live)',
    description: 'Large orders streamed over websocket, position changes and top positions.',
    defaultPair: 'HLWHALES:250000:TOP',
    defaultSize: { cols: 1, rows: 2 },
  },
];
