import { HL_LEADERBOARD_URL } from "../../../lib/hl/client";
import { mergeWalletLabels } from "../../../lib/hl/walletLabels";

export const dynamic = "force-dynamic";

async function readSource(url: string): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Wallet label source returned ${res.status}`);
  return res.json();
}

export async function GET() {
  const [aliases, leaderboard] = await Promise.allSettled([
    readSource("https://api.hypurrscan.io/globalAliases"),
    readSource(HL_LEADERBOARD_URL),
  ]);
  const headers = { "Cache-Control": "no-store" };

  if (aliases.status === "rejected" && leaderboard.status === "rejected") {
    return Response.json({ error: "Wallet labels are unavailable" }, { status: 502, headers });
  }

  // One unavailable source must not hide the other source's names.
  const labels = mergeWalletLabels(
    aliases.status === "fulfilled" ? aliases.value : null,
    leaderboard.status === "fulfilled" ? leaderboard.value : null,
  );
  return Response.json({ labels }, { headers });
}
