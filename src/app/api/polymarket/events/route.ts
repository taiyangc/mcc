import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');

  if (!query) {
    return NextResponse.json([]);
  }

  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(query)}&limit_per_type=20&sort=volume&ascending=false`,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Polymarket API error: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const events = data.events || [];

    // Return events with only the fields we need (already sorted by volume from API)
    const slim = events.map((event: any) => ({
      id: event.id,
      title: event.title,
      volume: event.volume,
      liquidity: event.liquidity,
      markets: event.markets?.map((m: any) => ({
        id: m.id,
        question: m.question,
        conditionId: m.conditionId,
        volume: m.volume,
        liquidity: m.liquidity,
      })) || [],
    }));

    return NextResponse.json(slim);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch from Polymarket' },
      { status: 500 }
    );
  }
}
