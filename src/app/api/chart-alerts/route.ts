import { getCandleSnapshot } from "../../lib/chartAlerts/candles";
import { resolveCandleFeed } from "../../lib/chartAlerts/markets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
  const interval = params.get("interval") ?? "";
  if (symbol.length > 80 || interval.length > 5) return Response.json({ error: "Invalid chart symbol or interval." }, { status: 400 });
  const feed = resolveCandleFeed(symbol, interval);
  if (typeof feed === "string") return Response.json({ error: feed }, { status: 400 });
  return Response.json(await getCandleSnapshot(feed), { headers: { "Cache-Control": "no-store" } });
}
