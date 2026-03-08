import { NextRequest, NextResponse } from "next/server";

const HL_API = "https://api.hyperliquid.xyz/info";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CombinedMeta {
  universe: any[];
}

interface MetaCacheEntry {
  data: CombinedMeta;
  timestamp: number;
}

let metaCache: MetaCacheEntry | null = null;

async function fetchCombinedMeta(): Promise<CombinedMeta> {
  const [perpRes, spotRes, allPerpRes] = await Promise.all([
    fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    }),
    fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spotMeta" }),
    }),
    fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allPerpMetas" }),
    }),
  ]);

  if (!perpRes.ok) throw new Error(`Hyperliquid perp meta error: ${perpRes.status}`);
  if (!spotRes.ok) throw new Error(`Hyperliquid spot meta error: ${spotRes.status}`);
  if (!allPerpRes.ok) throw new Error(`Hyperliquid allPerpMetas error: ${allPerpRes.status}`);

  const perpData = await perpRes.json();
  const spotData = await spotRes.json();
  const allPerpData: (any | null)[] = await allPerpRes.json();

  // Build native perp entries (entry 0 in allPerpMetas, same as "meta")
  const perpEntries = (perpData.universe || [])
    .filter((u: any) => !u.isDelisted)
    .map((u: any) => ({
      name: u.name,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      type: "perp" as const,
      coin: u.name,
    }));

  // Build HIP-3 builder-deployed perp entries from allPerpMetas (entries 1+)
  // These have names like "xyz:CL", "flx:TSLA", etc.
  const hip3Entries: any[] = [];
  for (let i = 1; i < allPerpData.length; i++) {
    const entry = allPerpData[i];
    if (!entry || !entry.universe) continue;
    for (const u of entry.universe) {
      if (u.isDelisted) continue;
      // name is already prefixed like "xyz:CL"
      const parts = u.name.split(":");
      const dex = parts[0];
      const asset = parts.length >= 2 ? parts[1] : u.name;
      hip3Entries.push({
        name: asset,
        szDecimals: u.szDecimals,
        maxLeverage: u.maxLeverage,
        type: "perp" as const,
        coin: u.name, // candle API uses the full "dex:ASSET" name
        dex,
      });
    }
  }

  // Build spot entries by resolving @N names to real token names
  const tokens = spotData.tokens || [];
  const spotEntries = (spotData.universe || []).map((u: any) => {
    const baseIdx = u.tokens[0];
    const baseName = baseIdx < tokens.length ? tokens[baseIdx].name : `Token${baseIdx}`;
    const candleCoin = u.isCanonical ? baseName : `@${u.index}`;
    return {
      name: baseName,
      szDecimals: baseIdx < tokens.length ? tokens[baseIdx].szDecimals : 0,
      type: "spot" as const,
      coin: candleCoin,
      spotIndex: u.index,
    };
  });

  return { universe: [...perpEntries, ...hip3Entries, ...spotEntries] };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";

  // Check cache
  if (metaCache && Date.now() - metaCache.timestamp < CACHE_TTL_MS) {
    const filtered = filterUniverse(metaCache.data.universe, query);
    return NextResponse.json({ universe: filtered });
  }

  try {
    const data = await fetchCombinedMeta();
    metaCache = { data, timestamp: Date.now() };

    const filtered = filterUniverse(data.universe, query);
    return NextResponse.json({ universe: filtered });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Hyperliquid meta";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function filterUniverse(universe: any[], query: string): any[] {
  if (!query) return universe;
  const q = query.toLowerCase();
  return universe.filter((u: any) => u.name.toLowerCase().includes(q));
}
