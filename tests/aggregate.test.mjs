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

/** The addresses a previous pass read, which is what the diff is allowed to compare. */
function users(index) {
  return new Set([...index.keys()].map(key => key.slice(0, key.lastIndexOf("|"))));
}

function account(user, tags, positions, accountValue = 1_000_000, updatedAt = 0) {
  return {
    user,
    tags,
    accountValue,
    totalMarginUsed: positions.reduce((s, p) => s + p.marginUsed, 0),
    positions,
    updatedAt,
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
  const changes = diffPositions(before, after, 123, users(before));
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

test("an event is sized by what moved, or by the position when it opens or closes", () => {
  const before = indexPositions([
    account("0xa", [], [
      position("BTC", 1, 1_000_000),
      position("ETH", 2, 200_000_000),
      position("SOL", 1, 4_000_000),
    ]),
  ]);
  const after = [
    account("0xa", [], [
      position("BTC", 2, 2_500_000),    // increase: $1.5M of exposure moved
      position("ETH", -2, 200_000_000), // flip: no net notional, still a $200M event
      position("DOGE", 1, 9_000_000),   // open
      // SOL is gone -> close
    ]),
  ];
  const changes = diffPositions(before, after, 0, users(before));
  const byCoin = Object.fromEntries(changes.map(c => [c.coin, c]));

  assert.equal(byCoin.BTC.magnitude, 1_500_000);
  assert.equal(byCoin.DOGE.magnitude, 9_000_000);
  assert.equal(byCoin.SOL.magnitude, 4_000_000);
  assert.equal(byCoin.ETH.deltaUsd, 0);
  assert.equal(byCoin.ETH.magnitude, 200_000_000);

  // Ranking on the signed delta would bury the flip at the bottom of the feed.
  assert.equal(changes[0].coin, "ETH");
});

test("a flip survives a threshold that its signed change would fail", () => {
  const before = indexPositions([account("0xa", [], [position("BTC", 1, 50_000_000)])]);
  const after = [account("0xa", [], [position("BTC", -1, 50_000_000)])];
  const [flip] = diffPositions(before, after, 0, users(before));

  assert.equal(flip.kind, "flip");
  assert.ok(Math.abs(flip.deltaUsd) < 1_000_000);
  assert.ok(flip.magnitude >= 1_000_000);
});

test("ignores changes below the dust threshold", () => {
  const before = indexPositions([account("0xa", [], [position("BTC", 1, 1_000_000)])]);
  const after = [account("0xa", [], [position("BTC", 1.001, 1_001_000)])];
  assert.equal(diffPositions(before, after, 0, users(before)).length, 0);
});

test("an address that leaves the cohort is not reported as closing", () => {
  // A failed fetch or a dropped ranking must not look like the trader flattening.
  const before = indexPositions([account("0xgone", [], [position("BTC", 1, 5_000_000)])]);
  assert.deepEqual(diffPositions(before, [], 0, users(before)), []);
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

test("a position carries the freshness of the account it came from", () => {
  // A cycle that failed to reach an account leaves its last reading in place, so the
  // row has to say how old it is rather than borrow the snapshot's timestamp.
  const top = largestPositions([
    account("0xfresh", [], [position("BTC", 1, 900)], 1_000_000, 5_000),
    account("0xstale", [], [position("ETH", -1, 500)], 1_000_000, 1_000),
  ]);
  assert.equal(top[0].updatedAt, 5_000);
  assert.equal(top[1].updatedAt, 1_000);
});

test("an address the probe has only just reached is not a wave of new positions", () => {
  // Discovery rotates fresh addresses into the cohort every cycle. Their books were
  // there all along, and reporting them as opens drowns the feed in phantom entries.
  const before = indexPositions([account("0xold", [], [position("BTC", 1, 5_000_000)])]);
  const after = [
    account("0xold", [], [position("BTC", 2, 10_000_000)]),
    account("0xjustfound", [], [position("ETH", 1, 80_000_000)]),
  ];
  const changes = diffPositions(before, after, 0, users(before));

  assert.deepEqual(changes.map(c => c.coin), ["BTC"]);
  assert.equal(changes[0].kind, "increase");
});

test("a tracked address opening its first position is still news", () => {
  // The guard is on who was read last pass, not on who held size: an account that was
  // flat has no rows in the index, and its first position must not be swallowed.
  const before = indexPositions([account("0xflat", [], [])]);
  const after = [account("0xflat", [], [position("BTC", 1, 9_000_000)])];
  const changes = diffPositions(before, after, 0, new Set(["0xflat"]));

  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "open");
  assert.equal(changes[0].magnitude, 9_000_000);
});
