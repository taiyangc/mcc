import test from "node:test";
import assert from "node:assert/strict";

import {
  parseHlPanel,
  serializeHlPanel,
  isHlPanelPair,
  HL_PANEL_CATALOG,
} from "../src/app/lib/hl/panels.ts";

test("parses each panel kind", () => {
  assert.deepEqual(parseHlPanel("HLCORE:ALL"), { kind: "core", cohort: "ALL" });
  assert.deepEqual(parseHlPanel("HLCORE:WHALE"), { kind: "core", cohort: "WHALE" });
  assert.deepEqual(parseHlPanel("HLMARKETS:BTC-ETH-HYPE:PNL"), {
    kind: "markets",
    coins: ["BTC", "ETH", "HYPE"],
    cohort: "PNL",
  });
  assert.deepEqual(parseHlPanel("HLMARKETS:TOP:ALL"), {
    kind: "markets",
    coins: null,
    cohort: "ALL",
  });
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
});

test("defaults the optional argument of each panel", () => {
  assert.deepEqual(parseHlPanel("HLCORE"), { kind: "core", cohort: "ALL" });
  assert.deepEqual(parseHlPanel("HLMARKETS"), { kind: "markets", coins: null, cohort: "ALL" });
  assert.deepEqual(parseHlPanel("HLMARKETS:BTC"), {
    kind: "markets",
    coins: ["BTC"],
    cohort: "ALL",
  });
});

test("rejects malformed panel strings", () => {
  assert.equal(parseHlPanel("BINANCE:BTCUSDT"), null);
  assert.equal(parseHlPanel("HLCORE:NOPE"), null);
  assert.equal(parseHlPanel("HLMARKETS:BTC:GENIUS"), null);
  assert.equal(parseHlPanel("HLWHALES:abc:TOP"), null);
  assert.equal(parseHlPanel("HLWHALES:-5:TOP"), null);
});

test("the superseded panels still parse, into their merged replacements", () => {
  // Open interest and margin became the core panel; funding and long/short became markets.
  assert.deepEqual(parseHlPanel("HLOI:CORE"), { kind: "core", cohort: "ALL" });
  assert.deepEqual(parseHlPanel("HLOI:ALL"), { kind: "core", cohort: "ALL" });
  assert.deepEqual(parseHlPanel("HLMARGIN:VOL"), { kind: "core", cohort: "VOL" });
  assert.deepEqual(parseHlPanel("HLFUNDING:BTC-ETH-HYPE"), {
    kind: "markets",
    coins: ["BTC", "ETH", "HYPE"],
    cohort: "ALL",
  });
  assert.deepEqual(parseHlPanel("HLLS:BTC-ETH:WHALE"), {
    kind: "markets",
    coins: ["BTC", "ETH"],
    cohort: "WHALE",
  });
});

test("a superseded pair serializes into the current format", () => {
  assert.equal(serializeHlPanel(parseHlPanel("HLLS:BTC-ETH:WHALE")), "HLMARKETS:BTC-ETH:WHALE");
  assert.equal(serializeHlPanel(parseHlPanel("HLMARGIN:PNL")), "HLCORE:PNL");
});

test("preserves case-sensitive coin names", () => {
  // Hyperliquid lists kPEPE, kBONK and kSHIB; upper-casing them breaks the market lookup.
  const spec = parseHlPanel("HLMARKETS:kPEPE-kBONK:ALL");
  assert.deepEqual(spec.coins, ["kPEPE", "kBONK"]);
  assert.equal(serializeHlPanel(spec), "HLMARKETS:kPEPE-kBONK:ALL");
});

test("drops duplicate coins but keeps order", () => {
  assert.deepEqual(parseHlPanel("HLMARKETS:BTC-ETH-BTC:ALL").coins, ["BTC", "ETH"]);
});

test("serialize round-trips every parse", () => {
  const pairs = [
    "HLCORE:ALL",
    "HLCORE:WHALE",
    "HLMARKETS:TOP:ALL",
    "HLMARKETS:BTC-ETH-HYPE:PNL",
    "HLWHALES:250000:TOP",
    "HLWHALES:100000:BTC-ETH-HYPE",
  ];
  for (const pair of pairs) {
    assert.equal(serializeHlPanel(parseHlPanel(pair)), pair, pair);
  }
});

test("catalog entries are all valid panels", () => {
  assert.equal(HL_PANEL_CATALOG.length, 3);
  for (const entry of HL_PANEL_CATALOG) {
    const spec = parseHlPanel(entry.defaultPair);
    assert.ok(spec, `${entry.defaultPair} should parse`);
    assert.equal(spec.kind, entry.key);
    assert.ok(isHlPanelPair(entry.defaultPair));
  }
});

test("only HL pairs are recognised as panels", () => {
  assert.ok(isHlPanelPair("HLCORE:ALL"));
  assert.ok(isHlPanelPair("HLMARKETS:TOP:ALL"));
  assert.ok(isHlPanelPair("HLFUNDING:BTC"));
  assert.ok(!isHlPanelPair("HYPERLIQUID:BTCUSDC.P"));
  assert.ok(!isHlPanelPair("UNSTAKE:HYPE"));
  assert.ok(!isHlPanelPair("EMBED:abc:1:2:3"));
});
