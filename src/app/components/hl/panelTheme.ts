import type { Theme } from "../../lib/useSystemTheme";
import type { PositionChangeKind } from "../../lib/hl/aggregate";

/** The shared look of every first-party panel, matching HypeUnstakingWidget. */
export interface PanelTheme {
  bg: string;
  text: string;
  secondaryText: string;
  border: string;
  headerBg: string;
  rowEvenBg: string;
  rowHoverBg: string;
  select: string;
  chip: string;
  chipActive: string;
  tabActive: string;
  tabIdle: string;
  gridLine: string;
}

export function panelTheme(theme: Theme): PanelTheme {
  const dark = theme === "dark";
  return {
    bg: dark ? "bg-zinc-900" : "bg-white",
    text: dark ? "text-gray-100" : "text-gray-900",
    secondaryText: dark ? "text-gray-400" : "text-gray-600",
    border: dark ? "border-zinc-700" : "border-gray-200",
    headerBg: dark ? "bg-zinc-800" : "bg-gray-50",
    rowEvenBg: dark ? "bg-zinc-800/50" : "bg-gray-50/50",
    rowHoverBg: dark ? "hover:bg-zinc-700/50" : "hover:bg-gray-100",
    select: `text-[10px] font-medium rounded border px-1 py-0.5 outline-none ${
      dark
        ? "bg-zinc-700 text-gray-200 border-zinc-600 hover:bg-zinc-600"
        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
    }`,
    chip: dark
      ? "bg-zinc-700 text-gray-300 border-zinc-600 hover:bg-zinc-600"
      : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200",
    chipActive: "bg-blue-600 text-white border-blue-600 hover:bg-blue-700",
    tabActive: dark ? "bg-zinc-700 text-gray-100" : "bg-white text-gray-900 shadow-sm",
    tabIdle: dark ? "text-gray-400 hover:text-gray-200" : "text-gray-500 hover:text-gray-800",
    gridLine: dark ? "#3f3f46" : "#e5e7eb",
  };
}

/**
 * How many accounts a number is drawn from.
 *
 * These panels mix two kinds of figure that look identical in a table and mean very
 * different things: a whole-population figure the venue publishes, and one inferred from
 * a few hundred sampled accounts. A reader who takes the second for the first reads a
 * sample as the whole market, so every block says which it is. The chip names the
 * population and nothing else — which API served it is not the reader's problem.
 */
export type PanelSource = "all" | "cohort";

export function sourceBadgeClass(source: PanelSource): string {
  return source === "all"
    ? "text-sky-500 border-sky-500/40 bg-sky-500/10"
    : "text-violet-500 border-violet-500/40 bg-violet-500/10";
}

/** How one kind of position change is drawn in the action column. */
export interface ChangeKindStyle {
  /** Leading glyph, picked for its silhouette at 11px rather than for its detail. */
  icon: string;
  /** Kept to five characters so a narrow panel still shows the whole word. */
  label: string;
  className: string;
  /** The full sentence, for the cell's tooltip. */
  title: string;
}

/**
 * The action column, which is the one thing a reader scans this feed for: did size go
 * on, or come off? As one muted word per row it was the least legible part of the row.
 * Each kind now carries a glyph of its own shape and a colour of its own.
 *
 * The hue does not repeat the long/short axis two columns to the left: here green means
 * exposure grew and amber means it shrank, on either side of the market.
 */
export const CHANGE_KIND_STYLE: Record<PositionChangeKind, ChangeKindStyle> = {
  open: {
    icon: "🆕",
    label: "open",
    className: "text-sky-500",
    title: "Opened a position that was not held on the previous pass",
  },
  increase: {
    icon: "⬆️",
    label: "add",
    className: "text-emerald-500",
    title: "Added to a position already held",
  },
  reduce: {
    icon: "⬇️",
    label: "trim",
    className: "text-amber-500",
    title: "Reduced a position without closing it",
  },
  close: {
    icon: "⛔",
    label: "close",
    className: "text-rose-500",
    title: "Closed the position outright",
  },
  flip: {
    icon: "🔄",
    label: "flip",
    className: "text-fuchsia-500",
    title: "Reversed the position: closed one side and opened the other",
  },
};

/** Long/short and up/down colouring, consistent across every panel. */
export const LONG_COLOR = "#10b981";
export const SHORT_COLOR = "#f43f5e";

export function sideTextClass(isLong: boolean): string {
  return isLong ? "text-emerald-500" : "text-rose-500";
}

export function signTextClass(value: number): string {
  if (value > 0) return "text-emerald-500";
  if (value < 0) return "text-rose-500";
  return "";
}

/**
 * Size bands that earn extra emphasis, in USD.
 *
 * A whale feed filtered at $1M is mostly $1M rows, and the handful of genuinely large
 * ones have to be findable without reading every number. These are the points where a
 * position stops being merely large: the first band sits one filter level above the
 * default, so the rows that light up are the ones worth looking at rather than most of
 * the screen.
 */
export const SIZE_TIER_USD = [5_000_000, 50_000_000, 100_000_000] as const;

export type SizeTier = 0 | 1 | 2 | 3;

export function sizeTier(notionalUsd: number): SizeTier {
  const abs = Math.abs(notionalUsd);
  if (!Number.isFinite(abs)) return 0;
  if (abs >= SIZE_TIER_USD[2]) return 3;
  if (abs >= SIZE_TIER_USD[1]) return 2;
  if (abs >= SIZE_TIER_USD[0]) return 1;
  return 0;
}

/** "≥ $50M", for explaining a highlighted row on hover. */
export function sizeTierLabel(tier: SizeTier): string | undefined {
  if (tier === 0) return undefined;
  const usd = SIZE_TIER_USD[tier - 1];
  return `≥ $${usd / 1_000_000}M`;
}

// Each band adds a signal of a different kind rather than more of the last one: at these
// font sizes semibold against bold is not a difference anyone can see across a scrolling
// list. The rule arrives first, then the flat tint, then the gradient and frame.
// Tints are alpha over whatever the panel sits on, so one ramp reads in both themes.
const TIER_LONG = [
  "border-transparent",
  "border-emerald-500/40",
  "border-emerald-500/70 bg-emerald-500/[0.12]",
  "border-emerald-500 bg-linear-to-r from-emerald-500/40 via-emerald-500/15 to-emerald-500/5" +
    " inset-ring-1 inset-ring-emerald-500/50",
];
const TIER_SHORT = [
  "border-transparent",
  "border-rose-500/40",
  "border-rose-500/70 bg-rose-500/[0.12]",
  "border-rose-500 bg-linear-to-r from-rose-500/40 via-rose-500/15 to-rose-500/5" +
    " inset-ring-1 inset-ring-rose-500/50",
];
const TIER_WEIGHT = ["font-medium", "font-semibold", "font-bold", "font-bold"];

/**
 * Frame and tint for a row of this size, in the row's own long/short hue.
 *
 * The left rule is always drawn — transparent below the first band — so moving between
 * tiers tints a row without shifting the grid under it.
 */
export function sizeRowClass(isLong: boolean, tier: SizeTier): string {
  return `border-l-2 ${(isLong ? TIER_LONG : TIER_SHORT)[tier]}`;
}

/** Weight alone for a value that carries its own colour, such as a signed change. */
export function sizeWeightClass(tier: SizeTier): string {
  return TIER_WEIGHT[tier];
}

/** The notional itself takes the side's colour and gains weight as the tier climbs. */
export function sizeValueClass(isLong: boolean, tier: SizeTier): string {
  const weight = TIER_WEIGHT[tier];
  return tier === 0 ? weight : `${sideTextClass(isLong)} ${weight}`;
}
