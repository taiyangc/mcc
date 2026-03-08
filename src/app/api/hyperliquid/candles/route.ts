import { NextRequest, NextResponse } from "next/server";

const HL_API = "https://api.hyperliquid.xyz/info";
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

const VALID_INTERVALS = [
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "8h", "12h",
  "1d", "3d", "1w", "1M",
];

// Interval to milliseconds for calculating default startTime
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 3_600_000,
  "2h": 2 * 3_600_000,
  "4h": 4 * 3_600_000,
  "8h": 8 * 3_600_000,
  "12h": 12 * 3_600_000,
  "1d": 86_400_000,
  "3d": 3 * 86_400_000,
  "1w": 7 * 86_400_000,
  "1M": 30 * 86_400_000,
};

interface CacheEntry {
  data: any[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const coin = searchParams.get("coin");
  const interval = searchParams.get("interval") || "1h";
  const startTimeParam = searchParams.get("startTime");

  if (!coin) {
    return NextResponse.json({ error: "Missing coin parameter" }, { status: 400 });
  }

  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json(
      { error: `Invalid interval. Must be one of: ${VALID_INTERVALS.join(", ")}` },
      { status: 400 }
    );
  }

  const startTime = startTimeParam
    ? parseInt(startTimeParam, 10)
    : Date.now() - 500 * (INTERVAL_MS[interval] || 3_600_000);

  const cacheKey = `${coin}:${interval}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  try {
    const res = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin, interval, startTime },
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Hyperliquid API error: ${res.status}` },
        { status: 502 }
      );
    }

    const raw = await res.json();

    // Transform [{ t, T, s, o, c, h, l, v, n }] → [{ time, open, high, low, close, volume }]
    const candles = (raw || []).map((c: any) => ({
      time: Math.floor(c.t / 1000),
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: parseFloat(c.v),
    }));

    cache.set(cacheKey, { data: candles, timestamp: Date.now() });
    return NextResponse.json(candles);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch candles";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
