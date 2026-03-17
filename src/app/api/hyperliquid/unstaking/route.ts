import { NextResponse } from "next/server";

const API_URL = "https://api.hypurrscan.io/unstakingQueue";
const CACHE_TTL_MS = 30 * 1000; // 30 seconds
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

let cache: CacheEntry | null = null;

function weiToHype(wei: string | number): number {
  const n = typeof wei === "string" ? parseFloat(wei) : wei;
  // Hypurrscan returns values with 8 decimal places
  return n / 1e8;
}

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  try {
    const res = await fetch(API_URL);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Hypurrscan API error: ${res.status}` },
        { status: 502 }
      );
    }

    const raw: Array<{ time: number; user: string; wei: string | number }> = await res.json();

    const entries = (raw || []).map((entry) => {
      const amountHype = weiToHype(entry.wei);
      return {
        initiatedTime: entry.time - SEVEN_DAYS_MS,
        unlockTime: entry.time,
        user: entry.user,
        amountHype,
      };
    });

    // Sort by unlockTime ascending (soonest first)
    entries.sort((a, b) => a.unlockTime - b.unlockTime);

    const totalAmount = entries.reduce((sum, e) => sum + e.amountHype, 0);

    const data = {
      entries,
      totalAmount,
      totalEntries: entries.length,
    };

    cache = { data, timestamp: Date.now() };
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch unstaking queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
