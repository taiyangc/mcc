import { appendMoveSample, finiteNumber, MINUTE } from './marketMoves.ts';
import type { MoveSample } from './marketMoves.ts';
import type { HlAssetCtx, HlUniverseAsset } from './types';

const KEY = '__mccHlMoveHistory_v1';
function histories(): Map<string, MoveSample[]> {
  const root = globalThis as unknown as Record<string, Map<string, MoveSample[]> | undefined>;
  return root[KEY] ??= new Map();
}

/** Record genuine source observations, never the zero fallbacks used in summary tiles. */
export function recordMoveHistory(universe: HlUniverseAsset[], contexts: HlAssetCtx[], t: number): void {
  const store = histories();
  for (let i = 0; i < universe.length; i++) {
    const asset = universe[i], ctx = contexts[i];
    if (!asset || asset.isDelisted || !ctx) continue;
    const markPx = finiteNumber(ctx.markPx), oiCoins = finiteNumber(ctx.openInterest), fundingHourly = finiteNumber(ctx.funding);
    if (markPx === null || oiCoins === null || fundingHourly === null) continue;
    store.set(asset.name, appendMoveSample(store.get(asset.name) ?? [], { t, markPx, oiCoins, fundingHourly }));
  }
  for (const [coin, points] of store) if (!points.length || t - points.at(-1)!.t > 125 * MINUTE) store.delete(coin);
}

export function getMoveHistory(coin: string): MoveSample[] {
  return histories().get(coin) ?? [];
}
