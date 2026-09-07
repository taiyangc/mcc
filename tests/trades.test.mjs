import test from "node:test";
import assert from "node:assert/strict";

import { TradeAggregator, orderKey } from "../src/app/lib/hl/trades.ts";

/** What the hook does with a snapshot: keep the orders at or above the threshold. */
function above(agg, minUsd) {
  return agg.snapshot().filter(o => o.notionalUsd >= minUsd);
}

const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const ZERO_HASH = `0x${"0".repeat(64)}`;

let nextTid = 1;

function fill(overrides = {}) {
  const px = overrides.px ?? 100;
  const sz = overrides.sz ?? 1;
  return {
    coin: "BTC",
    side: "buy",
    px,
    sz,
    notionalUsd: px * sz,
    time: 1_000,
    tid: nextTid++,
    hash: HASH_A,
    users: ["0xbuyer", "0xseller"],
    ...overrides,
  };
}

test("folds fills sharing a hash into one order", () => {
  const agg = new TradeAggregator(0);
  agg.add(fill({ px: 100, sz: 3 }));
  agg.add(fill({ px: 110, sz: 1 }));

  const [order] = agg.snapshot();
  assert.equal(order.fills, 2);
  assert.equal(order.sz, 4);
  assert.equal(order.notionalUsd, 410);
  // Notional-weighted, not the mean of the two prices.
  assert.equal(order.px, 102.5);
  assert.equal(agg.seen, 2);
});

test("separates orders by hash, market and side", () => {
  const agg = new TradeAggregator(0);
  agg.add(fill({ hash: HASH_A }));
  agg.add(fill({ hash: HASH_B }));
  agg.add(fill({ hash: HASH_A, coin: "ETH" }));
  agg.add(fill({ hash: HASH_A, side: "sell" }));

  assert.equal(agg.snapshot().length, 4);
});

test("keeps zero-hash fills apart instead of fusing them into a phantom whale", () => {
  const agg = new TradeAggregator(0);
  for (let i = 0; i < 5; i++) agg.add(fill({ hash: ZERO_HASH, px: 100, sz: 1 }));

  const orders = agg.snapshot();
  assert.equal(orders.length, 5);
  assert.ok(orders.every(o => o.notionalUsd === 100));
});

test("names the aggressor from the side, since users is [buyer, seller]", () => {
  const agg = new TradeAggregator(0);
  agg.add(fill({ hash: HASH_A, side: "buy", users: ["0xtaker", "0xmaker"] }));
  agg.add(fill({ hash: HASH_B, side: "sell", users: ["0xmaker", "0xtaker"] }));

  for (const order of agg.snapshot()) assert.equal(order.taker, "0xtaker");
});

test("an order surfaces once its fills add up to the threshold", () => {
  const agg = new TradeAggregator(1_000);
  agg.add(fill({ px: 100, sz: 4 }));
  assert.deepEqual(agg.snapshot(), []);

  agg.add(fill({ px: 100, sz: 7 }));
  const [order] = agg.snapshot();
  assert.equal(order.notionalUsd, 1_100);
  assert.equal(order.fills, 2);

  // Later fills grow the row that is already listed rather than adding a second one.
  agg.add(fill({ px: 100, sz: 1 }));
  const rows = agg.snapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].notionalUsd, 1_200);
});

test("filters on the order notional, not the individual fills", () => {
  const agg = new TradeAggregator(0);
  // A sweep of the book: fifty small fills that are one $500K order.
  for (let i = 0; i < 50; i++) agg.add(fill({ hash: HASH_A, px: 10_000, sz: 1 }));
  agg.add(fill({ hash: HASH_B, px: 10_000, sz: 1 }));

  const large = above(agg, 100_000);
  assert.equal(large.length, 1);
  assert.equal(large[0].notionalUsd, 500_000);
  assert.equal(agg.snapshot().length, 2);
});

test("lists newest first", () => {
  const agg = new TradeAggregator(0);
  agg.add(fill({ hash: HASH_A, time: 1 }));
  agg.add(fill({ hash: HASH_B, time: 2 }));
  agg.add(fill({ hash: `0x${"c".repeat(64)}`, time: 3 }));

  assert.deepEqual(agg.snapshot().map(o => o.time), [3, 2, 1]);
});

test("orderKey falls back to the fill id when there is no usable hash", () => {
  assert.equal(orderKey(fill({ hash: ZERO_HASH, tid: 7 })), "tid:7");
  assert.equal(orderKey(fill({ hash: "", tid: 8 })), "tid:8");
  assert.equal(orderKey(fill({ hash: HASH_A, coin: "ETH", side: "sell" })), `${HASH_A}|ETH|sell`);
});
