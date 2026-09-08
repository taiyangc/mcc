import test from "node:test";
import assert from "node:assert/strict";

import {
  CHANGE_KIND_STYLE,
  SIZE_TIER_USD,
  sizeRowClass,
  sizeTier,
  sizeTierLabel,
  sizeValueClass,
  sizeWeightClass,
  sourceBadgeClass,
} from "../src/app/components/hl/panelTheme.ts";
import { EXCHANGE_SOURCE_BADGE, cohortSourceBadge } from "../src/app/lib/hl/panels.ts";

const TIERS = [0, 1, 2, 3];

test("bands start at $5M, $50M and $100M", () => {
  assert.deepEqual([...SIZE_TIER_USD], [5_000_000, 50_000_000, 100_000_000]);

  assert.equal(sizeTier(0), 0);
  assert.equal(sizeTier(4_999_999), 0);
  assert.equal(sizeTier(5_000_000), 1);
  assert.equal(sizeTier(49_999_999), 1);
  assert.equal(sizeTier(50_000_000), 2);
  assert.equal(sizeTier(99_999_999), 2);
  assert.equal(sizeTier(100_000_000), 3);
  assert.equal(sizeTier(2_500_000_000), 3);
});

test("a short is graded on the size of the move, not its sign", () => {
  assert.equal(sizeTier(-60_000_000), 2);
  assert.equal(sizeTier(-1_000), 0);
});

test("a missing number falls back to the plain band", () => {
  assert.equal(sizeTier(NaN), 0);
  assert.equal(sizeTier(Infinity), 0);
});

test("every band draws the left rule, so tinting a row never shifts the grid", () => {
  for (const tier of TIERS) {
    for (const isLong of [true, false]) {
      assert.match(sizeRowClass(isLong, tier), /\bborder-l-2\b/);
    }
  }
  // Below the first band the rule is there but invisible.
  assert.match(sizeRowClass(true, 0), /border-transparent/);
});

test("each band adds a signal of a new kind, not more of the last one", () => {
  const row = tier => sizeRowClass(true, tier);
  // $10M is carried by the value's colour and weight plus a rule; no tint yet.
  assert.doesNotMatch(row(1), /\bbg-/);
  // $50M is where the row itself starts to fill.
  assert.match(row(2), /bg-emerald-500\/\[0\.12\]/);
  // $100M swaps the flat fill for a gradient and frames the row.
  assert.match(row(3), /bg-linear-to-r/);
  assert.match(row(3), /inset-ring-1/);
  assert.doesNotMatch(row(3), /bg-emerald-500\/\[/);
});

test("no two neighbouring bands differ by font weight alone", () => {
  // Weight is the one signal that does not survive an 11px row, so it never carries a
  // step on its own.
  for (const tier of [1, 2, 3]) {
    const changedWeight = sizeWeightClass(tier) !== sizeWeightClass(tier - 1);
    const changedRow = sizeRowClass(true, tier) !== sizeRowClass(true, tier - 1);
    const changedValue = sizeValueClass(true, tier) !== sizeValueClass(true, tier - 1);
    assert.ok(
      changedRow || (changedValue && !changedWeight),
      `tier ${tier} is only distinguishable from ${tier - 1} by weight`,
    );
  }
});

test("the tint follows the row's own long/short hue", () => {
  assert.match(sizeRowClass(true, 2), /emerald/);
  assert.match(sizeRowClass(false, 2), /rose/);
  assert.doesNotMatch(sizeRowClass(true, 2), /rose/);
  assert.doesNotMatch(sizeRowClass(false, 2), /emerald/);
});

test("the notional gains colour and weight only once it is banded", () => {
  assert.equal(sizeValueClass(true, 0), "font-medium");
  assert.equal(sizeValueClass(true, 1), "text-emerald-500 font-semibold");
  assert.equal(sizeValueClass(false, 2), "text-rose-500 font-bold");
  assert.equal(sizeValueClass(false, 3), "text-rose-500 font-bold");
});

test("a banded row can say which band it is in", () => {
  assert.equal(sizeTierLabel(0), undefined);
  assert.equal(sizeTierLabel(1), "≥ $5M");
  assert.equal(sizeTierLabel(2), "≥ $50M");
  assert.equal(sizeTierLabel(3), "≥ $100M");
});

// Every kind `classify()` in aggregate.ts can produce. Kept literal rather than imported
// so adding a kind there fails here instead of silently rendering an undefined style.
const CHANGE_KINDS = ["open", "increase", "reduce", "close", "flip"];

test("every kind of position change has a style to draw it with", () => {
  assert.deepEqual(Object.keys(CHANGE_KIND_STYLE).sort(), [...CHANGE_KINDS].sort());
  for (const kind of CHANGE_KINDS) {
    const style = CHANGE_KIND_STYLE[kind];
    assert.ok(style.icon.length > 0, `${kind} has no icon`);
    assert.ok(style.label.length > 0 && style.title.length > 0, `${kind} has no words`);
    assert.match(style.className, /^text-[a-z]+-500$/, `${kind} has no colour of its own`);
  }
});

test("no two actions share an icon or a colour", () => {
  // The column exists to be read at a glance; two kinds that look alike defeat it.
  const icons = CHANGE_KINDS.map(k => CHANGE_KIND_STYLE[k].icon);
  const colours = CHANGE_KINDS.map(k => CHANGE_KIND_STYLE[k].className);
  const labels = CHANGE_KINDS.map(k => CHANGE_KIND_STYLE[k].label);
  assert.equal(new Set(icons).size, CHANGE_KINDS.length);
  assert.equal(new Set(colours).size, CHANGE_KINDS.length);
  assert.equal(new Set(labels).size, CHANGE_KINDS.length);
});

test("action labels stay short enough for a narrow panel", () => {
  // The column is ~0.75fr of seven: a longer word wraps and pushes the row taller.
  for (const kind of CHANGE_KINDS) {
    assert.ok(
      CHANGE_KIND_STYLE[kind].label.length <= 5,
      `${kind} label "${CHANGE_KIND_STYLE[kind].label}" is too long for the column`,
    );
  }
});

test("a whole-market figure and a sampled one are told apart by hue", () => {
  const all = sourceBadgeClass("all");
  const cohort = sourceBadgeClass("cohort");
  assert.notEqual(all, cohort);
  assert.match(all, /sky/);
  assert.match(cohort, /violet/);
  assert.doesNotMatch(all, /violet/);
  assert.doesNotMatch(cohort, /sky/);
});

test("a source chip names its population and nothing else", () => {
  // "All" and "Top 254" are the whole vocabulary: which API served a number is not
  // something the reader has to be told twice on every panel.
  assert.equal(EXCHANGE_SOURCE_BADGE, "All");
  assert.equal(cohortSourceBadge(254), "Top 254");
  assert.doesNotMatch(EXCHANGE_SOURCE_BADGE, /hyperliquid|api/i);
  assert.doesNotMatch(cohortSourceBadge(254), /hyperliquid|api|tracked/i);
});
