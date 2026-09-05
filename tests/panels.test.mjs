import test from "node:test";
import assert from "node:assert/strict";

import {
  parseHlPanel,
  serializeHlPanel,
  isHlPanelPair,
  HL_PANEL_CATALOG,
} from "../src/app/lib/hl/panels.ts";

test("parses each panel kind", () => {
  assert.deepEqual(parseHlPanel("HLOI:CORE"), { kind: "oi", scope: "CORE" });
  assert.deepEqual(parseHlPanel("HLOI:ALL"), { kind: "oi", scope: "ALL" });
  assert.deepEqual(parseHlPanel("HLMARGIN:WHALE"), { kind: "margin", cohort: "WHALE" });
  assert.deepEqual(parseHlPanel("HLWHALES:250000:TOP"), {
    kind: "whales",
    minUsd: 250000,
    coins: null,
  });
  assert.deepEqual(parseHlPanel("HLWHALES:1000000:BTC-ETH"), {
    kind: "whales",
    minUsd: 1000000,
    coins: ["BTC", "ETH"],
  });
  assert.deepEqual(parseHlPanel("HLFUNDING:BTC-ETH-HYPE"), {
    kind: "funding",
    coins: ["BTC", "ETH", "HYPE"],
  });
  assert.deepEqual(parseHlPanel("HLLS:BTC-HYPE:PNL"), {
    kind: "longshort",
    coins: ["BTC", "HYPE"],
    cohort: "PNL",
  });
});

test("defaults the optional argument of each panel", () => {
  assert.deepEqual(parseHlPanel("HLOI"), { kind: "oi", scope: "CORE" });
  assert.deepEqual(parseHlPanel("HLMARGIN"), { kind: "margin", cohort: "ALL" });
  assert.deepEqual(parseHlPanel("HLLS:BTC"), {
    kind: "longshort",
    coins: ["BTC"],
    cohort: "ALL",
  });
});

test("rejects malformed panel strings", () => {
  assert.equal(parseHlPanel("BINANCE:BTCUSDT"), null);
  assert.equal(parseHlPanel("HLOI:SOMETHING"), null);
  assert.equal(parseHlPanel("HLMARGIN:NOPE"), null);
  assert.equal(parseHlPanel("HLFUNDING:"), null);
  assert.equal(parseHlPanel("HLWHALES:abc:TOP"), null);
  assert.equal(parseHlPanel("HLWHALES:-5:TOP"), null);
  assert.equal(parseHlPanel("HLLS:BTC:GENIUS"), null);
});

test("preserves case-sensitive coin names", () => {
  // Hyperliquid lists kPEPE, kBONK and kSHIB; upper-casing them breaks the market lookup.
  const spec = parseHlPanel("HLFUNDING:kPEPE-kBONK");
  assert.deepEqual(spec, { kind: "funding", coins: ["kPEPE", "kBONK"] });
  assert.equal(serializeHlPanel(spec), "HLFUNDING:kPEPE-kBONK");
});

test("drops duplicate coins but keeps order", () => {
  assert.deepEqual(parseHlPanel("HLFUNDING:BTC-ETH-BTC").coins, ["BTC", "ETH"]);
});

test("serialize round-trips every parse", () => {
  const pairs = [
    "HLOI:CORE",
    "HLOI:ALL",
    "HLMARGIN:ALL",
    "HLMARGIN:VOL",
    "HLWHALES:250000:TOP",
    "HLWHALES:100000:BTC-ETH-HYPE",
    "HLFUNDING:BTC-ETH-HYPE",
    "HLLS:BTC-ETH:WHALE",
  ];
  for (const pair of pairs) {
    assert.equal(serializeHlPanel(parseHlPanel(pair)), pair, pair);
  }
});

test("catalog entries are all valid panels", () => {
  for (const entry of HL_PANEL_CATALOG) {
    const spec = parseHlPanel(entry.defaultPair);
    assert.ok(spec, `${entry.defaultPair} should parse`);
    assert.equal(spec.kind, entry.key);
    assert.ok(isHlPanelPair(entry.defaultPair));
  }
});

test("only HL pairs are recognised as panels", () => {
  assert.ok(isHlPanelPair("HLOI:CORE"));
  assert.ok(!isHlPanelPair("HYPERLIQUID:BTCUSDC.P"));
  assert.ok(!isHlPanelPair("UNSTAKE:HYPE"));
  assert.ok(!isHlPanelPair("EMBED:abc:1:2:3"));
});
