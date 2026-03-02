import { NextRequest, NextResponse } from "next/server";

const DERIBIT_API = "https://www.deribit.com/api/v2/public";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CONCURRENCY = 8;
const RATE_DELAY_MS = 50; // small delay between batches to avoid rate-limits

interface CacheEntry {
  data: GexResponse;
  timestamp: number;
}

interface GexResponse {
  currency: string;
  spotPrice: number;
  lastUpdated: string;
  expirations: string[];
  strikes: Record<string, { netGex: number; byExpiration: Record<string, number> }>;
}

const cache = new Map<string, CacheEntry>();

async function deribitGet(method: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${DERIBIT_API}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Deribit ${method} failed: ${res.status}`);
  const json = await res.json();
  return json.result;
}

function formatExpiration(instrumentName: string): string {
  // Deribit instrument: BTC-28MAR25-50000-C → extract 28MAR25
  const parts = instrumentName.split("-");
  return parts.length >= 2 ? parts[1] : "UNKNOWN";
}

async function fetchBatch<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number, delayMs: number): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

async function computeGex(currency: string): Promise<GexResponse> {
  const cur = currency.toUpperCase();

  // Fetch instruments and book summaries in parallel
  const [instruments, bookSummaries] = await Promise.all([
    deribitGet("get_instruments", { currency: cur, kind: "option", expired: "false" }),
    deribitGet("get_book_summary_by_currency", { currency: cur, kind: "option" }),
  ]);

  // Build OI map from book summaries
  const oiMap = new Map<string, number>();
  for (const item of bookSummaries) {
    if (item.open_interest > 0) {
      oiMap.set(item.instrument_name, item.open_interest);
    }
  }

  // Filter instruments to those with OI > 0
  const activeInstruments = instruments.filter((inst: any) => oiMap.has(inst.instrument_name));

  // Fetch ticker for each active instrument (contains greeks.gamma)
  const tickers = await fetchBatch(
    activeInstruments,
    async (inst: any) => {
      try {
        return await deribitGet("ticker", { instrument_name: inst.instrument_name });
      } catch {
        return null;
      }
    },
    CONCURRENCY,
    RATE_DELAY_MS
  );

  // Get spot price from the first ticker or index_price
  let spotPrice = 0;
  for (const t of tickers) {
    if (t && t.index_price) {
      spotPrice = t.index_price;
      break;
    }
  }

  // Compute GEX per option and aggregate by strike + expiration
  const strikes: Record<string, { netGex: number; byExpiration: Record<string, number> }> = {};
  const expirationSet = new Set<string>();

  for (let i = 0; i < activeInstruments.length; i++) {
    const inst = activeInstruments[i];
    const ticker = tickers[i];
    if (!ticker || !ticker.greeks || ticker.greeks.gamma == null) continue;

    const gamma = ticker.greeks.gamma;
    const oi = oiMap.get(inst.instrument_name) || 0;
    const strike = inst.strike;
    const isCall = inst.option_type === "call";
    const sign = isCall ? 1 : -1;
    const contractSize = inst.contract_size || 1;
    const expiration = formatExpiration(inst.instrument_name);

    // GEX = gamma * OI * contractSize * spot² * 0.01 * sign
    const gex = gamma * oi * contractSize * spotPrice * spotPrice * 0.01 * sign;

    expirationSet.add(expiration);
    const strikeKey = String(strike);
    if (!strikes[strikeKey]) {
      strikes[strikeKey] = { netGex: 0, byExpiration: {} };
    }
    strikes[strikeKey].netGex += gex;
    strikes[strikeKey].byExpiration[expiration] = (strikes[strikeKey].byExpiration[expiration] || 0) + gex;
  }

  // Sort expirations chronologically
  const expirations = Array.from(expirationSet).sort((a, b) => {
    const dateA = parseDeribitDate(a);
    const dateB = parseDeribitDate(b);
    return dateA.getTime() - dateB.getTime();
  });

  return {
    currency: cur,
    spotPrice,
    lastUpdated: new Date().toISOString(),
    expirations,
    strikes,
  };
}

function parseDeribitDate(dateStr: string): Date {
  // Format: 28MAR25 → parse to Date
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const match = dateStr.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return new Date(0);
  const day = parseInt(match[1], 10);
  const month = months[match[2]] ?? 0;
  const year = 2000 + parseInt(match[3], 10);
  return new Date(year, month, day);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const currency = searchParams.get("currency") || "BTC";
  const validCurrencies = ["BTC", "ETH", "SOL"];
  const cur = currency.toUpperCase();

  if (!validCurrencies.includes(cur)) {
    return NextResponse.json(
      { error: `Invalid currency. Must be one of: ${validCurrencies.join(", ")}` },
      { status: 400 }
    );
  }

  // Check cache
  const cached = cache.get(cur);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    const data = await computeGex(cur);
    cache.set(cur, { data, timestamp: Date.now() });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute GEX";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
