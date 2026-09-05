import { NextResponse } from "next/server";
import { getFunding } from "../../../lib/hl/fundingData";
import type { HistoryWindow } from "../../../lib/hl/fundingData";
import { RateLimitError } from "../../../lib/hl/client";

export const dynamic = "force-dynamic";

const MAX_COINS = 12;
const DEFAULT_COINS = ["BTC", "ETH", "HYPE"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("coins");
  const coins = raw
    ? raw.split(",").map(c => c.trim()).filter(Boolean).slice(0, MAX_COINS)
    : DEFAULT_COINS;
  const window: HistoryWindow = searchParams.get("window") === "7d" ? "7d" : "24h";

  if (coins.length === 0) {
    return NextResponse.json({ error: "no coins requested" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getFunding(coins, window));
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: "Hyperliquid rate limit reached" }, { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Failed to fetch funding";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
