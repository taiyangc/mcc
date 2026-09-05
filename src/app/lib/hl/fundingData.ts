// Server-side funding assembly: Hyperliquid's predictedFundings covers HL, Binance and
// Bybit in one call (which also sidesteps Binance's geo-blocking, since Hyperliquid's
// own infrastructure does that fetch), and OKX is queried directly.

import { hlInfo, sharedCache } from "./client";
import {
  HL_VENUE_KEYS,
  buildVenueFunding,
  defaultIntervalHours,
  okxInstId,
} from "./funding";
import type { CoinFunding, FundingPoint, Venue, VenueFunding } from "./funding";
import type { HlFundingHistoryRow, HlPredictedFundings } from "./types";

const OKX_BASE = "https://www.okx.com/api/v5";

export type HistoryWindow = "24h" | "7d";

const WINDOW_MS: Record<HistoryWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

interface OkxResponse<T> {
  code: string;
  msg: string;
  data: T[];
}

interface OkxFundingRate {
  instId: string;
  fundingRate: string;
  nextFundingRate: string;
  fundingTime: string;
  nextFundingTime: string;
}

interface OkxFundingHistory {
  instId: string;
  fundingRate: string;
  realizedRate: string;
  fundingTime: string;
}

async function okxGet<T>(path: string): Promise<T[] | null> {
  try {
    const res = await fetch(`${OKX_BASE}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as OkxResponse<T>;
    if (body.code !== "0" || !Array.isArray(body.data)) return null;
    return body.data;
  } catch {
    return null;
  }
}

function num(value: string | undefined | null): number {
  if (!value) return NaN;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** All venues' current rates for every coin, from one Hyperliquid call. */
async function loadPredicted(): Promise<Map<string, Partial<Record<Venue, VenueFunding>>>> {
  const raw = await hlInfo<HlPredictedFundings>({ type: "predictedFundings" });
  const map = new Map<string, Partial<Record<Venue, VenueFunding>>>();
  if (!Array.isArray(raw)) return map;

  for (const [coin, venues] of raw) {
    const entry: Partial<Record<Venue, VenueFunding>> = {};
    for (const [venueKey, data] of venues) {
      const venue = HL_VENUE_KEYS[venueKey];
      // A null payload means the venue does not list that coin (e.g. HYPE on Binance).
      if (!venue || !data) continue;
      const rate = num(data.fundingRate);
      if (!Number.isFinite(rate)) continue;
      const intervalHours = data.fundingIntervalHours ?? defaultIntervalHours(venue);
      entry[venue] = buildVenueFunding(venue, rate, intervalHours, data.nextFundingTime ?? null);
    }
    map.set(coin, entry);
  }
  return map;
}

async function loadOkxCurrent(coin: string): Promise<VenueFunding | null> {
  const data = await okxGet<OkxFundingRate>(
    `/public/funding-rate?instId=${encodeURIComponent(okxInstId(coin))}`,
  );
  const row = data?.[0];
  if (!row) return null;
  const rate = num(row.fundingRate);
  if (!Number.isFinite(rate)) return null;
  // OKX's `fundingTime` is the upcoming settlement; `nextFundingTime` is the one after
  // it, so the gap between them is the interval and `fundingTime` is what to count down to.
  const fundingTime = num(row.fundingTime);
  const followingTime = num(row.nextFundingTime);
  const intervalHours =
    Number.isFinite(fundingTime) && Number.isFinite(followingTime) && followingTime > fundingTime
      ? Math.round((followingTime - fundingTime) / 3_600_000)
      : 8;
  return buildVenueFunding(
    "OKX",
    rate,
    intervalHours || 8,
    Number.isFinite(fundingTime) ? fundingTime : null,
  );
}

async function loadHlHistory(coin: string, window: HistoryWindow): Promise<FundingPoint[]> {
  const startTime = Date.now() - WINDOW_MS[window];
  const rows = await hlInfo<HlFundingHistoryRow[]>({ type: "fundingHistory", coin, startTime });
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => ({ t: row.time, rate: num(row.fundingRate) }))
    .filter(p => Number.isFinite(p.rate))
    .sort((a, b) => a.t - b.t);
}

async function loadOkxHistory(coin: string, window: HistoryWindow): Promise<FundingPoint[]> {
  const limit = window === "24h" ? 10 : 30;
  const data = await okxGet<OkxFundingHistory>(
    `/public/funding-rate-history?instId=${encodeURIComponent(okxInstId(coin))}&limit=${limit}`,
  );
  if (!data) return [];
  const cutoff = Date.now() - WINDOW_MS[window];
  return data
    .map(row => ({ t: num(row.fundingTime), rate: num(row.realizedRate || row.fundingRate) }))
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.rate) && p.t >= cutoff)
    .sort((a, b) => a.t - b.t);
}

export interface FundingResponse {
  ts: number;
  window: HistoryWindow;
  coins: CoinFunding[];
}

/** Current funding for `coins` across all four venues, with HL and OKX history. */
export async function getFunding(
  coins: string[],
  window: HistoryWindow,
): Promise<FundingResponse> {
  const predictedCache = sharedCache<Map<string, Partial<Record<Venue, VenueFunding>>>>(
    "predictedFundings",
    30_000,
    2,
  );
  const okxCache = sharedCache<VenueFunding | null>("okxFunding", 30_000, 64);
  const historyCache = sharedCache<FundingPoint[]>("fundingHistory", 10 * 60_000, 128);

  const predicted = await predictedCache
    .get("all", loadPredicted)
    .catch(() => predictedCache.peek("all") ?? new Map());

  const result = await Promise.all(
    coins.map(async coin => {
      const venues: CoinFunding["venues"] = { ...(predicted.get(coin) ?? {}) };

      const [okx, hlHistory, okxHistory] = await Promise.all([
        okxCache.get(coin, () => loadOkxCurrent(coin)).catch(() => null),
        historyCache.get(`hl:${coin}:${window}`, () => loadHlHistory(coin, window)).catch(() => []),
        historyCache
          .get(`okx:${coin}:${window}`, () => loadOkxHistory(coin, window))
          .catch(() => []),
      ]);

      venues.OKX = okx;
      if (venues.HL && hlHistory.length > 0) venues.HL = { ...venues.HL, history: hlHistory };
      if (venues.OKX && okxHistory.length > 0) venues.OKX = { ...venues.OKX, history: okxHistory };

      // Venues the coin is not listed on stay explicitly null so the UI can say so.
      for (const venue of ["HL", "BINANCE", "BYBIT", "OKX"] as Venue[]) {
        if (!venues[venue]) venues[venue] = null;
      }

      return { coin, venues };
    }),
  );

  return { ts: Date.now(), window, coins: result };
}
