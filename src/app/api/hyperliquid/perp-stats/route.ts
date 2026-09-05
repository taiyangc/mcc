import { NextResponse } from "next/server";
import { getPerpStats } from "../../../lib/hl/perpStats";
import { RateLimitError } from "../../../lib/hl/client";

// Market data must never be served from a build-time cache.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getPerpStats();
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: "Hyperliquid rate limit reached" }, { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Failed to fetch perp stats";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
