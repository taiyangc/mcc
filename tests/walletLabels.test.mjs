import test from "node:test";
import assert from "node:assert/strict";
import { mergeWalletLabels } from "../src/app/lib/hl/walletLabels.ts";

const shared = `0x${"ab".repeat(20)}`;
const hypurrOnly = `0x${"cd".repeat(20)}`;
const leaderboardOnly = `0x${"ef".repeat(20)}`;

test("merges both sources by wallet, resolving case variants with HypurrScan precedence", () => {
  const labels = mergeWalletLabels(
    { [shared.toUpperCase()]: "Curated alias", [hypurrOnly]: "Hypurr wallet" },
    { leaderboardRows: [
      { ethAddress: shared, displayName: "Leaderboard alias" },
      { ethAddress: shared.toUpperCase(), displayName: "Duplicate leaderboard row" },
      { ethAddress: leaderboardOnly, displayName: "Leaderboard wallet" },
    ] },
  );
  assert.equal(Object.keys(labels).length, 3);
  assert.deepEqual(labels[shared], { name: "Curated alias", source: "hypurrscan" });
  assert.equal(labels[hypurrOnly].name, "Hypurr wallet");
  assert.deepEqual(labels[leaderboardOnly], { name: "Leaderboard wallet", source: "hyperliquid" });
});

test("empty or malformed records do not hide usable labels", () => {
  const labels = mergeWalletLabels(
    { [shared]: "   ", [hypurrOnly]: { name: "Unexpected object" }, invalid: "Bad address" },
    { leaderboardRows: [
      null,
      { ethAddress: shared, displayName: "  Trader  " },
      { ethAddress: hypurrOnly, displayName: null },
      { ethAddress: leaderboardOnly, displayName: 123 },
      { ethAddress: "not-a-wallet", displayName: "Bad address" },
    ] },
  );
  assert.deepEqual(labels, { [shared]: { name: "Trader", source: "hyperliquid" } });
});

test("either source can supply labels while the other is unavailable", () => {
  assert.deepEqual(mergeWalletLabels({ [shared]: "Hypurr wallet" }, null), {
    [shared]: { name: "Hypurr wallet", source: "hypurrscan" },
  });
  assert.deepEqual(mergeWalletLabels(null, {
    leaderboardRows: [{ ethAddress: shared, displayName: "Trader" }],
  }), { [shared]: { name: "Trader", source: "hyperliquid" } });
  assert.deepEqual(mergeWalletLabels(null, null), {});
});
