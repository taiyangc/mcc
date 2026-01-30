import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const marketId = searchParams.get('id');

  if (!marketId) {
    return NextResponse.json(
      { error: 'id parameter is required' },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://gamma-api.polymarket.com/markets/${encodeURIComponent(marketId)}`,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Polymarket API error: ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch from Polymarket' },
      { status: 500 }
    );
  }
}
