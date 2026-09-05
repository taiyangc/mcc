import type { Theme } from "../../lib/useSystemTheme";

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
