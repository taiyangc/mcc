// How the whale feed reads a position change.
//
// The action on its own says very little. A whale trimming a short is doing one of two
// opposite things depending on where the position sits: banking a win if the trade has
// run its way, or covering into strength — the bull-fear case — if it has not. The feed
// printed "trim" for both, in one colour. Direction, action and stance are read together
// here instead, so the row says what was done, which way, where the position stands, and
// what it most likely means.
//
// Three channels carry it. The action and the side share one colour, the market's own
// green and red, so which way a row points is the first thing seen. The reading beside it
// takes a mark whose shape is the action — size on, size off, gone, new, reversed — and
// whose hue is the motive. Shape and hue together mean two near hues can never be
// mistaken for each other, since nothing that looks alike is also shaped alike.

import { formatPct } from "../../lib/format.ts";
import type { Theme } from "../../lib/useSystemTheme";
import type { PositionChangeKind } from "../../lib/hl/aggregate";

export type Side = "long" | "short";

/** How far mark has run from entry, in the direction the position is pointing. */
export function pnlFromEntry(
  entryPx: number | null,
  markPx: number | null,
  isLong: boolean,
): number | null {
  if (!entryPx || !markPx) return null;
  return ((markPx - entryPx) / entryPx) * (isLong ? 1 : -1);
}

/** Where a position sits against its own entry — what turns an action into a motive. */
export type PnlStance = "ahead" | "behind" | "flat" | "unknown";

/**
 * How far from entry a position has to be before the move means anything.
 *
 * A book that has gone 0.05% its way is on its entry, and calling a trim there "taking
 * profit" invents a motive the price does not support. Inside the band the row says only
 * what was done.
 */
export const FLAT_PNL_BAND = 0.0025;

export function pnlStance(pnl: number | null): PnlStance {
  if (pnl === null || !Number.isFinite(pnl)) return "unknown";
  if (pnl > FLAT_PNL_BAND) return "ahead";
  if (pnl < -FLAT_PNL_BAND) return "behind";
  return "flat";
}

/**
 * One hue per action-and-stance pair, carried by the mark and the reading it labels.
 *
 * Nine is about as many as anyone can tell apart in an 11px row, so they are spent where
 * the distinction pays: inside an action, the winning branch and the losing one sit at
 * opposite ends of the wheel, and taking profit is never one shade away from cutting a
 * loss. Between actions they may sit closer, because the mark's shape has already
 * separated them — and the three that read as profit are greens on purpose, so the
 * family carries too.
 *
 * `violet` is the exception to that family: adding to a losing position is the one move
 * here that is a decision rather than a reaction, and it gets a hue outside both camps.
 *
 * `slate` is less a colour than the absence of a claim. It marks the rows whose position
 * is on its entry, or has no price to be measured against, where a motive would be made up.
 */
type ActionHue =
  | "sky"
  | "emerald"
  | "violet"
  | "lime"
  | "orange"
  | "teal"
  | "rose"
  | "fuchsia"
  | "slate";

/**
 * Both shades are written out in full because Tailwind only ships the classes it can see,
 * and because one shade cannot serve both themes: lime-500 is barely there on white, and
 * the -600s go muddy on zinc-900.
 */
const HUE_CLASS: Record<ActionHue, Record<Theme, string>> = {
  sky: { light: "text-sky-600", dark: "text-sky-400" },
  emerald: { light: "text-emerald-600", dark: "text-emerald-400" },
  violet: { light: "text-violet-600", dark: "text-violet-400" },
  lime: { light: "text-lime-600", dark: "text-lime-400" },
  orange: { light: "text-orange-600", dark: "text-orange-400" },
  teal: { light: "text-teal-600", dark: "text-teal-400" },
  rose: { light: "text-rose-600", dark: "text-rose-400" },
  fuchsia: { light: "text-fuchsia-600", dark: "text-fuchsia-400" },
  slate: { light: "text-slate-500", dark: "text-slate-400" },
};

/** A wording that turns on the side of the market, or one that does not. */
type Phrase = string | Record<Side, string>;

function say(phrase: Phrase, side: Side): string {
  return typeof phrase === "string" ? phrase : phrase[side];
}

interface StanceRead {
  /** The likely motive, in two or three words: the action sits beside it on one line. */
  intent: Phrase;
  hue: ActionHue;
}

interface KindRead {
  /** One word, so "Trim short" fits the column without wrapping. */
  verb: string;
  /**
   * The shape of the reading's mark: what the trade did to the position, at a glance.
   *
   * Geometry rather than emoji, and for a reason beyond the boxes those drew: an emoji
   * arrives with its own colours and refuses yours, so it could never take the motive's
   * hue. These are ordinary characters. They inherit the colour like any other letter.
   */
  mark: string;
  /** Whether the trade puts size on. Buying is growing a long or shrinking a short. */
  grows: boolean;
  /** What happened, opening the tooltip. */
  did: (side: Side) => string;
  byStance: Record<PnlStance, StanceRead>;
}

/**
 * A position that has just been opened or reversed is on its entry by construction, so
 * its stance cannot say anything about why: both read the same however the price sits.
 */
function atEntry(read: StanceRead): Record<PnlStance, StanceRead> {
  return { ahead: read, behind: read, flat: read, unknown: read };
}

const READS: Record<PositionChangeKind, KindRead> = {
  open: {
    mark: "◆", // a marker planted where there was nothing
    verb: "Open",
    grows: true,
    did: side => `Opened a ${side} the previous pass did not show`,
    byStance: atEntry({ intent: "new bet", hue: "sky" }),
  },
  increase: {
    mark: "▲", // size going on
    verb: "Add",
    grows: true,
    did: side => `Added to a ${side} already held`,
    byStance: {
      ahead: { intent: "pressing a winner", hue: "emerald" },
      behind: { intent: { long: "averaging down", short: "averaging up" }, hue: "violet" },
      flat: { intent: "scaling in", hue: "slate" },
      unknown: { intent: "scaling in", hue: "slate" },
    },
  },
  reduce: {
    mark: "▼", // size coming off
    verb: "Trim",
    grows: false,
    did: side => `Reduced a ${side} without closing it`,
    byStance: {
      ahead: { intent: "taking profit", hue: "lime" },
      behind: { intent: "cutting risk", hue: "orange" },
      flat: { intent: "scaling out", hue: "slate" },
      unknown: { intent: "scaling out", hue: "slate" },
    },
  },
  close: {
    mark: "■", // a full stop
    verb: "Close",
    grows: false,
    did: side => `Closed the whole ${side}`,
    byStance: {
      ahead: { intent: "booked the win", hue: "teal" },
      behind: { intent: "took the loss", hue: "rose" },
      flat: { intent: "flat exit", hue: "slate" },
      unknown: { intent: "flat exit", hue: "slate" },
    },
  },
  flip: {
    mark: "⇄", // turned around
    verb: "Flip",
    grows: true,
    did: side => `Reversed a ${side === "long" ? "short" : "long"} into a ${side}`,
    byStance: atEntry({
      intent: { long: "turned bullish", short: "turned bearish" },
      hue: "fuchsia",
    }),
  },
};

const STANCE_CLAUSE: Record<PnlStance, (pnl: number) => string> = {
  ahead: pnl => `, ${formatPct(Math.abs(pnl))} ahead of its entry`,
  behind: pnl => `, ${formatPct(Math.abs(pnl))} under its entry`,
  flat: () => ", sitting on its entry",
  unknown: () => ", with no entry or mark to price it against",
};

export interface ActionRead {
  /** "Trim" — what was done. Drawn with the side, in the side's one colour. */
  verb: string;
  /** "short" — which way. */
  side: Side;
  /** "▼" — the action's shape, leading the reading and taking its colour. */
  mark: string;
  /** "taking profit" — why, most likely. */
  intent: string;
  /**
   * Colour for the mark and the reading: the action and the stance together, never
   * either alone. The action phrase does not take it — that one is the side's, so the
   * row says which way it points before anything else is read.
   */
  intentClass: string;
  /** What the trade does to the tape. Covering a short is a buy, red side or not. */
  lean: "buy" | "sell";
  stance: PnlStance;
  /** The whole reading as one sentence, for the cell's tooltip. */
  title: string;
}

/** Read one change into the words, the shape and the colour the action column draws. */
export function readChange(
  kind: PositionChangeKind,
  side: Side,
  pnl: number | null,
  theme: Theme,
): ActionRead {
  const kindRead = READS[kind];
  const stance = pnlStance(pnl);
  const stanceRead = kindRead.byStance[stance];
  const intent = say(stanceRead.intent, side);
  const lean = kindRead.grows === (side === "long") ? "buy" : "sell";
  return {
    verb: kindRead.verb,
    side,
    mark: kindRead.mark,
    intent,
    intentClass: HUE_CLASS[stanceRead.hue][theme],
    lean,
    stance,
    title:
      `${kindRead.did(side)}${STANCE_CLAUSE[stance](pnl ?? 0)}.` +
      ` Likely: ${intent}. On the tape it is a ${lean}.`,
  };
}
