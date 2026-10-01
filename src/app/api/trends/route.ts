import { getTrendQuote } from "../../lib/trendQuotes";
import { MAX_TRENDS_PER_SIDE, normalizeTrendSymbol } from "../../lib/trends";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const values = raw.split(",");
  if (values.length > MAX_TRENDS_PER_SIDE * 2 || raw.length > 512) {
    return Response.json({ error: "Too many trend symbols." }, { status: 400 });
  }
  const symbols = values.map(normalizeTrendSymbol);
  if (symbols.some(s => s === null)) {
    return Response.json({ error: "Use a Yahoo Finance symbol or a supported preset such as US02Y." }, { status: 400 });
  }
  const quotes = await Promise.all([...new Set(symbols as string[])].map(getTrendQuote));
  return Response.json({ quotes }, { headers: { "Cache-Control": "no-store" } });
}
