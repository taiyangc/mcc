// Response shapes for the Hyperliquid endpoints this app uses.
// Numeric fields arrive as strings and must be parsed.

export interface HlUniverseAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId?: number;
  isDelisted?: boolean;
  onlyIsolated?: boolean;
}

export interface HlAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx?: string;
  impactPxs?: string[];
  dayBaseVlm?: string;
}

export type HlMetaAndAssetCtxs = [{ universe: HlUniverseAsset[] }, HlAssetCtx[]];

export interface HlGlobalStats {
  totalVolume: number;
  dailyVolume: number;
  nUsers: number;
  oi: string;
}

export interface HlPosition {
  coin: string;
  szi: string;
  entryPx: string | null;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
  leverage: { type: string; value: number };
}

export interface HlAssetPosition {
  type: string;
  position: HlPosition;
}

export interface HlMarginSummary {
  accountValue: string;
  totalNtlPos: string;
  totalRawUsd: string;
  totalMarginUsed: string;
}

export interface HlClearinghouseState {
  marginSummary: HlMarginSummary;
  crossMarginSummary: HlMarginSummary;
  crossMaintenanceMarginUsed: string;
  withdrawable: string;
  assetPositions: HlAssetPosition[];
  time: number;
}

export type HlWindowPerformance = [
  string,
  { pnl: string; roi: string; vlm: string },
];

export interface HlLeaderboardRow {
  ethAddress: string;
  accountValue: string;
  windowPerformances: HlWindowPerformance[];
  prize: number;
  displayName: string | null;
}

export interface HlLeaderboard {
  leaderboardRows: HlLeaderboardRow[];
}

export interface HlPredictedFundingVenue {
  fundingRate: string;
  nextFundingTime: number;
  fundingIntervalHours?: number;
}

export type HlPredictedFundings = Array<
  [string, Array<[string, HlPredictedFundingVenue | null]>]
>;

export interface HlFundingHistoryRow {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}

export interface HlTrade {
  coin: string;
  side: "A" | "B";
  px: string;
  sz: string;
  time: number;
  hash: string;
  tid: number;
  users?: [string, string];
}
