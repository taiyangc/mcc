// Market-wide perp statistics: per-coin open interest from metaAndAssetCtxs plus the
// undocumented globalStats totals, with a request-driven 24h sampler.

import { hlInfo, sharedCache, RingBuffer, RateLimitError } from "./client";
import type { HlAssetCtx, HlGlobalStats, HlMetaAndAssetCtxs, HlUniverseAsset } from "./types";

export interface CoinStat {
  coin: string;
  markPx: number;
  oiCoins: number;
  oiUsd: number;
  /** Hyperliquid funding is hourly. */
  fundingHourly: number;
  dayNtlVlm: number;
  premium: number;
  maxLeverage: number;
  prevDayPx: number;
  changePct: number;
}

export interface OiSample {
  t: number;
  coreOiUsd: number;
  allDexOiUsd: number;
}

export interface PerpStats {
  ts: number;
  coreOiUsd: number;
  allDexOiUsd: number;
  dailyVolumeUsd: number;
  totalVolumeUsd: number;
  nUsers: number;
  coins: CoinStat[];
  series: OiSample[];
}

const SAMPLE_INTERVAL_MS = 55_000;
const SAMPLE_CAPACITY = 1440; // 24h at one sample per minute

interface SamplerState {
  ring: RingBuffer<OiSample>;
}

const SAMPLER_KEY = "__mccHlOiSampler_v1";

function sampler(): SamplerState {
  const g = globalThis as unknown as Record<string, SamplerState | undefined>;
  let state = g[SAMPLER_KEY];
  if (!state) {
    state = { ring: new RingBuffer<OiSample>(SAMPLE_CAPACITY) };
    g[SAMPLER_KEY] = state;
  }
  return state;
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildCoins(universe: HlUniverseAsset[], ctxs: HlAssetCtx[]): CoinStat[] {
  const coins: CoinStat[] = [];
  // meta.universe and assetCtxs are parallel arrays; they must be zipped by index.
  for (let i = 0; i < universe.length; i++) {
    const asset = universe[i];
    const ctx = ctxs[i];
    if (!asset || !ctx || asset.isDelisted) continue;
    const markPx = num(ctx.markPx);
    const oiCoins = num(ctx.openInterest);
    const prevDayPx = num(ctx.prevDayPx);
    coins.push({
      coin: asset.name,
      markPx,
      oiCoins,
      // openInterest is denominated in coins, not USD.
      oiUsd: oiCoins * markPx,
      fundingHourly: num(ctx.funding),
      dayNtlVlm: num(ctx.dayNtlVlm),
      premium: num(ctx.premium),
      maxLeverage: asset.maxLeverage,
      prevDayPx,
      changePct: prevDayPx > 0 ? (markPx - prevDayPx) / prevDayPx : 0,
    });
  }
  coins.sort((a, b) => b.oiUsd - a.oiUsd);
  return coins;
}

async function loadPerpStats(): Promise<PerpStats> {
  const [metaAndCtxs, global] = await Promise.all([
    hlInfo<HlMetaAndAssetCtxs>({ type: "metaAndAssetCtxs" }),
    // globalStats is undocumented but stable: it returns OI across every perp dex
    // (core plus HIP-3 builder dexes), lifetime and 24h volume, and the user count.
    hlInfo<HlGlobalStats>({ type: "globalStats" }).catch(() => null),
  ]);

  if (!metaAndCtxs || !Array.isArray(metaAndCtxs) || metaAndCtxs.length < 2) {
    throw new Error("metaAndAssetCtxs unavailable");
  }

  const coins = buildCoins(metaAndCtxs[0].universe, metaAndCtxs[1]);
  const coreOiUsd = coins.reduce((sum, c) => sum + c.oiUsd, 0);
  const allDexOiUsd = global ? num(global.oi) : coreOiUsd;

  const ts = Date.now();
  const ring = sampler().ring;
  const last = ring.last();
  if (!last || ts - last.t >= SAMPLE_INTERVAL_MS) {
    ring.push({ t: ts, coreOiUsd, allDexOiUsd });
  }

  return {
    ts,
    coreOiUsd,
    allDexOiUsd,
    dailyVolumeUsd: global ? global.dailyVolume : coins.reduce((sum, c) => sum + c.dayNtlVlm, 0),
    totalVolumeUsd: global ? global.totalVolume : 0,
    nUsers: global ? global.nUsers : 0,
    coins,
    series: ring.toArray(),
  };
}

/** Cached market stats. Falls back to the last good snapshot when rate limited. */
export async function getPerpStats(): Promise<PerpStats> {
  const cache = sharedCache<PerpStats>("perpStats", 20_000, 4);
  try {
    return await cache.get("core", loadPerpStats);
  } catch (err) {
    const stale = cache.peek("core");
    if (stale) return { ...stale, series: sampler().ring.toArray() };
    if (err instanceof RateLimitError) throw err;
    throw err;
  }
}

/** Top coins by open interest, used to pick default websocket subscriptions. */
export async function getTopCoins(limit: number): Promise<string[]> {
  const stats = await getPerpStats();
  return stats.coins.slice(0, limit).map(c => c.coin);
}
