import { NextRequest, NextResponse } from "next/server";

// Proxies TradingView's public symbol-search endpoint. It's called server-side so the
// required Origin/Referer headers can be set (the browser would be blocked by CORS), and
// so the whole symbol universe — every exchange plus HIP-3 Hyperliquid markets — is
// searchable from the add-chart dialog without hand-typing an exchange prefix.
const TV_SEARCH = "https://symbol-search.tradingview.com/symbol_search/v3/";
const CACHE_TTL_MS = 60 * 1000; // 60s per query
const MAX_RESULTS = 30;

interface TvResult {
  full: string; // fully-qualified "PREFIX:SYMBOL" for the widget
  symbol: string;
  exchange: string;
  description: string;
  type: string;
}

// Subset of fields TradingView returns per symbol that we actually consume.
interface TvRawSymbol {
  symbol?: string;
  prefix?: string;
  source_id?: string;
  exchange?: string;
  description?: string;
  type?: string;
}

interface CacheEntry {
  data: TvResult[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function stripTags(s: unknown): string {
  return typeof s === "string" ? s.replace(/<[^>]+>/g, "") : "";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();

  if (!q) return NextResponse.json({ results: [] });

  // Allow "EXCHANGE:text" queries (e.g. from the prefix chips) to scope the search to that
  // data source, so "HYPERLIQUID:BTC" surfaces HYPERLIQUID:BTCUSDC.P first instead of
  // burying it under spot listings from other venues.
  let exchange = "";
  let text = q;
  const colon = q.indexOf(":");
  if (colon > 0) {
    exchange = q.slice(0, colon).trim();
    text = q.slice(colon + 1).trim();
  }

  const cacheKey = `${exchange.toLowerCase()}::${text.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ results: cached.data });
  }

  try {
    const url =
      `${TV_SEARCH}?text=${encodeURIComponent(text)}` +
      `&exchange=${encodeURIComponent(exchange)}` +
      `&hl=0&lang=en&search_type=&domain=production`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `TradingView search error: ${res.status}` }, { status: 502 });
    }

    const raw = await res.json();
    const symbols: TvRawSymbol[] = Array.isArray(raw?.symbols) ? raw.symbols : [];

    const results: TvResult[] = symbols
      .map((s) => {
        const symbol = stripTags(s.symbol);
        // The widget wants EXCHANGE:SYMBOL. TradingView's ticker qualifier is `prefix`
        // when present (e.g. HIP3XYZ, FX), otherwise `source_id`/`exchange`.
        const qualifier = stripTags(s.prefix) || stripTags(s.source_id) || stripTags(s.exchange);
        return {
          full: qualifier ? `${qualifier}:${symbol}` : symbol,
          symbol,
          exchange: stripTags(s.exchange),
          description: stripTags(s.description),
          type: typeof s.type === "string" ? s.type : "",
        };
      })
      .filter((r) => r.symbol)
      .slice(0, MAX_RESULTS);

    cache.set(cacheKey, { data: results, timestamp: Date.now() });
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to search symbols";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
