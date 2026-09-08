"use client";
import type { ReactNode } from "react";
import { sourceBadgeClass } from "./panelTheme";
import type { PanelSource, PanelTheme } from "./panelTheme";

interface PanelShellProps {
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  /**
   * What the panel would otherwise print along its bottom edge: where the numbers come
   * from, how to read them, what a column means. It is worth saying once and rereading
   * never, so it hides behind the header's "?" instead of occupying a rule of every
   * panel forever.
   */
  help?: string;
  /**
   * Trouble the reader has to see without asking: a failing refresh, a throttled cohort.
   * Never boilerplate — anything that is true on a good day belongs in `help`.
   */
  status?: ReactNode;
  theme: PanelTheme;
  height: number;
  children: ReactNode;
}

/** Header + scrollable body shared by every Hyperliquid panel. */
export function PanelShell({
  title,
  subtitle,
  controls,
  help,
  status,
  theme,
  height,
  children,
}: PanelShellProps) {
  return (
    <div className={`w-full h-full ${theme.bg} ${theme.text} flex flex-col`} style={{ height }}>
      <div className={`px-3 py-2 border-b ${theme.border} ${theme.headerBg} flex-shrink-0`}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold whitespace-nowrap">{title}</h3>
          <div className="flex items-center gap-1.5 min-w-0">
            {status && <span className="text-[10px] text-amber-500 truncate">{status}</span>}
            {subtitle && (
              <div className={`text-[11px] ${theme.secondaryText} truncate`}>{subtitle}</div>
            )}
            {help && <HelpHint help={help} theme={theme} />}
          </div>
        </div>
        {controls && <div className="flex items-center gap-2 flex-wrap">{controls}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  );
}

/** The "?" that holds a panel's explanation until someone wants it. */
function HelpHint({ help, theme }: { help: string; theme: PanelTheme }) {
  return (
    <span
      title={help}
      aria-label={help}
      role="note"
      className={`shrink-0 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] leading-none cursor-help ${theme.border} ${theme.secondaryText}`}
    >
      ?
    </span>
  );
}

export function PanelMessage({ theme, height, children, tone = "muted" }: {
  theme: PanelTheme;
  height: number;
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <div className={`w-full h-full ${theme.bg} flex items-center justify-center p-4`} style={{ height }}>
      <div className={`text-sm text-center ${tone === "error" ? "text-red-500" : theme.secondaryText}`}>
        {children}
      </div>
    </div>
  );
}

interface SourceBadgeProps {
  source: PanelSource;
  label: string;
  title?: string;
}

/** A chip naming how many accounts the figures beside it are drawn from. */
export function SourceBadge({ source, label, title }: SourceBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-xs border px-1 py-px text-[8px] font-semibold uppercase tracking-wider whitespace-nowrap ${sourceBadgeClass(
        source,
      )}`}
      title={title}
    >
      {label}
    </span>
  );
}

/**
 * The heading over a block of stats, saying how many accounts it covers.
 *
 * The rule runs to the edge because the blocks it separates are otherwise identical
 * grids of tiles: without it the whole-market numbers and the cohort's read as one table.
 * `label` is for what the badge cannot say on its own — which cohort is selected — and is
 * left off wherever the tiles already name themselves.
 */
export function SourceHeading({
  source,
  badge,
  label,
  title,
  theme,
}: {
  source: PanelSource;
  badge: string;
  label?: string;
  title?: string;
  theme: PanelTheme;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <SourceBadge source={source} label={badge} title={title} />
      {label && (
        <span className={`text-[9px] uppercase tracking-wider ${theme.secondaryText}`}>{label}</span>
      )}
      <span className={`flex-1 border-t ${theme.border}`} />
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
  theme: PanelTheme;
}

export function StatTile({ label, value, hint, valueClass = "", theme }: StatTileProps) {
  return (
    <div className={`px-2 py-1.5 rounded border ${theme.border} min-w-0`}>
      <div className={`text-[9px] uppercase tracking-wider ${theme.secondaryText} truncate`}>{label}</div>
      <div className={`text-sm font-semibold tabular-nums truncate ${valueClass}`}>{value}</div>
      {hint && <div className={`text-[9px] ${theme.secondaryText} truncate`}>{hint}</div>}
    </div>
  );
}

interface LongShortBarProps {
  longUsd: number;
  shortUsd: number;
  longPct: number;
  theme: PanelTheme;
  formatValue: (v: number) => string;
  label?: string;
}

/** The long-vs-short split bar used by the positioning and ratio panels. */
export function LongShortBar({
  longUsd,
  shortUsd,
  longPct,
  theme,
  formatValue,
  label,
}: LongShortBarProps) {
  const total = longUsd + shortUsd;
  const pct = total > 0 ? longPct * 100 : 0;
  return (
    <div className="w-full">
      {label && <div className={`text-[10px] mb-1 ${theme.secondaryText}`}>{label}</div>}
      <div className="flex items-center justify-between text-[11px] mb-1 tabular-nums">
        <span className="text-emerald-500 font-medium">
          {formatValue(longUsd)} <span className="opacity-70">long</span>
        </span>
        <span className="text-rose-500 font-medium">
          <span className="opacity-70">short</span> {formatValue(shortUsd)}
        </span>
      </div>
      <div className={`h-2.5 w-full rounded-full overflow-hidden flex ${theme.headerBg}`}>
        <div className="bg-emerald-500 h-full" style={{ width: `${pct}%` }} />
        <div className="bg-rose-500 h-full" style={{ width: `${100 - pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px] mt-0.5 tabular-nums">
        <span className="text-emerald-500">{pct.toFixed(1)}%</span>
        <span className="text-rose-500">{(100 - pct).toFixed(1)}%</span>
      </div>
    </div>
  );
}
