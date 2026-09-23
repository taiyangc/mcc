export interface WalletLabel {
  name: string;
  source: "hypurrscan" | "hyperliquid";
}

export type WalletLabels = Record<string, WalletLabel>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Match wallets case-insensitively, with HypurrScan taking precedence on overlap. */
export function mergeWalletLabels(aliases: unknown, leaderboard: unknown): WalletLabels {
  const labels: WalletLabels = {};
  const add = (address: unknown, name: unknown, source: WalletLabel["source"]) => {
    if (typeof address !== "string" || !/^0x[0-9a-f]{40}$/i.test(address)) return;
    if (typeof name !== "string" || !name.trim()) return;
    labels[address.toLowerCase()] = { name: name.trim(), source };
  };

  if (isRecord(leaderboard) && Array.isArray(leaderboard.leaderboardRows)) {
    for (const row of leaderboard.leaderboardRows) {
      if (isRecord(row)) add(row.ethAddress, row.displayName, "hyperliquid");
    }
  }

  if (isRecord(aliases)) {
    for (const [address, name] of Object.entries(aliases)) {
      add(address, name, "hypurrscan");
    }
  }

  return labels;
}
