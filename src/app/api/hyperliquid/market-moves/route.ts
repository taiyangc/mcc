import { getMarketMoves } from '../../../lib/hl/marketMovesData';
import { RateLimitError } from '../../../lib/hl/client';
import { parseHlPanel } from '../../../lib/hl/panels';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const coins = new URL(request.url).searchParams.get('coins') || 'TOP';
  // Reuse the URL grammar and its 12-market bound. Colon injection is not a coin list.
  const spec = coins.length <= 400 && !coins.includes(':') ? parseHlPanel(`HLMOVES:15m:ALL:EVENTS:${coins}:BOTH`) : null;
  if (!spec || spec.kind !== 'moves') return Response.json({ error: 'Choose up to 12 valid perpetual markets' }, { status: 400 });
  try {
    return Response.json(await getMarketMoves(spec.coins), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof RateLimitError ? 'Hyperliquid rate limit reached; retry shortly' : 'Market data is unavailable; retry shortly' }, { status: error instanceof RateLimitError ? 429 : 502 });
  }
}
