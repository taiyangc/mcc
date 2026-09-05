import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCohort,
  aggregateAllCohorts,
  diffPositions,
  indexPositions,
  largestPositions,
} from "../src/app/lib/hl/aggregate.ts";

function position(coin, szi, positionValue, extra = {}) {
  return {
    coin,
    szi,
    positionValue,
    marginUsed: positionValue / 10,
    entryPx: 100,
    liquidationPx: null,
    leverage: 10,
    unrealizedPnl: 0,
    ...extra,
  };
}

function account(user, tags, positions, accountValue = 1_000_000) {
  return {
    user,
    tags,
    accountValue,
    totalMarginUsed: positions.reduce((s, p) => s + p.marginUsed, 0),
    positions,
    updatedAt: 0,
  };
}

test("splits notional by position sign", () => {
  const stats = aggregateCohort([
    account("0xa", ["VOL"], [position("BTC", 1, 300), position("ETH", -2, 100)]),
    account("0xb", ["PNL"], [position("BTC", -1, 100)]),
  ]);
  assert.equal(stats.longUsd, 300);
  assert.equal(stats.shortUsd, 200);
  assert.equal(stats.longPct, 0.6);
  assert.equal(stats.n, 2);
  assert.equal(stats.nWithPositions, 2);
});

test("per-coin split ranks by total notional", () => {
  const stats = aggregateCohort([
    account("0xa", [], [position("BTC", 1, 100), position("ETH", 1, 500)]),
    account("0xb", [], [position("ETH", -1, 300)]),
  ]);
  assert.equal(stats.perCoin[0].coin, "ETH");
  assert.equal(stats.perCoin[0].longUsd, 500);
  assert.equal(stats.perCoin[0].shortUsd, 300);
  assert.equal(stats.perCoin[0].nLong, 1);
  assert.equal(stats.perCoin[0].nShort, 1);
  assert.equal(stats.perCoin[1].coin, "BTC");
});

test("a flat book yields zero rather than NaN", () => {
  const stats = aggregateCohort([account("0xa", [], [])]);
  assert.equal(stats.longPct, 0);
  assert.equal(stats.longUsd, 0);
  assert.equal(stats.nWithPositions, 0);
});

test("margin is split by side too", () => {
  const stats = aggregateCohort([
    account("0xa", [], [position("BTC", 1, 1000), position("ETH", -1, 500)]),
  ]);
  assert.equal(stats.longMarginUsed, 100);
  assert.equal(stats.shortMarginUsed, 50);
});

test("cohorts select by tag and ALL includes everyone", () => {
  const accounts = [
    account("0xa", ["VOL"], [position("BTC", 1, 100)]),
    account("0xb", ["PNL", "WHALE"], [position("BTC", -1, 400)]),
  ];
  const cohorts = aggregateAllCohorts(accounts);
  assert.equal(cohorts.ALL.n, 2);
  assert.equal(cohorts.VOL.n, 1);
  assert.equal(cohorts.VOL.longUsd, 100);
  assert.equal(cohorts.PNL.shortUsd, 400);
  assert.equal(cohorts.WHALE.shortUsd, 400);
});

test("classifies every kind of position change", () => {
  const before = indexPositions([
    account("0xa", [], [
      position("BTC", 1, 1_000_000),
      position("ETH", 2, 1_000_000),
      position("SOL", 1, 1_000_000),
      position("XRP", 1, 1_000_000),
    ]),
  ]);
  const after = [
    account("0xa", [], [
      position("BTC", 2, 2_000_000),  // increase
      position("ETH", 1, 500_000),    // reduce
      position("SOL", -1, 1_000_000), // flip
      position("DOGE", 1, 900_000),   // open
      // XRP is gone -> close
    ]),
  ];
  const changes = diffPositions(before, after, 123);
  const byCoin = Object.fromEntries(changes.map(c => [c.coin, c]));

  assert.equal(byCoin.BTC.kind, "increase");
  assert.equal(byCoin.BTC.deltaUsd, 1_000_000);
  assert.equal(byCoin.ETH.kind, "reduce");
  assert.equal(byCoin.ETH.deltaUsd, -500_000);
  assert.equal(byCoin.SOL.kind, "flip");
  assert.equal(byCoin.SOL.side, "short");
  assert.equal(byCoin.DOGE.kind, "open");
  assert.equal(byCoin.XRP.kind, "close");
  assert.equal(byCoin.XRP.positionValue, 0);
  assert.equal(changes.every(c => c.t === 123), true);
});

test("ignores changes below the dust threshold", () => {
  const before = indexPositions([account("0xa", [], [position("BTC", 1, 1_000_000)])]);
  const after = [account("0xa", [], [position("BTC", 1.001, 1_001_000)])];
  assert.equal(diffPositions(before, after, 0).length, 0);
});

test("an address that leaves the cohort is not reported as closing", () => {
  // A failed fetch or a dropped ranking must not look like the trader flattening.
  const before = indexPositions([account("0xgone", [], [position("BTC", 1, 5_000_000)])]);
  assert.deepEqual(diffPositions(before, [], 0), []);
});

test("largest positions are sorted by notional and capped", () => {
  const accounts = [
    account("0xa", [], [position("BTC", 1, 100), position("ETH", -1, 900)]),
    account("0xb", ["WHALE"], [position("SOL", 1, 500)]),
  ];
  const top = largestPositions(accounts, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].coin, "ETH");
  assert.equal(top[0].side, "short");
  assert.equal(top[1].coin, "SOL");
  assert.deepEqual(top[1].tags, ["WHALE"]);
});
