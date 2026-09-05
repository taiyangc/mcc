import test from "node:test";
import assert from "node:assert/strict";

import {
  getSlotIds,
  getSlotBase,
  migratePair,
  isCaseSensitivePair,
  normalizePairInput,
  base64urlEncode,
  base64urlDecode,
} from "../src/app/lib/pairs.ts";

test("duplicate symbols get distinct slot ids", () => {
  assert.deepEqual(getSlotIds(["BINANCE:BTCUSDT", "BINANCE:BTCUSDT", "BINANCE:ETHUSDT"]), [
    "BINANCE:BTCUSDT#0",
    "BINANCE:BTCUSDT#1",
    "BINANCE:ETHUSDT#0",
  ]);
});

test("a panel keeps its slot id when its configuration changes", () => {
  // Editing the coin list must not change the React key, or the cell remounts and
  // loses its websocket buffer and scroll position.
  const before = getSlotIds(["HLFUNDING:BTC-ETH"]);
  const after = getSlotIds(["HLFUNDING:BTC-ETH-HYPE-SOL"]);
  assert.deepEqual(before, after);
});

test("an embed keeps its slot id when its crop changes", () => {
  const b64 = base64urlEncode("https://example.com");
  assert.deepEqual(
    getSlotIds([`EMBED:${b64}:330:570:100`]),
    getSlotIds([`EMBED:${b64}:100:200:80`]),
  );
});

test("two panels of the same kind stay distinct", () => {
  assert.deepEqual(getSlotIds(["HLOI:CORE", "HLOI:ALL"]), ["HLOI#0", "HLOI#1"]);
});

test("slot base strips only editable configuration", () => {
  assert.equal(getSlotBase("HLLS:BTC-ETH:PNL"), "HLLS");
  assert.equal(getSlotBase("BINANCE:BTCUSDT"), "BINANCE:BTCUSDT");
  assert.equal(getSlotBase("UNSTAKE:HYPE"), "UNSTAKE:HYPE");
});

test("legacy Hyperliquid chart pairs migrate to native symbols", () => {
  assert.equal(migratePair("HL:BTC"), "HYPERLIQUID:BTCUSDC.P");
  assert.equal(migratePair("HL:xyz:CL"), "HIP3XYZ:CLUSDC.P");
  assert.equal(migratePair("HL:PURR:PURR:spot"), "HYPERLIQUID:PURRUSDC");
  assert.equal(migratePair("LAEVITAS:GEX:BTC:deribit"), "GEX:BTC:DERIBIT");
});

test("legacy whale embeds migrate to an EMBED pair", () => {
  const migrated = migratePair("HLWHALE:stream:BTC");
  assert.ok(migrated.startsWith("EMBED:"));
  assert.equal(base64urlDecode(migrated.split(":")[1]), "https://www.coinglass.com/hyperliquid?symbol=BTC");
});

test("pairs that need no migration are untouched", () => {
  for (const pair of ["BINANCE:BTCUSDT", "HLOI:CORE", "UNSTAKE:HYPE"]) {
    assert.equal(migratePair(pair), pair);
  }
});

test("TradingView symbols are upper-cased, panel pairs are not", () => {
  assert.equal(normalizePairInput(" binance:btcusdt "), "BINANCE:BTCUSDT");
  assert.equal(normalizePairInput("HLFUNDING:kPEPE"), "HLFUNDING:kPEPE");
  assert.equal(normalizePairInput("UNSTAKE:HYPE"), "UNSTAKE:HYPE");
  assert.ok(isCaseSensitivePair("GEX:BTC:DERIBIT"));
  assert.ok(!isCaseSensitivePair("BINANCE:BTCUSDT"));
});

test("base64url round-trips urls without padding", () => {
  const url = "https://www.coinglass.com/hyperliquid?symbol=BTC";
  const encoded = base64urlEncode(url);
  assert.ok(!encoded.includes("="));
  assert.ok(!encoded.includes("+"));
  assert.ok(!encoded.includes("/"));
  assert.equal(base64urlDecode(encoded), url);
});
