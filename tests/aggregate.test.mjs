import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCohort,
  aggregateAllCohorts,
  diffPositions,
  indexPositions,
  largestPositions,
  markPrices,
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

test("an event is sized by the position, never by how much of it moved", () => {
  const before = indexPositions([
    account("0xa", [], [
      position("BTC", 1, 1_000_000),
      position("ETH", 2, 200_000_000),
      position("SOL", 1, 4_000_000),
    ]),
  ]);
  const after = [
    account("0xa", [], [
      position("BTC", 2, 2_500_000),    // increase: the position is now $2.5M
      position("ETH", -2, 200_000_000), // flip: no net notional, still a $200M event
      position("DOGE", 1, 9_000_000),   // open
      // SOL is gone -> close
    ]),
  ];
  const changes = diffPositions(before, after, 0, users(before));
  const byCoin = Object.fromEntries(changes.map(c => [c.coin, c]));

  // Not the $1.5M that moved: the row is about a $2.5M position.
  assert.equal(byCoin.BTC.magnitude, 2_500_000);
  assert.equal(byCoin.DOGE.magnitude, 9_000_000);
  assert.equal(byCoin.SOL.magnitude, 4_000_000);
  assert.equal(byCoin.ETH.deltaUsd, 0);
  assert.equal(byCoin.ETH.magnitude, 200_000_000);

  // Ranking on the signed delta would bury the flip at the bottom of the feed.
  assert.equal(changes[0].coin, "ETH");
});

test("a reduce is sized by the position it came out of", () => {
  // Taking $1M off a $5M book leaves $4M, but the trader was working a $5M position.
  const before = indexPositions([account("0xa", [], [position("BTC", 5, 5_000_000)])]);
  const after = [account("0xa", [], [position("BTC", 4, 4_000_000)])];
  const [reduce] = diffPositions(before, after, 0, users(before));
  assert.equal(reduce.kind, "reduce");
  assert.equal(reduce.magnitude, 5_000_000);
});

test("a small add to a big position clears a filter the add alone would fail", () => {
  const before = indexPositions([account("0xa", [], [position("BTC", 50, 5_000_000)])]);
  const after = [account("0xa", [], [position("BTC", 51, 5_100_000)])];
  const [change] = diffPositions(before, after, 0, users(before));
  assert.equal(change.deltaUsd, 100_000);
  // $100K moved, but this is a $5.1M position and a $250K filter has to see it.
  assert.ok(change.magnitude >= 250_000);
  assert.equal(change.magnitude, 5_100_000);
});

test("a flip survives a threshold that its signed change would fail", () => {
  const before = indexPositions([account("0xa", [], [position("BTC", 1, 50_000_000)])]);
  const after = [account("0xa", [], [position("BTC", -1, 50_000_000)])];
  const [flip] = diffPositions(before, after, 0, users(before));

  assert.equal(flip.kind, "flip");
  assert.ok(Math.abs(flip.deltaUsd) < 1_000_000);
  assert.ok(flip.magnitude >= 1_000_000);
});

test("dust is judged by the position, so only small books are dropped", () => {
  const tiny = indexPositions([account("0xa", [], [position("BTC", 1, 10_000)])]);
  const grown = [account("0xa", [], [position("BTC", 1.5, 15_000)])];
  assert.equal(diffPositions(tiny, grown, 0, users(tiny)).length, 0);

  // The same fractional move on a book worth keeping an eye on is still reported.
  const big = indexPositions([account("0xa", [], [position("BTC", 1, 1_000_000)])]);
  const nudged = [account("0xa", [], [position("BTC", 1.001, 1_001_000)])];
  assert.equal(diffPositions(big, nudged, 0, users(big)).length, 1);
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

test("the mark price is read back out of the positions themselves", () => {
  // 2 BTC valued at $200,000 puts the mark at $100,000; no second upstream call needed.
  const marks = markPrices([
    account("0xa", ["VOL"], [position("BTC", 2, 200_000), position("ETH", -10, 30_000)]),
  ]);
  assert.equal(marks.get("BTC"), 100_000);
  assert.equal(marks.get("ETH"), 3_000);
});

test("a mark is weighted by size, so one rounded position cannot move it", () => {
  // A tiny position priced 10% off drags the answer by well under a percent.
  const marks = markPrices([
    account("0xa", ["VOL"], [position("BTC", 100, 10_000_000)]),
    account("0xb", ["VOL"], [position("BTC", 0.01, 1_100)]),
  ]);
  assert.ok(Math.abs(marks.get("BTC") - 100_000) < 100);
});

test("a flat or valueless position is left out of the mark", () => {
  const marks = markPrices([
    account("0xa", ["VOL"], [position("BTC", 0, 0), position("ETH", 5, 0)]),
  ]);
  assert.equal(marks.size, 0);
});

test("every change carries the price it happened at", () => {
  const before = indexPositions([
    account("0xa", ["VOL"], [position("BTC", 2, 200_000, { entryPx: 90_000 })]),
  ]);
  const after = [
    account("0xa", ["VOL"], [position("BTC", 3, 315_000, { entryPx: 95_000 })]),
  ];
  const [change] = diffPositions(before, after, 1000, users(before));
  assert.equal(change.kind, "increase");
  assert.equal(change.entryPx, 95_000);
  assert.equal(change.markPx, 105_000);
});

test("a closed position still reports what it was entered at", () => {
  // The position is gone from this cycle, so its entry can only come from the index, and
  // its mark from whoever else still holds the coin.
  const before = indexPositions([
    account("0xa", ["VOL"], [position("BTC", 2, 200_000, { entryPx: 90_000 })]),
    account("0xb", ["VOL"], [position("BTC", 1, 100_000, { entryPx: 80_000 })]),
  ]);
  const after = [
    account("0xa", ["VOL"], []),
    account("0xb", ["VOL"], [position("BTC", 1, 105_000, { entryPx: 80_000 })]),
  ];
  const close = diffPositions(before, after, 1000, users(before)).find(c => c.kind === "close");
  assert.equal(close.user, "0xa");
  assert.equal(close.entryPx, 90_000);
  assert.equal(close.markPx, 105_000);
});

test("a close nobody else can price reports no mark rather than a wrong one", () => {
  const before = indexPositions([
    account("0xa", ["VOL"], [position("BTC", 2, 200_000, { entryPx: 90_000 })]),
  ]);
  const after = [account("0xa", ["VOL"], [])];
  const [close] = diffPositions(before, after, 1000, users(before));
  assert.equal(close.kind, "close");
  assert.equal(close.entryPx, 90_000);
  assert.equal(close.markPx, null);
});

test("the change always agrees with the action, whatever price did in between", () => {
  // Mark runs from $100K to $110K while the trader takes a tenth off the position. The
  // notional barely falls, and comparing notionals would call a trim a purchase.
  const before = indexPositions([account("0xa", [], [position("BTC", 100, 10_000_000)])]);
  const after = [account("0xa", [], [position("BTC", 90, 9_900_000)])];
  const [reduce] = diffPositions(before, after, 0, users(before));
  assert.equal(reduce.kind, "reduce");
  assert.ok(reduce.deltaUsd < 0, `a trim reported ${reduce.deltaUsd}`);
  assert.equal(reduce.deltaUsd, -1_100_000); // 10 coins at the $110K mark

  // And the mirror image: price falls while the trader adds.
  const grew = [account("0xa", [], [position("BTC", 110, 9_900_000)])];
  const [increase] = diffPositions(before, grew, 0, users(before));
  assert.equal(increase.kind, "increase");
  assert.ok(increase.deltaUsd > 0, `an add reported ${increase.deltaUsd}`);
});

test("a short is measured by the size it put on, not by the sign of its position", () => {
  const before = indexPositions([account("0xa", [], [position("ETH", -100, 300_000)])]);
  const after = [account("0xa", [], [position("ETH", -150, 450_000)])];
  const [change] = diffPositions(before, after, 0, users(before));
  assert.equal(change.kind, "increase");
  assert.equal(change.side, "short");
  assert.equal(change.deltaUsd, 150_000);
});
