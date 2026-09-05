"use client";
// The exchange-wide view: open interest and volume for the whole venue, alongside the
// margin, leverage and long/short split of the tracked trader cohort.

import { useMemo, useState } from "react";
import { usePolledJson } from "./usePolledJson";
import { panelTheme, LONG_COLOR, SHORT_COLOR, signTextClass } from "./panelTheme";
import { LongShortBar, PanelMessage, PanelShell, StatTile } from "./PanelChrome";
import LineChart from "../charts/LineChart";
import { useSystemTheme } from "../../lib/useSystemTheme";
import { useNow } from "./useNow";
import { formatAge, formatCompact, formatUsd } from "../../lib/format";
import { COHORT_LABELS } from "../../lib/hl/panels";
import type { HlCohort, HlCoreSpec } from "../../lib/hl/panels";
import type { PerpStats } from "../../lib/hl/perpStats";
import type { WhaleSnapshot } from "../../lib/hl/whaleCohort";

interface Props {
  spec: HlCoreSpec;
  refreshKey: number;
  height: number;
  onSpecChange: (spec: HlCoreSpec) => void;
}

const COHORTS: HlCohort[] = ["ALL", "PNL", "VOL", "WHALE"];

type ChartMetric = "oi" | "positioning" | "margin";

const CHART_LABELS: Record<ChartMetric, string> = {
  oi: "Open interest",
  positioning: "Long vs short",
  margin: "Margin & equity",
};

export default function HlCorePanel({ spec, refreshKey, height, onSpecChange }: Props) {
  const theme = panelTheme(useSystemTheme());
  const now = useNow(5000);
  const [metric, setMetric] = useState<ChartMetric>("oi");

  const stats = usePolledJson<PerpStats>("/api/hyperliquid/perp-stats", refreshKey);
  const whales = usePolledJson<WhaleSnapshot>("/api/hyperliquid/whales", refreshKey);

  const cohort = whales.data?.cohorts?.[spec.cohort] ?? null;
  const axisText = theme.gridLine === "#3f3f46" ? "#a1a1aa" : "#6b7280";

  const series = useMemo(() => {
    const cohortSamples = whales.data?.series ?? [];
    const oiSamples = stats.data?.series ?? [];
    if (metric === "oi") {
      return [
        {
          key: "core",
          label: "Core perps",
          color: "#3b82f6",
          fill: true,
          points: oiSamples.map(s => ({ t: s.t, v: s.coreOiUsd })),
        },
        {
          key: "all",
          label: "All dexes",
          color: "#a855f7",
          points: oiSamples.map(s => ({ t: s.t, v: s.allDexOiUsd })),
        },
      ];
    }
    if (metric === "positioning") {
      return [
        {
          key: "long",
          label: "Long",
          color: LONG_COLOR,
          points: cohortSamples.map(s => ({ t: s.t, v: s.longUsd })),
        },
        {
          key: "short",
          label: "Short",
          color: SHORT_COLOR,
          points: cohortSamples.map(s => ({ t: s.t, v: s.shortUsd })),
        },
      ];
    }
    return [
      {
        key: "equity",
        label: "Account value",
        color: "#3b82f6",
        points: cohortSamples.map(s => ({ t: s.t, v: s.accountValue })),
      },
      {
        key: "margin",
        label: "Margin used",
        color: "#8b5cf6",
        fill: true,
        points: cohortSamples.map(s => ({ t: s.t, v: s.marginUsed })),
      },
    ];
  }, [metric, whales.data, stats.data]);

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
  const notional = cohort ? cohort.longUsd + cohort.shortUsd : 0;
  const leverage = cohort && cohort.marginUsed > 0 ? notional / cohort.marginUsed : 0;
  const marginTotal = cohort ? cohort.longMarginUsed + cohort.shortMarginUsed : 0;

  const controls = (
    <>
      <label className={`flex items-center gap-1 text-[10px] ${theme.secondaryText}`}>
        Cohort
        <select
          value={spec.cohort}
          onChange={e => onSpecChange({ kind: "core", cohort: e.target.value as HlCohort })}
          className={theme.select}
          title="Which tracked traders the positioning figures cover"
        >
          {COHORTS.map(c => (
            <option key={c} value={c}>
              {COHORT_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className={`flex items-center gap-1 text-[10px] ${theme.secondaryText}`}>
        Chart
        <select
          value={metric}
          onChange={e => setMetric(e.target.value as ChartMetric)}
          className={theme.select}
        >
          {(Object.keys(CHART_LABELS) as ChartMetric[]).map(m => (
            <option key={m} value={m}>
              {CHART_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <PanelShell
      title="Hyperliquid Overview"
      subtitle={
        whales.data ? `${cohort?.n ?? 0} tracked · ${formatAge(whales.data.updatedAt, now)}` : ""
      }
      controls={controls}
      theme={theme}
      height={height}
      footer={
        <span>
          {whales.data?.lastError
            ? `Cohort refresh failing: ${whales.data.lastError}`
            : whales.data?.rateLimited
              ? "Rate limited — the tracked cohort is refreshing slowly."
              : "Open interest and volume are exchange-wide. Margin, leverage and long/short cover tracked top traders only."}
        </span>
      }
    >
      <div className="p-3 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile
            theme={theme}
            label="Open interest"
            value={marketStats ? formatUsd(marketStats.coreOiUsd) : "—"}
            hint="core crypto perps"
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
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile
            theme={theme}
            label="Account value"
            value={cohort ? formatUsd(cohort.accountValue) : "—"}
            hint={`${cohort?.n ?? 0} tracked traders`}
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
          <StatTile theme={theme} label="Notional" value={cohort ? formatUsd(notional) : "—"} />
          <StatTile
            theme={theme}
            label="Avg leverage"
            value={leverage > 0 ? `${leverage.toFixed(2)}x` : "—"}
            hint="notional ÷ margin"
            valueClass={signTextClass(0)}
          />
        </div>

        {cohort && (
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2`}>
            <div className={`p-2 rounded border ${theme.border}`}>
              <LongShortBar
                theme={theme}
                longUsd={cohort.longUsd}
                shortUsd={cohort.shortUsd}
                longPct={cohort.longPct}
                formatValue={formatUsd}
                label={`Notional · ${COHORT_LABELS[spec.cohort]}`}
              />
            </div>
            <div className={`p-2 rounded border ${theme.border}`}>
              <LongShortBar
                theme={theme}
                longUsd={cohort.longMarginUsed}
                shortUsd={cohort.shortMarginUsed}
                longPct={marginTotal > 0 ? cohort.longMarginUsed / marginTotal : 0}
                formatValue={formatUsd}
                label={`Margin · ${COHORT_LABELS[spec.cohort]}`}
              />
            </div>
          </div>
        )}

        <div className={`rounded border ${theme.border} p-2`}>
          <div className={`text-[10px] mb-1 ${theme.secondaryText}`}>
            {CHART_LABELS[metric]} · since server start
          </div>
          <LineChart
            series={series}
            height={130}
            gridColor={theme.gridLine}
            textColor={axisText}
            formatValue={v => formatUsd(v)}
            emptyLabel="Collecting samples…"
          />
        </div>
      </div>
    </PanelShell>
  );
}
