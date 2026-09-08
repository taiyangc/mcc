import test from "node:test";
import assert from "node:assert/strict";

import { formatPx } from "../src/app/lib/format.ts";

/** Group separators are the runtime locale's business, not this function's. */
const digits = value => formatPx(value).replace(/[^\d.\-—]/g, "");

test("a price keeps the same information at every scale", () => {
  assert.equal(digits(79_294.94), "79294.9");
  assert.equal(digits(2502.2), "2502.2");
  assert.equal(digits(145.318), "145.318");
  assert.equal(digits(1.413311), "1.41331");
  assert.equal(digits(0.39753), "0.39753");
  assert.equal(digits(0.0084213), "0.0084213");
});

test("an entry and a mark one tick apart do not round to the same number", () => {
  // The whole point of the column: at two decimals both of these read "1.41".
  assert.notEqual(formatPx(1.413311), formatPx(1.4052999));
});

test("trailing zeros are dropped rather than padded", () => {
  assert.equal(digits(2500), "2500");
  assert.equal(digits(1.5), "1.5");
});

test("a missing price is a dash, not a zero", () => {
  for (const value of [null, undefined, NaN, Infinity, 0]) {
    assert.equal(formatPx(value), "—");
  }
});

test("a negative price keeps its sign", () => {
  assert.match(formatPx(-1.25), /^-/);
});
