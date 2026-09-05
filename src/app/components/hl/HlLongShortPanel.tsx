"use client";
// Panel 2e: per-market long/short split for the tracked cohorts.

import { useMemo } from "react";
import { usePolledJson } from "./usePolledJson";
import { panelTheme } from "./panelTheme";
import { PanelMessage, PanelShell } from "./PanelChrome";
import CoinPicker from "./CoinPicker";
import { useSystemTheme } from "../../lib/useSystemTheme";
import { useNow } from "./useNow";
import { formatAge, formatUsd } from "../../lib/format";
import { COHORT_LABELS } from "../../lib/hl/panels";
import type { HlCohort, HlLongShortSpec } from "../../lib/hl/panels";
import type { PerpStats } from "../../lib/hl/perpStats";
import type { WhaleSnapshot } from "../../lib/hl/whaleCohort";

interface Props {
  spec: HlLongShortSpec;
  refreshKey: number;
  height: number;
  onSpecChange: (spec: HlLongShortSpec) => void;
}

const COHORTS: HlCohort[] = ["ALL", "PNL", "VOL", "WHALE"];

export default function HlLongShortPanel({ spec, refreshKey, height, onSpecChange }: Props) {
  const theme = panelTheme(useSystemTheme());
  const now = useNow(5000);
  const whales = usePolledJson<WhaleSnapshot>("/api/hyperliquid/whales", refreshKey);
  const stats = usePolledJson<PerpStats>("/api/hyperliquid/perp-stats", refreshKey);

  const suggestions = useMemo(
    () => (stats.data?.coins ?? []).slice(0, 20).map(c => c.coin),
    [stats.data],
  );

  const cohort = whales.data?.cohorts?.[spec.cohort] ?? null;

  // Cohort aggregates arrive precomputed, so switching cohort or coins is instant.
  const rows = useMemo(() => {
    const byCoin = new Map((cohort?.perCoin ?? []).map(c => [c.coin, c]));
    return spec.coins.map(coin => ({
      coin,
      split: byCoin.get(coin) ?? null,
    }));
  }, [cohort, spec.coins]);

  if (whales.loading && !whales.data) {
    return (
      <PanelMessage theme={theme} height={height}>
        Loading trader positioning…
      </PanelMessage>
    );
  }

  if (!whales.data) {
    return (
      <PanelMessage theme={theme} height={height} tone="error">
        {whales.error || "No positioning data available"}
      </PanelMessage>
    );
  }

  const controls = (
    <>
      <label className={`flex items-center gap-1 text-[10px] ${theme.secondaryText}`}>
        Cohort
        <select
          value={spec.cohort}
          onChange={e => onSpecChange({ ...spec, cohort: e.target.value as HlCohort })}
          className={theme.select}
        >
          {COHORTS.map(c => (
            <option key={c} value={c}>
              {COHORT_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <CoinPicker
        theme={theme}
        selected={spec.coins}
        suggestions={suggestions}
        onChange={coins => onSpecChange({ ...spec, coins })}
      />
    </>
  );

  return (
    <PanelShell
      title="Trader Long / Short"
      subtitle={`${cohort?.n ?? 0} traders · ${formatAge(whales.data.updatedAt, now)}`}
      controls={controls}
      theme={theme}
      height={height}
      footer={
        whales.data.lastError ? (
          <span>Cohort refresh failing: {whales.data.lastError}</span>
        ) : (
          <span>
            {COHORT_LABELS[spec.cohort]}: positions of {cohort?.nWithPositions ?? 0} tracked
            traders. This is a sample of large accounts, not the whole exchange.
          </span>
        )
      }
    >
      <div
        className={`grid grid-cols-[0.5fr_1.5fr_0.75fr_0.75fr_0.55fr] px-3 py-1 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText} border-b ${theme.border} sticky top-0 ${theme.headerBg}`}
      >
        <span>Market</span>
        <span>Long / short</span>
        <span className="text-right">Long</span>
        <span className="text-right">Short</span>
        <span className="text-right">Traders</span>
      </div>
      {rows.map(({ coin, split }, idx) => {
        const pct = split ? split.longPct * 100 : 0;
        return (
          <div
            key={coin}
            className={`grid grid-cols-[0.5fr_1.5fr_0.75fr_0.75fr_0.55fr] px-3 py-2 items-center tabular-nums ${
              idx % 2 === 0 ? theme.rowEvenBg : ""
            } ${theme.rowHoverBg}`}
          >
            <span className="text-[12px] font-semibold">{coin}</span>
            <div className="pr-3">
              {split ? (
                <>
                  <div className={`h-2 w-full rounded-full overflow-hidden flex ${theme.headerBg}`}>
                    <div className="bg-emerald-500 h-full" style={{ width: `${pct}%` }} />
                    <div className="bg-rose-500 h-full" style={{ width: `${100 - pct}%` }} />
                  </div>
                  <div className="flex justify-between text-[9px] mt-0.5">
                    <span className="text-emerald-500">{pct.toFixed(1)}%</span>
                    <span className="text-rose-500">{(100 - pct).toFixed(1)}%</span>
                  </div>
                </>
              ) : (
                <span className={`text-[10px] ${theme.secondaryText}`}>no tracked positions</span>
              )}
            </div>
            <span className="text-right text-[11px] text-emerald-500">
              {split ? formatUsd(split.longUsd) : "—"}
            </span>
            <span className="text-right text-[11px] text-rose-500">
              {split ? formatUsd(split.shortUsd) : "—"}
            </span>
            <span className={`text-right text-[10px] ${theme.secondaryText}`}>
              {split ? `${split.nLong}L / ${split.nShort}S` : "—"}
            </span>
          </div>
        );
      })}
    </PanelShell>
  );
}
