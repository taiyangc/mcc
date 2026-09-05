import test from "node:test";
import assert from "node:assert/strict";

import {
  toApr,
  to8h,
  defaultIntervalHours,
  okxInstId,
  buildVenueFunding,
  aprSpread,
  nextFundingAfter,
  HL_VENUE_KEYS,
} from "../src/app/lib/hl/funding.ts";

test("annualizes by settlement interval", () => {
  // 0.01% every 8h compounds simply to 0.01% * 1095 periods a year.
  assert.ok(Math.abs(toApr(0.0001, 8) - 0.1095) < 1e-9);
  // The same printed rate hourly is eight times the annual yield.
  assert.ok(Math.abs(toApr(0.0001, 1) - 0.876) < 1e-9);
  assert.ok(Math.abs(toApr(0.0001, 4) - 0.219) < 1e-9);
});

test("rescales rates to a common 8-hour window", () => {
  assert.equal(to8h(0.0001, 8), 0.0001);
  assert.ok(Math.abs(to8h(0.0001, 1) - 0.0008) < 1e-12);
  assert.ok(Math.abs(to8h(0.0001, 4) - 0.0002) < 1e-12);
});

test("negative funding annualizes negative", () => {
  assert.ok(toApr(-0.0001, 8) < 0);
});

test("rejects nonsense intervals instead of dividing by zero", () => {
  assert.ok(Number.isNaN(toApr(0.0001, 0)));
  assert.ok(Number.isNaN(to8h(0.0001, -1)));
  assert.ok(Number.isNaN(toApr(NaN, 8)));
});

test("Hyperliquid settles hourly, other venues every eight hours", () => {
  assert.equal(defaultIntervalHours("HL"), 1);
  assert.equal(defaultIntervalHours("BINANCE"), 8);
  assert.equal(defaultIntervalHours("OKX"), 8);
});

test("maps Hyperliquid venue keys", () => {
  assert.equal(HL_VENUE_KEYS.HlPerp, "HL");
  assert.equal(HL_VENUE_KEYS.BinPerp, "BINANCE");
  assert.equal(HL_VENUE_KEYS.BybitPerp, "BYBIT");
});

test("builds OKX instrument ids", () => {
  assert.equal(okxInstId("BTC"), "BTC-USDT-SWAP");
  assert.equal(okxInstId("hype"), "HYPE-USDT-SWAP");
});

test("venue funding carries both normalizations", () => {
  const venue = buildVenueFunding("HL", 0.0001, 1, 123);
  assert.equal(venue.venue, "HL");
  assert.equal(venue.nextFundingTime, 123);
  assert.ok(Math.abs(venue.apr - 0.876) < 1e-9);
  assert.ok(Math.abs(venue.rate8h - 0.0008) < 1e-12);
});

test("spread compares annualized rates across venues", () => {
  const coin = {
    coin: "BTC",
    venues: {
      HL: buildVenueFunding("HL", 0.0001, 1, null),      // 87.6%
      BINANCE: buildVenueFunding("BINANCE", 0.0001, 8, null), // 10.95%
      BYBIT: null,
    },
  };
  assert.ok(Math.abs(aprSpread(coin) - (0.876 - 0.1095)) < 1e-9);
});

test("no spread when only one venue lists the coin", () => {
  assert.equal(
    aprSpread({ coin: "HYPE", venues: { HL: buildVenueFunding("HL", 0.0001, 1, null), BINANCE: null } }),
    null,
  );
});

test("rolls a stale settlement time forward to the next one", () => {
  const hour = 3_600_000;
  const now = 1_000 * hour;
  // Hyperliquid can report a settlement that already passed; show the next one instead.
  assert.equal(nextFundingAfter(now - hour, 1, now), now + hour);
  assert.equal(nextFundingAfter(now - 2 * hour - 1, 1, now), now + hour - 1);
  // A future time is left alone.
  assert.equal(nextFundingAfter(now + 2 * hour, 8, now), now + 2 * hour);
  assert.equal(nextFundingAfter(null, 8, now), null);
});
