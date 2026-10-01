import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRENDS, TREND_PRESETS, getTrendFeed, getTrendPreset, normalizeTrendSymbol, parseTrendConfig, trendChange, writeTrendParams } from "../src/app/lib/trends.ts";
import { createTrendQuoteLoader, parseCnbcTrendQuote, parseFredTrendQuote, parseTrendQuote } from "../src/app/lib/trendQuotes.ts";

const payload = (meta = {}) => ({ chart: { result: [{
  meta: { symbol: "^TNX", regularMarketPrice: 4.25, chartPreviousClose: 4.2, regularMarketTime: 1790869034, currency: "USD", ...meta },
  timestamp: [1790869034],
  indicators: { quote: [{ open: [4.21], high: [4.27], low: [4.19], close: [4.25] }] },
}] } });

test("trend URLs override storage, preserve empty sides, and leave the dashboard parameters intact", () => {
  const saved = { left: ["US10Y"], right: ["ETH"], display: "compact" };
  const config = parseTrendConfig(new URLSearchParams("tl=&tr=BTC,AAPL&td=ohlc"), saved);
  assert.deepEqual(config, { left: [], right: ["BTC-USD", "AAPL"], display: "ohlc" });
  const params = writeTrendParams(new URLSearchParams("pairs=BINANCE:BTCUSDT&width=3&ar=1"), config);
  assert.equal(params.get("pairs"), "BINANCE:BTCUSDT");
  assert.equal(params.get("width"), "3");
  assert.equal(params.get("ar"), "1");
  assert.deepEqual(parseTrendConfig(params), config);
  assert.deepEqual(parseTrendConfig(new URLSearchParams(), saved), { left: ["CNBC:US10Y"], right: ["ETH-USD"], display: "compact" });
});

test("untrusted preferences are validated and bounded without hiding the defaults", () => {
  assert.deepEqual(parseTrendConfig(new URLSearchParams(), { left: [null], right: "BTC", display: "script" }), DEFAULT_TRENDS);
  assert.deepEqual(parseTrendConfig(new URLSearchParams("tl=US10Y,^TNX,DXY,SPX,VIX,BTC")).left, ["CNBC:US10Y", "DX-Y.NYB", "^GSPC", "^VIX"]);
  assert.deepEqual(parseTrendConfig(new URLSearchParams("tl=https://invalid.test")).left, DEFAULT_TRENDS.left);
  assert.equal(normalizeTrendSymbol(" tvc:us10y "), "CNBC:US10Y");
  assert.equal(normalizeTrendSymbol(" gc=f "), "GC=F");
  assert.equal(normalizeTrendSymbol("BINANCE:BTCUSDT"), null);
  assert.equal(normalizeTrendSymbol("AAPL&range=10y"), null);
});

test("Treasury quotes retain percentage yield units and express daily changes in basis points", () => {
  const quote = parseTrendQuote("YAHOO:^TNX", payload(), 123);
  assert.equal(quote.price, 4.25);
  assert.equal(quote.open, 4.21);
  assert.equal(quote.high, 4.27);
  assert.equal(quote.asOf, 1790869034000);
  assert.equal(quote.fetchedAt, 123);
  assert.equal(trendChange(quote).unit, "bp");
  assert.ok(Math.abs(trendChange(quote).value - 5) < 1e-8);
  const equity = { ...quote, symbol: "AAPL", previousClose: 100, price: 99 };
  assert.deepEqual(trendChange(equity), { unit: "%", value: -1 });
});

test("missing prices and baselines never manufacture zero or infinite changes", () => {
  assert.throws(() => parseTrendQuote("INVALID", { chart: { error: { code: "Not Found" } } }, 0));
  const quote = parseTrendQuote("AAPL", payload({ chartPreviousClose: null }), 0);
  assert.equal(quote.previousClose, null);
  assert.equal(trendChange(quote), null);
  assert.equal(trendChange({ ...quote, previousClose: 0 }), null);
  const missing = payload();
  missing.chart.result[0].indicators.quote[0].open = [null];
  assert.equal(parseTrendQuote("AAPL", missing, 0).open, null);
  missing.chart.result[0].meta.regularMarketPrice = null;
  missing.chart.result[0].indicators.quote[0].close = [null];
  assert.throws(() => parseTrendQuote("AAPL", missing, 0));
});

test("quote loads share one request and preserve stale values and timestamps on provider failure", async () => {
  let now = 1000;
  let calls = 0;
  const loader = createTrendQuoteLoader(async url => {
    assert.match(url, /interval=1d&range=1d$/);
    calls++;
    return calls === 1 ? Response.json(payload()) : new Response("Busy", { status: 429 });
  }, () => now);
  const [a, b] = await Promise.all([loader("YAHOO:^TNX"), loader("YAHOO:^TNX")]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  await loader("YAHOO:^TNX");
  assert.equal(calls, 1);
  now += 60_001;
  const stale = await loader("YAHOO:^TNX");
  assert.equal(calls, 2);
  assert.deepEqual(stale.quote, a.quote);
  assert.equal(stale.quote.fetchedAt, 1000);
  assert.match(stale.error, /busy/);
  await loader("YAHOO:^TNX");
  assert.equal(calls, 2); // Failures also back off for a minute.
});

test("one unsupported asset does not prevent other quotes from loading", async () => {
  const loader = createTrendQuoteLoader(async url => url.includes("INVALID")
    ? new Response("Not found", { status: 404 }) : Response.json(payload()), () => 1000);
  const [bad, good] = await Promise.all([loader("INVALID"), loader("YAHOO:^TNX")]);
  assert.equal(bad.quote, null);
  assert.ok(bad.error);
  assert.equal(good.error, null);
  assert.equal(good.quote.price, 4.25);
});

test("US02Y aliases and saved daily Treasury selections migrate to native intraday quotes", () => {
  for (const symbol of ["US02Y", "us2y", "TVC:US02Y", "FRED:DGS2", "CNBC:US2Y"]) {
    assert.equal(normalizeTrendSymbol(symbol), "CNBC:US2Y");
  }
  assert.equal(normalizeTrendSymbol("2YY=F"), "2YY=F");
  const config = parseTrendConfig(new URLSearchParams("tl=US02Y,US01Y,US07Y,US20Y"));
  assert.deepEqual(config.left, ["CNBC:US2Y", "CNBC:US1Y", "CNBC:US7Y", "CNBC:US20Y"]);
  assert.deepEqual(parseTrendConfig(writeTrendParams(new URLSearchParams(), config)), config);
  const saved = { left: ["FRED:DGS2", "TVC:US02Y", "FRED:DGS7"], right: ["^TNX"], display: "ohlc" };
  assert.deepEqual(parseTrendConfig(new URLSearchParams(), saved), { left: ["CNBC:US2Y", "CNBC:US7Y"], right: ["CNBC:US10Y"], display: "ohlc" });
  assert.deepEqual(parseTrendConfig(new URLSearchParams("tl=FRED:DGS2,FRED:DGS1,FRED:DGS7,FRED:DGS20")).left, config.left);
  assert.equal(normalizeTrendSymbol("FRED:UNKNOWN"), null);
});

test("every macro preset can be selected by its label without alias collisions", () => {
  const aliases = new Map();
  for (const preset of TREND_PRESETS) {
    for (const input of [preset.symbol, preset.label, ...preset.aliases]) {
      assert.equal(normalizeTrendSymbol(input), preset.symbol, input);
      if (aliases.has(input)) assert.equal(aliases.get(input), preset.symbol);
      aliases.set(input, preset.symbol);
    }
  }
  assert.equal(normalizeTrendSymbol("USD/JPY"), "JPY=X");
  assert.equal(normalizeTrendSymbol("BRENT"), "BZ=F");
  assert.equal(normalizeTrendSymbol("RUT"), "^RUT");
});

test("source selections survive storage, URL sharing and reload without reverting to the market default", () => {
  const config = { left: ["YAHOO:^TNX", "CNBC:US10Y", "CNBC:.SPX", "CNBC:EUR="], right: ["CNBC:@GC.1", "CNBC:BTC.CM="], display: "ohlc" };
  assert.deepEqual(parseTrendConfig(writeTrendParams(new URLSearchParams(), config)), config);
  assert.deepEqual(parseTrendConfig(new URLSearchParams(), config), config);
  assert.equal(getTrendPreset("YAHOO:^TNX").label, "US10Y");
  assert.equal(getTrendFeed("YAHOO:^TNX").providerSymbol, "^TNX");
  assert.equal(getTrendFeed("US10Y").source, "cnbc");
  assert.equal(getTrendFeed("CNBC:US10Y").providerSymbol, "US10Y");
  assert.equal(getTrendFeed("CNBC:EUR=").providerSymbol, "EUR=");
  assert.equal(getTrendFeed("AAPL").source, "yahoo");
  for (const input of ["CNBC:INVALID", "YAHOO:US02Y", "CNBC:.SPX&symbols=OTHER"]) assert.equal(normalizeTrendSymbol(input), null);
});

test("category defaults are consistent and alternate feeds preserve their market and units", () => {
  const feedIds = new Set();
  for (const preset of TREND_PRESETS) {
    assert.equal(preset.symbol, preset.sources[0].symbol);
    assert.equal(preset.sources[0].source, preset.category === "Rates" ? preset.label.startsWith("US") ? "cnbc" : "fred" : "yahoo");
    for (const feed of preset.sources) {
      assert.equal(normalizeTrendSymbol(feed.symbol), feed.symbol);
      assert.equal(getTrendPreset(feed.symbol), preset);
      assert.equal(getTrendFeed(feed.symbol), feed);
      assert.ok(!feedIds.has(feed.symbol), feed.symbol);
      feedIds.add(feed.symbol);
    }
  }
  assert.equal(getTrendPreset("US02Y").sources.length, 1); // No daily FRED or bond futures substitute.
  assert.equal(getTrendPreset("US10Y").sources.length, 2);
  assert.equal(getTrendPreset("BRENT").sources.length, 1); // ICE and NYMEX Brent are different contracts.
});

const DAILY_NOW = Date.UTC(2026, 9, 1, 16);
const dailyCsv = "observation_date,SOFR\r\n2026-09-25,4.81\r\n2026-09-29,4.89\r\n2026-09-28,4.92\r\n2026-09-30,.\r\n2026-10-01,\r\n2027-01-01,99\r\n";

const cnbcPayload = (overrides = {}) => ({ QuickQuoteResult: { QuickQuote: [{
  symbol: "US2Y", name: "U.S. 2 Year Treasury", code: "0", assetType: "BOND",
  last: "4.787", open: "4.891", high: "4.925", low: "4.777", previous_day_closing: "4.887",
  last_time_msec: "1790873341000", last_time: "2026-10-01T12:49:01.000-0400",
  bond_last_price: "99.9297", bond_open_price: "99.7344", bond_high_price: "99.9492",
  bond_low_price: "99.6719", bond_prev_day_closing_price: "99.7422", change_pct: "0.1953",
  ...overrides,
}] } });

test("native US02Y quotes use actual intraday yield OHLC, previous close and source timestamp", () => {
  const quote = parseCnbcTrendQuote("CNBC:US2Y", cnbcPayload(), DAILY_NOW);
  assert.equal(quote.price, 4.787);
  assert.equal(quote.open, 4.891);
  assert.equal(quote.high, 4.925);
  assert.equal(quote.low, 4.777);
  assert.equal(quote.previousClose, 4.887);
  assert.equal(quote.asOf, 1790873341000);
  assert.equal(quote.fetchedAt, DAILY_NOW);
  assert.equal(quote.source, "cnbc");
  assert.equal(quote.observationDate, undefined);
  assert.equal(trendChange(quote).unit, "bp");
  assert.ok(Math.abs(trendChange(quote).value + 10) < 1e-8);
  assert.equal(quote.currency, "");
});

test("Treasury parsers reject wrong instruments and errors, and do not manufacture missing values", () => {
  for (const overrides of [{ symbol: "US10Y" }, { code: "1" }, { assetType: "FUTURE" }, { last: "N/A" }, { last: "" }, { last: null }, { last_time: "unknown" }, { last_time: "2026-10-01T13:00:00" }, { last_time: null, last_time_msec: "" }, { last_time: null, last_time_msec: "0" }, { last_time: null, last_time_msec: "999999999999999999" }]) {
    assert.throws(() => parseCnbcTrendQuote("CNBC:US2Y", cnbcPayload(overrides), DAILY_NOW));
  }
  assert.throws(() => parseCnbcTrendQuote("CNBC:US2Y", {}, DAILY_NOW));
  assert.throws(() => parseCnbcTrendQuote("UNKNOWN", cnbcPayload(), DAILY_NOW));
  const quote = parseCnbcTrendQuote("CNBC:US2Y", cnbcPayload({ open: "", high: "--", low: null, previous_day_closing: "N/A" }), DAILY_NOW);
  assert.equal(quote.price, 4.787);
  assert.equal(quote.open, null);
  assert.equal(quote.high, null);
  assert.equal(quote.low, null);
  assert.equal(trendChange(quote), null);
  const negative = parseCnbcTrendQuote("CNBC:US2Y", cnbcPayload({ last: "-0.125", previous_day_closing: "0" }), DAILY_NOW);
  assert.deepEqual(trendChange(negative), { value: -12.5, unit: "bp" });
});

test("intraday Treasury requests use native snapshots, refresh each minute, and preserve stale OHLC on failure", async () => {
  let now = DAILY_NOW;
  let calls = 0;
  const loader = createTrendQuoteLoader(async url => {
    const request = new URL(url);
    assert.equal(request.hostname, "quote.cnbc.com");
    assert.equal(request.searchParams.get("symbols"), "US2Y");
    calls++;
    return calls === 1 ? Response.json(cnbcPayload()) : new Response("Unavailable", { status: 503 });
  }, () => now);
  const [first, second] = await Promise.all([loader("CNBC:US2Y"), loader("CNBC:US2Y")]);
  assert.equal(calls, 1);
  assert.equal(first.error, null);
  assert.equal(first.quote.open, 4.891);
  assert.deepEqual(first, second);
  now += 59_999;
  await loader("CNBC:US2Y");
  assert.equal(calls, 1);
  now += 2;
  const stale = await loader("CNBC:US2Y");
  assert.equal(calls, 2);
  assert.deepEqual(stale.quote, first.quote);
  assert.ok(stale.error);
  await loader("CNBC:US2Y");
  assert.equal(calls, 2);
});

test("every Treasury maturity has intraday data; only overnight policy rates are daily", () => {
  const rates = TREND_PRESETS.filter(p => p.category === "Rates");
  assert.equal(rates.filter(p => p.sources[0].source === "fred").length, 2);
  for (const preset of rates.filter(p => /^US\d/.test(p.label))) {
    assert.ok(preset.sources.every(feed => feed.source !== "fred"), preset.label);
    assert.equal(preset.sources[0].source, "cnbc", preset.label);
  }
});

test("CNBC alternatives preserve currency, instrument, quote time and delay metadata for every category", () => {
  const fixtures = [
    ["CNBC:.SPX", ".SPX", "INDEX", "USD"],
    ["CNBC:.DXY", ".DXY", "INDEX", "USD"],
    ["CNBC:JPY=", "JPY=", "CURRENCY", ""],
    ["CNBC:@GC.1", "@GC.1", "DERIVATIVE", "USD"],
    ["CNBC:BTC.CM=", "BTC.CM=", "INDEX", "USD"],
  ];
  for (const [symbol, providerSymbol, assetType, currency] of fixtures) {
    const quote = parseCnbcTrendQuote(symbol, cnbcPayload({ symbol: providerSymbol, assetType, currencyCode: currency, realTime: "false", exchange: "Example exchange", last: "101", previous_day_closing: "100" }), DAILY_NOW);
    assert.equal(quote.symbol, symbol);
    assert.equal(quote.currency, currency);
    assert.equal(quote.delayed, true);
    assert.equal(quote.exchange, "Example exchange");
    assert.equal(quote.asOf, 1790873341000);
    assert.deepEqual(trendChange(quote), { unit: "%", value: 1 });
    assert.throws(() => parseCnbcTrendQuote(symbol, cnbcPayload({ symbol: providerSymbol, assetType: "BOND" }), DAILY_NOW));
  }
});

test("source caches are isolated and provider failures never silently switch to another feed", async () => {
  let now = DAILY_NOW;
  const calls = [];
  const loader = createTrendQuoteLoader(async raw => {
    const url = new URL(raw);
    calls.push(url.hostname);
    if (now > DAILY_NOW) return new Response("Unavailable", { status: 503 });
    if (url.hostname === "query1.finance.yahoo.com") {
      assert.equal(decodeURIComponent(url.pathname.split("/").at(-1)), "^TNX");
      return Response.json(payload());
    }
    assert.equal(url.searchParams.get("symbols"), "US10Y");
    return Response.json(cnbcPayload({ symbol: "US10Y" }));
  }, () => now);
  const [yahoo, cnbc] = await Promise.all([loader("YAHOO:^TNX"), loader("CNBC:US10Y")]);
  assert.equal(calls.length, 2);
  assert.equal(yahoo.quote.source, "yahoo");
  assert.equal(cnbc.quote.source, "cnbc");
  assert.notEqual(yahoo.quote.price, cnbc.quote.price);
  assert.equal((await loader("US10Y")).quote, cnbc.quote);
  assert.equal(calls.length, 2);
  now += 60_001;
  const failed = await loader("YAHOO:^TNX");
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1), "query1.finance.yahoo.com");
  assert.deepEqual(failed.quote, yahoo.quote);
  assert.ok(failed.error);
  const bad = await loader("CNBC:INVALID");
  assert.equal(bad.quote, null);
  assert.equal(calls.length, 3);
});

test("CNBC international timestamps use their explicit timezone instead of the conflicting epoch field", () => {
  const quote = parseCnbcTrendQuote("CNBC:.GDAXI", cnbcPayload({ symbol: ".GDAXI", assetType: "INDEX", last_time: "2026-10-01T18:00:00.000+0200", last_time_msec: "1790892000000" }), DAILY_NOW);
  assert.equal(quote.asOf, Date.UTC(2026, 9, 1, 16));
  assert.equal(quote.asOfDate, undefined);
  const numericOnly = parseCnbcTrendQuote("CNBC:US2Y", cnbcPayload({ last_time: undefined }), DAILY_NOW);
  assert.equal(numericOnly.asOf, 1790873341000);
});

test("date-only closed-market quotes retain OHLC without masquerading as live or FRED observations", () => {
  const quote = parseCnbcTrendQuote("CNBC:.HSI", cnbcPayload({ symbol: ".HSI", assetType: "INDEX", last_time: "2026-09-30", last_time_msec: String(DAILY_NOW) }), DAILY_NOW);
  assert.equal(quote.asOf, Date.UTC(2026, 8, 30));
  assert.equal(quote.asOfDate, "2026-09-30");
  assert.equal(quote.observationDate, undefined);
  assert.equal(quote.open, 4.891);
  assert.throws(() => parseCnbcTrendQuote("CNBC:US2Y", cnbcPayload({ last_time: "2026-02-30" }), DAILY_NOW));
});

test("daily rate snapshots skip missing observations and never invent intraday OHLC", () => {
  const quote = parseFredTrendQuote("FRED:SOFR", dailyCsv, DAILY_NOW);
  assert.equal(quote.price, 4.89);
  assert.equal(quote.previousClose, 4.92);
  assert.equal(quote.observationDate, "2026-09-29");
  assert.equal(quote.asOf, Date.UTC(2026, 8, 29));
  assert.equal(quote.source, "fred");
  assert.equal(quote.open, null);
  assert.equal(quote.high, null);
  assert.equal(quote.low, null);
  assert.ok(Math.abs(trendChange(quote).value + 3) < 1e-8);
  assert.equal(trendChange(quote).unit, "bp");
  assert.deepEqual(trendChange({ ...quote, previousClose: 0, price: -0.1 }), { value: -10, unit: "bp" });
});

test("daily feeds reject a wrong series or error page and allow a single observation without a change", () => {
  assert.throws(() => parseFredTrendQuote("FRED:SOFR", dailyCsv.replace("SOFR", "DFF"), DAILY_NOW));
  assert.throws(() => parseFredTrendQuote("FRED:SOFR", "<html>Unavailable</html>", DAILY_NOW));
  assert.throws(() => parseFredTrendQuote("FRED:SOFR", "observation_date,SOFR\n2026-09-30,NaN\n2026-02-30,4.9", DAILY_NOW));
  const quote = parseFredTrendQuote("FRED:SOFR", "observation_date,SOFR\n2026-09-29,0", DAILY_NOW);
  assert.equal(quote.price, 0);
  assert.equal(quote.previousClose, null);
  assert.equal(trendChange(quote), null);
});

test("FRED reads are deduplicated, bounded to recent dates, cached longer, and retain dated stale snapshots", async () => {
  let now = DAILY_NOW;
  let calls = 0;
  const loader = createTrendQuoteLoader(async url => {
    const request = new URL(url);
    assert.equal(request.hostname, "fred.stlouisfed.org");
    assert.equal(request.searchParams.get("id"), "SOFR");
    assert.equal(request.searchParams.get("cosd"), "2026-09-10");
    calls++;
    return calls === 1 ? new Response(dailyCsv) : new Response("Unavailable", { status: 503 });
  }, () => now);
  const [first, second] = await Promise.all([loader("FRED:SOFR"), loader("FRED:SOFR")]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  now += 60_001;
  await loader("FRED:SOFR");
  assert.equal(calls, 1);
  now += 15 * 60_000;
  const stale = await loader("FRED:SOFR");
  assert.equal(calls, 2);
  assert.deepEqual(stale.quote, first.quote);
  assert.ok(stale.error);
});
