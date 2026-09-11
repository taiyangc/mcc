import test from "node:test";
import assert from "node:assert/strict";

import {
  FLAT_PNL_BAND,
  pnlFromEntry,
  pnlStance,
  readChange,
} from "../src/app/components/hl/changeAction.ts";

// Every kind `classify()` in aggregate.ts can produce. Kept literal rather than imported
// so adding a kind there fails here instead of silently rendering an undefined style.
const KINDS = ["open", "increase", "reduce", "close", "flip"];
const SIDES = ["long", "short"];

/** A pnl far enough from entry to land in each stance. */
const PNL = { ahead: 0.062, behind: -0.062, flat: 0, unknown: null };
const STANCES = Object.keys(PNL);

const every = () =>
  KINDS.flatMap(kind =>
    SIDES.flatMap(side =>
      STANCES.map(stance => ({
        kind,
        side,
        stance,
        read: readChange(kind, side, PNL[stance], "dark"),
      })),
    ),
  );

test("pnl is measured in the direction the position points", () => {
  // The same price rise is a win for the long and a loss for the short.
  assert.equal(pnlFromEntry(100, 110, true).toFixed(4), "0.1000");
  assert.equal(pnlFromEntry(100, 110, false).toFixed(4), "-0.1000");
  assert.equal(pnlFromEntry(null, 110, true), null);
  assert.equal(pnlFromEntry(100, null, true), null);
  assert.equal(pnlFromEntry(0, 110, true), null);
});

test("a position that has not left its entry claims no motive", () => {
  assert.equal(pnlStance(null), "unknown");
  assert.equal(pnlStance(NaN), "unknown");
  assert.equal(pnlStance(0), "flat");
  assert.equal(pnlStance(FLAT_PNL_BAND), "flat");
  assert.equal(pnlStance(-FLAT_PNL_BAND), "flat");
  assert.equal(pnlStance(FLAT_PNL_BAND * 1.01), "ahead");
  assert.equal(pnlStance(-FLAT_PNL_BAND * 1.01), "behind");
});

test("every change reads as an action, a side and a likely reason", () => {
  for (const { kind, side, stance, read } of every()) {
    const where = `${kind}/${side}/${stance}`;
    assert.ok(read.verb.length > 0 && read.verb.length <= 5, `${where}: verb ${read.verb}`);
    assert.equal(read.side, side, `${where}: side`);
    assert.ok(read.intent.length > 0, `${where}: no intent`);
    assert.ok(read.title.includes(read.intent), `${where}: tooltip drops the reading`);
    assert.equal([...read.mark].length, 1, `${where}: mark ${read.mark} is not one glyph`);
    assert.match(read.intentClass, /^text-[a-z]+-\d00$/, `${where}: ${read.intentClass}`);
  }
});

test("marks are characters that take a colour, not emoji that bring their own", () => {
  // An emoji is drawn by the system in its own palette and ignores the one set here, so
  // it could never carry the motive's hue. Everything this column draws is text.
  const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);
  for (const { kind, side, stance, read } of every()) {
    const drawn = `${read.mark} ${read.verb} ${read.side} ${read.intent} ${read.title}`;
    const where = `${kind}/${side}/${stance}`;
    assert.doesNotMatch(drawn, /\p{Extended_Pictographic}/u, `${where} draws an emoji`);
    assert.ok(!drawn.includes(VARIATION_SELECTOR), `${where} asks for an emoji rendering`);
  }
});

test("the mark is shaped like the action, so two near hues stay tellable apart", () => {
  const marks = KINDS.map(kind => readChange(kind, "long", 0.08, "dark").mark);
  assert.equal(new Set(marks).size, KINDS.length, "two actions share a shape");
  // Shape follows the action and only the action: the price is read by the colour.
  for (const kind of KINDS) {
    const shapes = new Set(STANCES.map(st => readChange(kind, "short", PNL[st], "dark").mark));
    assert.equal(shapes.size, 1, `${kind} changes shape with the price`);
  }
});

test("the row fits the column it is drawn in", () => {
  // "Add long · pressing a winner" is the longest reading the table has to hold.
  for (const { kind, side, stance, read } of every()) {
    const line = `${read.verb} ${read.side} ${read.mark} ${read.intent}`;
    assert.ok(line.length <= 34, `${kind}/${side}/${stance}: "${line}" is too long`);
  }
});

test("trimming a winner and trimming a loser are not the same row", () => {
  // The case that started this: a short being trimmed is banking a win or covering into
  // strength, and the two look nothing alike.
  const won = readChange("reduce", "short", 0.08, "dark");
  const lost = readChange("reduce", "short", -0.08, "dark");
  assert.equal(won.intent, "taking profit");
  assert.equal(lost.intent, "cutting risk");
  assert.notEqual(won.intentClass, lost.intentClass);
});

test("within an action, profit and loss never share a colour", () => {
  for (const kind of ["increase", "reduce", "close"]) {
    for (const side of SIDES) {
      const ahead = readChange(kind, side, 0.08, "dark");
      const behind = readChange(kind, side, -0.08, "dark");
      const flat = readChange(kind, side, 0, "dark");
      const tones = new Set([ahead.intentClass, behind.intentClass, flat.intentClass]);
      assert.equal(tones.size, 3, `${kind}/${side} reuses a colour across stances`);
      const intents = new Set([ahead.intent, behind.intent, flat.intent]);
      assert.equal(intents.size, 3, `${kind}/${side} reuses a reading across stances`);
    }
  }
});

test("a fresh position has no stance to read, so it never pretends to one", () => {
  // An open and a flip are at their entry by construction: the price cannot have said
  // anything about the motive yet.
  for (const kind of ["open", "flip"]) {
    for (const side of SIDES) {
      const reads = STANCES.map(s => readChange(kind, side, PNL[s], "dark"));
      assert.equal(new Set(reads.map(r => r.intentClass)).size, 1, `${kind}/${side} colour`);
      assert.equal(new Set(reads.map(r => r.intent)).size, 1, `${kind}/${side} reading`);
    }
  }
});

test("every reading with a motive is a colour of its own, side counted in", () => {
  // Colour is the whole combination — action, stance and direction — not the action
  // alone. Two rows that claim different motives must never look identical. The grey
  // rows are the exception below: they claim nothing, so they share the one neutral.
  const signatures = new Map();
  for (const { kind, side, stance, read } of every()) {
    if (read.intentClass.includes("slate")) continue;
    const meaning = `${read.verb} ${read.side} ${read.intent}`;
    const signature = `${read.intentClass}|${read.mark}|${side}`;
    const seen = signatures.get(signature);
    if (seen === undefined) signatures.set(signature, meaning);
    else assert.equal(seen, meaning, `${kind}/${side}/${stance} looks like another reading`);
  }
  // Five actions on two sides, minus the stance-blind opens and flips that read alike:
  // sixteen readings, sixteen looks.
  assert.equal(signatures.size, 16);
});

test("grey is reserved for the rows with nothing to infer from", () => {
  for (const { kind, side, stance, read } of every()) {
    const grey = read.intentClass.includes("slate");
    const blind = read.stance === "flat" || read.stance === "unknown";
    // Opens and flips read the same at every stance, so they are excluded by their hue,
    // not by their stance.
    if (kind === "open" || kind === "flip") {
      assert.ok(!grey, `${kind}/${side}/${stance} should keep its own hue`);
      continue;
    }
    assert.equal(grey, blind, `${kind}/${side}/${stance} colours a motive it cannot know`);
    if (grey) assert.doesNotMatch(read.intent, /profit|loss|win/, `${kind}/${side}/${stance}`);
  }
});

test("the tooltip says how far the position is from entry, and which way", () => {
  const ahead = readChange("reduce", "long", 0.0621, "dark");
  assert.match(ahead.title, /Reduced a long without closing it, 6\.21% ahead of its entry\./);
  assert.match(ahead.title, /Likely: taking profit\./);

  const behind = readChange("close", "short", -0.1234, "dark");
  assert.match(behind.title, /Closed the whole short, 12\.34% under its entry\./);

  const flat = readChange("increase", "long", 0.001, "dark");
  assert.match(flat.title, /sitting on its entry/);

  const unknown = readChange("close", "long", null, "dark");
  assert.match(unknown.title, /no entry or mark to price it against/);

  const flip = readChange("flip", "long", 0, "dark");
  assert.match(flip.title, /Reversed a short into a long/);
});

test("which way the trade hits the tape is not which way the position points", () => {
  // Covering a short is a buy, however red the side column is drawn.
  assert.equal(readChange("reduce", "short", -0.08, "dark").lean, "buy");
  assert.equal(readChange("close", "short", 0.08, "dark").lean, "buy");
  assert.equal(readChange("increase", "long", 0.08, "dark").lean, "buy");
  assert.equal(readChange("open", "long", 0, "dark").lean, "buy");
  assert.equal(readChange("flip", "long", 0, "dark").lean, "buy");

  assert.equal(readChange("reduce", "long", 0.08, "dark").lean, "sell");
  assert.equal(readChange("close", "long", -0.08, "dark").lean, "sell");
  assert.equal(readChange("increase", "short", 0.08, "dark").lean, "sell");
  assert.equal(readChange("open", "short", 0, "dark").lean, "sell");
  assert.equal(readChange("flip", "short", 0, "dark").lean, "sell");

  for (const { kind, side, stance, read } of every()) {
    assert.match(read.title, /On the tape it is a (buy|sell)\./, `${kind}/${side}/${stance}`);
  }
});

test("adding into a fall and adding into a rally are named for what they are", () => {
  assert.equal(readChange("increase", "long", -0.08, "dark").intent, "averaging down");
  assert.equal(readChange("increase", "short", -0.08, "dark").intent, "averaging up");
  assert.equal(readChange("flip", "long", 0, "dark").intent, "turned bullish");
  assert.equal(readChange("flip", "short", 0, "dark").intent, "turned bearish");
});

test("each theme gets a shade that can be read against its own background", () => {
  // One shade cannot serve both: the -400s wash out on white and the -600s go muddy on
  // zinc-900, and this column is now carrying nine hues.
  for (const { kind, side, stance } of every()) {
    const light = readChange(kind, side, PNL[stance], "light").intentClass;
    const dark = readChange(kind, side, PNL[stance], "dark").intentClass;
    assert.notEqual(light, dark, `${kind}/${side}/${stance} uses one shade for both themes`);
    assert.match(light, /-(500|600)$/, `${kind}/${side}/${stance} light`);
    assert.match(dark, /-(400)$/, `${kind}/${side}/${stance} dark`);
  }
});

test("only the words change with the theme's shade, never the reading", () => {
  for (const { kind, side, stance } of every()) {
    const light = readChange(kind, side, PNL[stance], "light");
    const dark = readChange(kind, side, PNL[stance], "dark");
    assert.equal(light.intent, dark.intent);
    assert.equal(light.mark, dark.mark);
    assert.equal(light.title, dark.title);
    assert.equal(light.lean, dark.lean);
  }
});
