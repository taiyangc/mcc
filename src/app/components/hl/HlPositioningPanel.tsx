"use client";
// Panels 2a (open interest) and 2b (margin). Both read the same two endpoints and differ
// in which figures they lead with, so they share one component.

import { useMemo } from "react";
import { usePolledJson } from "./usePolledJson";
import { panelTheme, LONG_COLOR, SHORT_COLOR, signTextClass } from "./panelTheme";
import { LongShortBar, PanelMessage, PanelShell, StatTile } from "./PanelChrome";
import LineChart from "../charts/LineChart";
import { useSystemTheme } from "../../lib/useSystemTheme";
import { useNow } from "./useNow";
import { formatAge, formatCompact, formatRatePct, formatUsd } from "../../lib/format";
import { COHORT_LABELS } from "../../lib/hl/panels";
import type { HlCohort, HlMarginSpec, HlOiSpec } from "../../lib/hl/panels";
import type { PerpStats } from "../../lib/hl/perpStats";
import type { WhaleSnapshot } from "../../lib/hl/whaleCohort";

interface Props {
  spec: HlOiSpec | HlMarginSpec;
  refreshKey: number;
  height: number;
  onSpecChange: (spec: HlOiSpec | HlMarginSpec) => void;
}

const COHORTS: HlCohort[] = ["ALL", "PNL", "VOL", "WHALE"];

export default function HlPositioningPanel({ spec, refreshKey, height, onSpecChange }: Props) {
  const theme = panelTheme(useSystemTheme());
  const now = useNow(5000);
  const isOi = spec.kind === "oi";

  const stats = usePolledJson<PerpStats>("/api/hyperliquid/perp-stats", refreshKey);
  const whales = usePolledJson<WhaleSnapshot>("/api/hyperliquid/whales", refreshKey);

  const cohortKey: HlCohort = spec.kind === "margin" ? spec.cohort : "ALL";
  const cohort = whales.data?.cohorts?.[cohortKey] ?? null;

  const series = useMemo(() => {
    const samples = whales.data?.series ?? [];
    if (isOi) {
      const oiSamples = stats.data?.series ?? [];
      return [
        {
          key: "oi",
          label: spec.kind === "oi" && spec.scope === "ALL" ? "OI (all dexes)" : "OI (core perps)",
          color: "#3b82f6",
          fill: true,
          points: oiSamples.map(s => ({
            t: s.t,
            v: spec.kind === "oi" && spec.scope === "ALL" ? s.allDexOiUsd : s.coreOiUsd,
          })),
        },
      ];
    }
    return [
      {
        key: "margin",
        label: "Margin used",
        color: "#8b5cf6",
        fill: true,
        points: samples.map(s => ({ t: s.t, v: s.marginUsed })),
      },
      {
        key: "equity",
        label: "Account value",
        color: "#3b82f6",
        points: samples.map(s => ({ t: s.t, v: s.accountValue })),
      },
    ];
  }, [whales.data, stats.data, isOi, spec]);

  const longShortSeries = useMemo(() => {
    const samples = whales.data?.series ?? [];
    return [
      {
        key: "long",
        label: "Long",
        color: LONG_COLOR,
        points: samples.map(s => ({ t: s.t, v: s.longUsd })),
      },
      {
        key: "short",
        label: "Short",
        color: SHORT_COLOR,
        points: samples.map(s => ({ t: s.t, v: s.shortUsd })),
      },
    ];
  }, [whales.data]);

  if (stats.loading && !stats.data && whales.loading && !whales.data) {
    return (
      <PanelMessage theme={theme} height={height}>
        Loading Hyperliquid market data…
      </PanelMessage>
    );
  }

  if (!stats.data && !whales.data) {
    return (
      <PanelMessage theme={theme} height={height} tone="error">
        {stats.error || whales.error || "No data available"}
      </PanelMessage>
    );
  }

  const marketStats = stats.data;
  const leverage = cohort && cohort.marginUsed > 0
    ? (cohort.longUsd + cohort.shortUsd) / cohort.marginUsed
    : 0;

  const controls = (
    <>
      {isOi ? (
        <label className={`flex items-center gap-1 text-[10px] ${theme.secondaryText}`}>
          Scope
          <select
            value={(spec as HlOiSpec).scope}
            onChange={e =>
              onSpecChange({ kind: "oi", scope: e.target.value === "ALL" ? "ALL" : "CORE" })
            }
            className={theme.select}
          >
            <option value="CORE">Core perps</option>
            <option value="ALL">All dexes (incl. HIP-3)</option>
          </select>
        </label>
      ) : null}
      <label className={`flex items-center gap-1 text-[10px] ${theme.secondaryText}`}>
        Cohort
        <select
          value={cohortKey}
          onChange={e => {
            const next = e.target.value as HlCohort;
            if (spec.kind === "margin") onSpecChange({ kind: "margin", cohort: next });
          }}
          className={theme.select}
          disabled={isOi}
          title={isOi ? "Long/short always uses every tracked trader on this panel" : undefined}
        >
          {COHORTS.map(c => (
            <option key={c} value={c}>
              {COHORT_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  const subtitle = whales.data
    ? `${cohort?.n ?? 0} tracked · ${formatAge(whales.data.updatedAt, now)}`
    : "";

  return (
    <PanelShell
      title={isOi ? "Hyperliquid Open Interest" : "Hyperliquid Margin & Leverage"}
      subtitle={subtitle}
      controls={controls}
      theme={theme}
      height={height}
      footer={
        <span>
          {whales.data?.lastError
            ? `Cohort refresh failing: ${whales.data.lastError}`
            : whales.data?.rateLimited
              ? "Rate limited — cohort refreshing slowly."
              : isOi
                ? "Open interest is exchange-wide. Long/short is measured across tracked top traders, not the whole exchange."
                : "Margin and equity are summed across tracked top traders, not the whole exchange."}
        </span>
      }
    >
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {isOi ? (
            <>
              <StatTile
                theme={theme}
                label="Core perps OI"
                value={marketStats ? formatUsd(marketStats.coreOiUsd) : "—"}
                hint="crypto perps"
              />
              <StatTile
                theme={theme}
                label="All dexes OI"
                value={marketStats ? formatUsd(marketStats.allDexOiUsd) : "—"}
                hint="incl. HIP-3 builders"
              />
              <StatTile
                theme={theme}
                label="24h volume"
                value={marketStats ? formatUsd(marketStats.dailyVolumeUsd) : "—"}
              />
              <StatTile
                theme={theme}
                label="Accounts"
                value={marketStats ? formatCompact(marketStats.nUsers, 2) : "—"}
                hint="lifetime users"
              />
            </>
          ) : (
            <>
              <StatTile
                theme={theme}
                label="Account value"
                value={cohort ? formatUsd(cohort.accountValue) : "—"}
                hint={`${cohort?.n ?? 0} traders`}
              />
              <StatTile
                theme={theme}
                label="Margin used"
                value={cohort ? formatUsd(cohort.marginUsed) : "—"}
                hint={
                  cohort && cohort.accountValue > 0
                    ? `${((cohort.marginUsed / cohort.accountValue) * 100).toFixed(1)}% of equity`
                    : undefined
                }
              />
              <StatTile
                theme={theme}
                label="Notional"
                value={cohort ? formatUsd(cohort.longUsd + cohort.shortUsd) : "—"}
              />
              <StatTile
                theme={theme}
                label="Avg leverage"
                value={leverage > 0 ? `${leverage.toFixed(2)}x` : "—"}
                hint="notional ÷ margin"
              />
            </>
          )}
        </div>

        {cohort && (
          <div className={`p-2 rounded border ${theme.border}`}>
            <LongShortBar
              theme={theme}
              longUsd={isOi ? cohort.longUsd : cohort.longMarginUsed}
              shortUsd={isOi ? cohort.shortUsd : cohort.shortMarginUsed}
              longPct={
                isOi
                  ? cohort.longPct
                  : cohort.longMarginUsed + cohort.shortMarginUsed > 0
                    ? cohort.longMarginUsed / (cohort.longMarginUsed + cohort.shortMarginUsed)
                    : 0
              }
              formatValue={formatUsd}
              label={
                isOi
                  ? `Long vs short notional · ${COHORT_LABELS[cohortKey]}`
                  : `Long vs short margin · ${COHORT_LABELS[cohortKey]}`
              }
            />
          </div>
        )}

        <div className={`rounded border ${theme.border} p-2`}>
          <div className={`text-[10px] mb-1 ${theme.secondaryText}`}>
            {isOi ? "Open interest" : "Margin and equity"} · since server start
          </div>
          <LineChart
            series={series}
            height={120}
            gridColor={theme.gridLine}
            textColor={theme.gridLine === "#3f3f46" ? "#a1a1aa" : "#6b7280"}
            formatValue={v => formatUsd(v)}
            emptyLabel="Collecting samples…"
          />
        </div>

        {isOi ? (
          <div className={`rounded border ${theme.border} overflow-hidden`}>
            <div
              className={`grid grid-cols-[1fr_1.1fr_1.1fr_0.9fr_0.9fr] px-2 py-1 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText} ${theme.headerBg}`}
            >
              <span>Market</span>
              <span className="text-right">Open interest</span>
              <span className="text-right">24h volume</span>
              <span className="text-right">Funding APR</span>
              <span className="text-right">24h</span>
            </div>
            {(marketStats?.coins ?? []).slice(0, 12).map((coin, idx) => (
              <div
                key={coin.coin}
                className={`grid grid-cols-[1fr_1.1fr_1.1fr_0.9fr_0.9fr] px-2 py-1 text-[11px] tabular-nums ${
                  idx % 2 === 0 ? theme.rowEvenBg : ""
                } ${theme.rowHoverBg}`}
              >
                <span className="font-medium">{coin.coin}</span>
                <span className="text-right">{formatUsd(coin.oiUsd)}</span>
                <span className="text-right">{formatUsd(coin.dayNtlVlm)}</span>
                <span className={`text-right ${signTextClass(coin.fundingHourly)}`}>
                  {formatRatePct(coin.fundingHourly * 24 * 365, 2)}
                </span>
                <span className={`text-right ${signTextClass(coin.changePct)}`}>
                  {formatRatePct(coin.changePct, 2)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={`rounded border ${theme.border} p-2`}>
            <div className={`text-[10px] mb-1 ${theme.secondaryText}`}>
              Long vs short notional · since server start
            </div>
            <LineChart
              series={longShortSeries}
              height={110}
              gridColor={theme.gridLine}
              textColor={theme.gridLine === "#3f3f46" ? "#a1a1aa" : "#6b7280"}
              formatValue={v => formatUsd(v)}
              emptyLabel="Collecting samples…"
            />
          </div>
        )}
      </div>
    </PanelShell>
  );
}
