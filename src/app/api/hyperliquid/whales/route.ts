import { NextResponse } from "next/server";
import { getWhaleSnapshot } from "../../../lib/hl/whaleCohort";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getWhaleSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build whale snapshot";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
