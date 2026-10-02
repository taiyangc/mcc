import test from "node:test";
import assert from "node:assert/strict";
import { getMarketSession, getOhlcSession, formatSessionTime } from "../src/app/lib/marketSession.ts";
import { parseCnbcTrendQuote, parseTrendQuote } from "../src/app/lib/trendQuotes.ts";
import { TREND_PRESETS } from "../src/app/lib/trends.ts";

const time = value => Date.parse(value);
const quote = (symbol, values = {}) => ({ symbol, asOf: time("2026-10-01T16:00:00Z"), fetchedAt: time("2026-10-01T16:00:00Z"), ...values });

test("dated provider sessions handle opening, closing and early closes without inferring from quote age", () => {
  const session = { open: time("2026-11-27T14:30:00Z"), close: time("2026-11-27T18:00:00Z") };
  const value = quote("AAPL", { session });
  assert.equal(getMarketSession(value, session.open - 1).state, "closed");
  assert.equal(getMarketSession(value, session.open).state, "open");
  assert.equal(getMarketSession(value, session.close - 1).state, "open");
  assert.equal(getMarketSession(value, session.close).state, "closed");
  assert.equal(getMarketSession(value, session.close + 2 * 86_400_000).state, "closed");
  assert.equal(getMarketSession(value, session.open).typical, false);
});

test("Yahoo parser retains session metadata and rejects placeholder or inverted hours", () => {
  const parse = (regular, extra = {}) => parseTrendQuote("AAPL", { chart: { result: [{ meta: {
    regularMarketPrice: 100, regularMarketTime: 1790861400,
    currentTradingPeriod: { regular }, ...extra,
  } }] } }, 1790861400000);
  assert.deepEqual(parse({ start: 1790861400, end: 1790884800 }).session, { open: 1790861400000, close: 1790884800000 });
  for (const regular of [{}, { start: 0, end: 0 }, { start: 20, end: 10 }, { start: "10", end: 20 }, { start: 10, end: 1e20 }]) {
    assert.equal(parse(regular).session, undefined);
  }
  assert.equal(parse({}, { marketState: "POST" }).marketState, "closed");
  assert.equal(parse({}, { instrumentType: "CRYPTOCURRENCY" }).alwaysOpen, true);
});

test("typical sessions skip weekends and respect exchange DST, independently of the viewer timezone", () => {
  const before = getMarketSession(quote("CNBC:.SPX"), time("2026-10-30T20:01:00Z"));
  assert.equal(before.state, "closed");
  assert.equal(before.open, time("2026-11-02T14:30:00Z"));
  assert.equal(before.close, time("2026-11-02T21:00:00Z"));
  assert.equal(before.typical, true);
  const dax = getMarketSession(quote("CNBC:.GDAXI"), time("2026-10-26T10:00:00Z"));
  assert.equal(dax.open, time("2026-10-26T08:00:00Z"));
  assert.equal(dax.close, time("2026-10-26T16:30:00Z"));
});

test("overnight futures honor maintenance breaks and the Sunday reopen instead of Yahoo's all-day quote bars", () => {
  const gold = quote("GC=F", { session: { open: time("2026-10-01T04:00:00Z"), close: time("2026-10-02T03:59:00Z") } });
  const open = getMarketSession(gold, time("2026-10-01T20:00:00Z"));
  assert.equal(open.state, "open");
  assert.equal(open.open, time("2026-09-30T22:00:00Z"));
  const pause = getMarketSession(gold, time("2026-10-01T21:00:00Z"));
  assert.equal(pause.state, "closed");
  assert.equal(pause.open, time("2026-10-01T22:00:00Z"));
  const weekend = getMarketSession(gold, time("2026-10-03T16:00:00Z"));
  assert.equal(weekend.state, "closed");
  assert.equal(weekend.open, time("2026-10-04T22:00:00Z"));
});

test("FX closes for the weekend, while crypto and daily observations never acquire a false market close", () => {
  const saturday = time("2026-10-03T16:00:00Z");
  assert.equal(getMarketSession(quote("EURUSD=X"), saturday).state, "closed");
  assert.equal(getMarketSession(quote("BTC-USD"), saturday).state, "continuous");
  assert.equal(getMarketSession(quote("CUSTOM-USD", { alwaysOpen: true }), saturday).state, "continuous");
  assert.equal(getMarketSession(quote("FRED:SOFR", { observationDate: "2026-10-01" }), saturday).state, "daily");
  assert.equal(getMarketSession(quote("UNKNOWN"), saturday).state, "unknown");
});

test("Treasury feeds preserve live overseas activity and unknown status during regional hours", () => {
  for (const timestamp of ["2026-10-01T01:45:00Z", "2026-10-02T01:48:00Z"]) {
    const now = time(timestamp);
    for (const symbol of ["CNBC:US2Y", "CNBC:US10Y", "CNBC:US30Y"]) {
      const treasury = quote(symbol, { fetchedAt: now, asOf: now - 30_000, marketState: "open" });
      assert.deepEqual(getMarketSession(treasury, now), { state: "open" });
      assert.deepEqual(getMarketSession({ ...treasury, marketState: undefined }, now), { state: "unknown" });
      assert.deepEqual(getMarketSession({ ...treasury, marketState: "closed" }, now), { state: "closed" });
      assert.deepEqual(getMarketSession(treasury, now + 180_000), { state: "unknown" });
    }
  }
});

test("frozen CNBC closing snapshots mark every Treasury maturity closed without a provider closure flag", () => {
  const fetchedAt = time("2026-10-02T21:55:00Z");
  // Live feed shape observed after Friday's close: REG_MKT and realTime remain
  // set, the last quote is 17:05 ET, and mainmktstatus/session hours are absent.
  for (const preset of TREND_PRESETS.filter(p => p.sources[0].cnbcType === "BOND")) {
    const feed = preset.sources[0];
    const treasury = parseCnbcTrendQuote(feed.symbol, { QuickQuoteResult: { QuickQuote: [{
      symbol: feed.providerSymbol, code: "0", assetType: "BOND", last: "4.827",
      last_time: "2026-10-02T17:05:00.000-0400", realTime: "true", curmktstatus: "REG_MKT",
    }] } }, fetchedAt);
    assert.equal(treasury.marketState, undefined);
    assert.equal(treasury.session, undefined);
    for (const now of [fetchedAt, time("2026-10-03T16:00:00Z"), time("2026-10-04T23:59:59Z")]) {
      assert.equal(getMarketSession(treasury, now).state, "closed", `${preset.label} at ${new Date(now).toISOString()}`);
      assert.equal(getOhlcSession(treasury, now).close, time("2026-10-02T21:00:00Z"));
    }
    // The typical window alone cannot establish that a new session is active.
    const reopen = time("2026-10-05T00:00:00Z");
    assert.equal(getMarketSession(treasury, reopen).state, "unknown");
    assert.equal(getMarketSession({ ...treasury, asOf: reopen, fetchedAt: reopen, marketState: "open" }, reopen).state, "open");
  }
});

test("Treasury fallback closes at 17:00 New York across DST without carrying pre-close activity forward", () => {
  for (const timestamp of ["2026-10-01T21:00:00Z", "2026-11-06T22:00:00Z"]) {
    const close = time(timestamp);
    const treasury = quote("CNBC:US10Y", { asOf: close - 30_000, fetchedAt: close - 10_000, marketState: "open" });
    assert.equal(getMarketSession(treasury, close - 1).state, "open");
    assert.equal(getMarketSession(treasury, close).state, "closed");
    assert.equal(getMarketSession({ ...treasury, fetchedAt: close + 60_000 }, close + 60_000).state, "closed");
  }
});

test("fresh Treasury updates override the fallback outside regional hours but expire as the clock advances", () => {
  const now = time("2026-10-01T21:06:00Z");
  const treasury = quote("CNBC:US2Y", { asOf: time("2026-10-01T21:01:30Z"), fetchedAt: now, marketState: "open" });
  assert.equal(getMarketSession(treasury, now).state, "open");
  assert.equal(getMarketSession(treasury, now + 30_001).state, "closed");
  assert.equal(getMarketSession({ ...treasury, fetchedAt: now + 30_001 }, now + 30_001).state, "closed");
  assert.equal(getMarketSession({ ...treasury, asOf: now }, now + 180_000).state, "closed");
  assert.equal(getMarketSession({ ...treasury, asOf: now + 120_000 }, now).state, "closed");
  assert.equal(getMarketSession({ ...treasury, marketState: "closed" }, now).state, "closed");
});

test("Tradeweb closure fallback does not apply to Yahoo Cboe yields", () => {
  const now = time("2026-10-02T22:00:00Z");
  for (const symbol of ["YAHOO:^FVX", "YAHOO:^TNX", "YAHOO:^TYX"]) {
    assert.equal(getMarketSession(quote(symbol, { fetchedAt: now }), now).state, "unknown");
    const session = { open: time("2026-10-02T13:30:00Z"), close: time("2026-10-02T20:00:00Z") };
    assert.equal(getMarketSession(quote(symbol, { session }), now).state, "closed");
  }
});

test("lunch breaks and provider closures override normal hours without leaking into later sessions", () => {
  const lunch = getMarketSession(quote("CNBC:.N225"), time("2026-10-02T03:00:00Z"));
  assert.equal(lunch.state, "closed");
  assert.equal(lunch.paused, true);
  assert.equal(lunch.close, time("2026-10-02T06:30:00Z"));
  const holiday = quote("CNBC:.SPX", { marketState: "closed" });
  assert.equal(getMarketSession(holiday, holiday.fetchedAt).state, "closed");
  assert.equal(getMarketSession(holiday, holiday.fetchedAt + 3_600_000).state, "closed");
  assert.equal(getMarketSession(holiday, holiday.fetchedAt + 86_400_000).state, "open");
  const dateOnly = quote("CNBC:.HSI", { asOfDate: "2026-09-30" });
  assert.equal(getMarketSession(dateOnly, time("2026-10-02T02:00:00Z")).state, "closed");
});

test("session dates and times use the viewer's timezone, including across day and year boundaries", () => {
  const open = time("2026-10-01T01:30:00Z");
  assert.equal(formatSessionTime(open, "America/Los_Angeles"), "9/30 18:30");
  assert.equal(formatSessionTime(open, "Asia/Tokyo"), "10/1 10:30");
  assert.equal(formatSessionTime(time("2027-01-01T00:00:00Z"), "America/New_York"), "12/31 19:00");
  assert.equal(formatSessionTime(time("2027-01-01T21:00:00Z"), "America/New_York"), "1/1 16:00");
});

test("Treasury OHLC shows the global reference window without closing a live evening feed", () => {
  const now = time("2026-10-02T01:48:00Z");
  const treasury = quote("CNBC:US2Y", { asOf: now, fetchedAt: now, marketState: "open" });
  const hours = getOhlcSession(treasury, now);
  assert.equal(hours.open, time("2026-10-02T00:00:00Z"));
  assert.equal(hours.close, time("2026-10-02T21:00:00Z"));
  assert.equal(formatSessionTime(hours.open, "America/New_York"), "10/1 20:00");
  assert.equal(formatSessionTime(hours.close, "America/New_York"), "10/2 17:00");
  assert.equal(hours.typical, true);
  assert.equal(getMarketSession(treasury, now).state, "open");
  // Fresh activity can override the closure fallback outside the reference window.
  const after = time("2026-10-02T22:00:00Z");
  const updated = { ...treasury, asOf: after, fetchedAt: after };
  assert.equal(getOhlcSession(updated, after).close, hours.close);
  assert.equal(getMarketSession(updated, after).state, "open");
});

test("Treasury display hours respect Tokyo/New York DST and keep a Friday quote's session over the weekend", () => {
  const now = time("2026-11-06T22:15:00Z");
  const treasury = quote("CNBC:US10Y", { asOf: now });
  const hours = getOhlcSession(treasury, time("2026-11-08T16:00:00Z"));
  assert.equal(hours.open, time("2026-11-06T00:00:00Z"));
  assert.equal(hours.close, time("2026-11-06T22:00:00Z"));
  assert.equal(formatSessionTime(hours.open, "America/New_York"), "11/5 19:00");
  assert.equal(formatSessionTime(hours.close, "America/New_York"), "11/6 17:00");
});

test("closed-market display dates stay with the quote instead of switching to the next session", () => {
  const asOf = time("2026-10-30T20:35:00Z");
  const now = time("2026-11-01T16:00:00Z");
  const index = quote("CNBC:.SPX", { asOf, fetchedAt: asOf, marketState: "closed" });
  const hours = getOhlcSession(index, now);
  assert.equal(formatSessionTime(hours.open, "America/New_York"), "10/30 09:30");
  assert.equal(formatSessionTime(hours.close, "America/New_York"), "10/30 16:00");
  assert.equal(getMarketSession(index, now).state, "closed");

  const future = quote("GC=F", { asOf: time("2026-10-02T21:00:00Z") });
  const overnight = getOhlcSession(future, time("2026-10-04T17:00:00Z"));
  assert.equal(formatSessionTime(overnight.open, "America/New_York"), "10/1 18:00");
  assert.equal(formatSessionTime(overnight.close, "America/New_York"), "10/2 17:00");

  const holiday = quote("CNBC:.HSI", { asOf: time("2026-09-30T00:00:00Z"), asOfDate: "2026-09-30" });
  const dated = getOhlcSession(holiday, time("2026-10-02T02:00:00Z"));
  assert.equal(formatSessionTime(dated.open, "Asia/Hong_Kong"), "9/30 09:30");
  assert.equal(formatSessionTime(dated.close, "Asia/Hong_Kong"), "9/30 16:00");
});

test("crypto OHLC shows daily window times while the market remains continuous", () => {
  const now = time("2026-10-03T16:00:00Z");
  const session = { open: time("2026-10-03T00:00:00Z"), close: time("2026-10-03T23:59:00Z") };
  const crypto = quote("BTC-USD", { asOf: now, session, marketState: "closed" });
  const hours = getOhlcSession(crypto, now);
  assert.equal(hours.open, session.open);
  assert.equal(hours.close, session.close);
  assert.equal(hours.typical, false);
  assert.equal(getMarketSession(crypto, now).state, "continuous");
  const fallback = getOhlcSession({ ...crypto, session: undefined }, now);
  assert.equal(fallback.open, session.open);
  assert.equal(fallback.close, time("2026-10-04T00:00:00Z"));
  assert.equal(fallback.typical, true);
  assert.equal(getOhlcSession(quote("FRED:SOFR", { observationDate: "2026-10-01" }), now), null);
});
