import { NextRequest, NextResponse } from "next/server";

const DERIBIT_API = "https://www.deribit.com/api/v2/public";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

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

interface Instrument {
  instrument_name: string;
  strike: number;
  option_type: "call" | "put";
  contract_size: number;
  expiration_timestamp: number;
}

interface BookSummary {
  instrument_name: string;
  open_interest: number;
  mark_iv: number; // implied volatility, in percent (e.g. 45.38 = 45.38%)
  underlying_price: number; // per-expiration forward price
}

const cache = new Map<string, CacheEntry>();

async function deribitGet<T>(method: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${DERIBIT_API}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Deribit ${method} failed: ${res.status}`);
  const json = await res.json();
  return json.result as T;
}

function formatExpiration(instrumentName: string): string {
  // Deribit instrument: BTC-28MAR25-50000-C → extract 28MAR25
  const parts = instrumentName.split("-");
  return parts.length >= 2 ? parts[1] : "UNKNOWN";
}

// Standard normal probability density function.
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Black-Scholes gamma using the per-expiration forward price.
 *
 * We compute gamma locally rather than calling Deribit's `ticker` endpoint for
 * every instrument: that approach required ~800 requests per currency, took ~18s,
 * and got rate-limited (≈40% of calls failed, silently dropping that gamma). The
 * book summary already carries everything gamma needs (mark_iv + forward), so two
 * bulk calls replace hundreds of per-instrument ones. The result is also more
 * precise than Deribit's reported gamma, which is rounded to 1e-5 granularity.
 */
function blackScholesGamma(forward: number, strike: number, sigma: number, t: number): number {
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(forward / strike) + 0.5 * sigma * sigma * t) / (sigma * sqrtT);
  return normPdf(d1) / (forward * sigma * sqrtT);
}

async function computeGex(currency: string): Promise<GexResponse> {
  const cur = currency.toUpperCase();

  const [instruments, bookSummaries, indexData] = await Promise.all([
    deribitGet<Instrument[]>("get_instruments", { currency: cur, kind: "option", expired: "false" }),
    deribitGet<BookSummary[]>("get_book_summary_by_currency", { currency: cur, kind: "option" }),
    deribitGet<{ index_price: number }>("get_index_price", { index_name: `${cur.toLowerCase()}_usd` }),
  ]);

  const spotPrice = indexData?.index_price ?? 0;

  // Index book summaries (open interest, implied vol, forward) by instrument name.
  const bookMap = new Map<string, BookSummary>();
  for (const item of bookSummaries) {
    if (item.open_interest > 0) {
      bookMap.set(item.instrument_name, item);
    }
  }

  const now = Date.now();
  const strikes: Record<string, { netGex: number; byExpiration: Record<string, number> }> = {};
  const expirationSet = new Set<string>();

  for (const inst of instruments) {
    const book = bookMap.get(inst.instrument_name);
    if (!book) continue;

    const sigma = book.mark_iv / 100;
    const forward = book.underlying_price;
    // Skip instruments missing the inputs gamma needs, or already at/past expiry.
    if (!(sigma > 0) || !(forward > 0)) continue;
    const t = (inst.expiration_timestamp - now) / MS_PER_YEAR;
    if (t <= 0) continue;

    const gamma = blackScholesGamma(forward, inst.strike, sigma, t);
    if (!Number.isFinite(gamma)) continue;

    const oi = book.open_interest;
    const sign = inst.option_type === "call" ? 1 : -1;
    const contractSize = inst.contract_size || 1;
    const expiration = formatExpiration(inst.instrument_name);

    // GEX = gamma * OI * contractSize * spot² * 0.01 * sign  ($ gamma notional per 1% move)
    const gex = gamma * oi * contractSize * spotPrice * spotPrice * 0.01 * sign;

    expirationSet.add(expiration);
    const strikeKey = String(inst.strike);
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
