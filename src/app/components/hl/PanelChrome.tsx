"use client";
import type { ReactNode } from "react";
import type { PanelTheme } from "./panelTheme";

interface PanelShellProps {
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  footer?: ReactNode;
  theme: PanelTheme;
  height: number;
  children: ReactNode;
}

/** Header + scrollable body shared by every Hyperliquid panel. */
export function PanelShell({
  title,
  subtitle,
  controls,
  footer,
  theme,
  height,
  children,
}: PanelShellProps) {
  return (
    <div className={`w-full h-full ${theme.bg} ${theme.text} flex flex-col`} style={{ height }}>
      <div className={`px-3 py-2 border-b ${theme.border} ${theme.headerBg} flex-shrink-0`}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold whitespace-nowrap">{title}</h3>
          {subtitle && <div className={`text-[11px] ${theme.secondaryText} truncate`}>{subtitle}</div>}
        </div>
        {controls && <div className="flex items-center gap-2 flex-wrap">{controls}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      {footer && (
        <div className={`px-3 py-1 border-t ${theme.border} ${theme.secondaryText} text-[10px] flex-shrink-0`}>
          {footer}
        </div>
      )}
    </div>
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
