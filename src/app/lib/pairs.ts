// Pair-string helpers shared by the dashboard page and its widgets.
//
// A "pair" is the single string that identifies what a grid cell shows. Plain
// symbols ("BINANCE:BTCUSDT") go to TradingView; prefixed forms select a
// first-party widget instead.

// Explicit extension so Node's ESM resolver can load this module directly in tests;
// Turbopack and tsc resolve it the same way.
import { isHlPanelPair } from './hl/panels.ts';

// base64url encode/decode helpers (RFC 4648 §5)
export function base64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

// Embed page templates
export const EMBED_TEMPLATES = {
  'hlwhale-stream': {
    label: 'HL Whales - Position Stream',
    buildUrl: (token?: string) => {
      const base = 'https://www.coinglass.com/hyperliquid';
      return token ? `${base}?symbol=${token.toUpperCase()}` : base;
    },
    cropTop: 330,
    cropLeft: 570,
    scale: 100,
  },
  'hlwhale-holders': {
    label: 'HL Whales - Top Holders',
    buildUrl: (token?: string) => {
      const base = 'https://www.coinglass.com/hyperliquid';
      return token ? `${base}?symbol=${token.toUpperCase()}` : base;
    },
    cropTop: 330,
    cropLeft: 570,
    scale: 100,
  },
} as const;

export type EmbedTemplateKey = keyof typeof EMBED_TEMPLATES;

/**
 * Pairs whose casing carries meaning and must survive the add/edit inputs verbatim.
 * TradingView symbols are upper-cased; base64 payloads, market ids and Hyperliquid
 * coin names (kPEPE, kBONK, kSHIB) are not.
 */
export function isCaseSensitivePair(pair: string): boolean {
  return (
    pair.startsWith('EMBED:') ||
    pair.startsWith('GECKO:') ||
    pair.startsWith('POLYMARKET:') ||
    pair.startsWith('GEX:') ||
    pair.startsWith('UNSTAKE:') ||
    isHlPanelPair(pair)
  );
}

/** Normalize a pair typed into an input: upper-case only the TradingView forms. */
export function normalizePairInput(raw: string): string {
  const trimmed = raw.trim();
  return isCaseSensitivePair(trimmed) ? trimmed : trimmed.toUpperCase();
}

// Per-slot identity used for React keys and dnd-kit ids. The same symbol can legitimately
// occupy several cells (two BTC charts side by side), so the raw pair string is not unique —
// it yields duplicate React keys and makes a drag on the second copy move the first. Suffixing
// each with its occurrence number keeps every cell distinct. Pairs that carry editable
// configuration drop it first, so retuning an embed crop or a panel's coin list does not
// change the id and remount the cell.
export function getSlotBase(pair: string): string {
  if (pair.startsWith('EMBED:')) return `EMBED:${pair.split(':')[1] || ''}`;
  if (isHlPanelPair(pair)) return pair.split(':')[0];
  return pair;
}

export function getSlotIds(pairs: string[]): string[] {
  const seen = new Map<string, number>();
  return pairs.map(pair => {
    const base = getSlotBase(pair);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}#${occurrence}`;
  });
}

export function migratePair(pair: string): string {
  // Backward compat: convert HLWHALE:TYPE:TOKEN → EMBED:<b64url>:<cropTop>:<cropLeft>
  if (pair.startsWith('HLWHALE:')) {
    const parts = pair.split(':');
    const type = parts.length >= 2 ? parts[1].toLowerCase() : 'stream';
    const token = parts.length >= 3 ? parts[2] : undefined;
    const template = type === 'holders' ? EMBED_TEMPLATES['hlwhale-holders'] : EMBED_TEMPLATES['hlwhale-stream'];
    const url = template.buildUrl(token);
    return `EMBED:${base64urlEncode(url)}:${template.cropTop}:${template.cropLeft}:${template.scale}`;
  }
  // Backward compat: convert LAEVITAS:GEX:BTC:deribit → GEX:BTC:DERIBIT
  if (pair.startsWith('LAEVITAS:')) {
    const parts = pair.split(':');
    const currency = (parts.length >= 3 ? parts[2] : 'BTC').toUpperCase();
    const exchange = (parts.length >= 4 ? parts[3] : 'DERIBIT').toUpperCase();
    return `GEX:${currency}:${exchange}`;
  }
  // Backward compat: custom Hyperliquid charts are now native TradingView symbols.
  //   HL:COIN              → HYPERLIQUID:<COIN>USDC.P    (native perp)
  //   HL:DEX:ASSET         → HIP3<DEX>:<ASSET>USDC.P     (HIP-3 builder perp)
  //   HL:DISPLAY:COIN:spot → HYPERLIQUID:<DISPLAY>USDC   (spot)
  if (pair.startsWith('HL:')) {
    const parts = pair.split(':');
    if (parts.length >= 4 && parts[parts.length - 1] === 'spot') {
      return `HYPERLIQUID:${parts[1].toUpperCase()}USDC`;
    }
    if (parts.length === 3) {
      return `HIP3${parts[1].toUpperCase()}:${parts[2].toUpperCase()}USDC.P`;
    }
    if (parts.length >= 2 && parts[1]) {
      return `HYPERLIQUID:${parts[1].toUpperCase()}USDC.P`;
    }
  }
  return pair;
}
