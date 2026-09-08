"use client";
// One row per market, carrying everything that describes it: size, funding on every
// venue, and how tracked traders are positioned. Funding and positioning belong in the
// same row because they are read together — funding is what positioning costs.

import { useMemo, useState } from "react";
import { usePolledJson } from "./usePolledJson";
import { panelTheme, signTextClass } from "./panelTheme";
import type { PanelSource } from "./panelTheme";
import { PanelMessage, PanelShell, SourceBadge } from "./PanelChrome";
import CoinPicker from "./CoinPicker";
import Sparkline from "../charts/Sparkline";
import { useSystemTheme } from "../../lib/useSystemTheme";
import { useNow } from "./useNow";
import { formatAge, formatCountdown, formatRatePct, formatUsd } from "../../lib/format";
import { VENUES, VENUE_LABELS, nextFundingAfter } from "../../lib/hl/funding";
import type { Venue, VenueFunding } from "../../lib/hl/funding";
import {
  COHORT_LABELS,
  EXCHANGE_SOURCE_BADGE,
  EXCHANGE_SOURCE_TITLE,
  TOP_MARKETS_LIMIT,
  cohortSourceBadge,
  cohortSourceTitle,
} from "../../lib/hl/panels";
import type { HlCohort, HlMarketsSpec } from "../../lib/hl/panels";
import type { CoinStat, PerpStats } from "../../lib/hl/perpStats";
import type { WhaleSnapshot } from "../../lib/hl/whaleCohort";
import type { CoinSplit } from "../../lib/hl/aggregate";
import type { FundingResponse } from "../../lib/hl/fundingData";

interface Props {
  spec: HlMarketsSpec;
  refreshKey: number;
  height: number;
  onSpecChange: (spec: HlMarketsSpec) => void;
}

const COHORTS: HlCohort[] = ["ALL", "PNL", "VOL", "WHALE"];

type SortKey = "coin" | "oi" | "funding" | "long";

interface MarketRow {
  coin: string;
  stat: CoinStat | null;
  venues: Partial<Record<Venue, VenueFunding | null>>;
  split: CoinSplit | null;
}

const GRID =
  "grid grid-cols-[minmax(52px,0.5fr)_minmax(72px,0.62fr)_repeat(4,minmax(66px,0.6fr))_minmax(120px,1.05fr)_minmax(70px,0.6fr)_minmax(70px,0.6fr)_minmax(64px,0.5fr)]";

function FundingValue({
  data,
  now,
  muted,
  showSpark,
}: {
  data: VenueFunding | null | undefined;
  now: number;
  muted: string;
  showSpark: boolean;
}) {
  if (!data) return <span className={`text-[10px] ${muted}`}>—</span>;
  const next = nextFundingAfter(data.nextFundingTime, data.intervalHours, now);
  const history = data.history ?? [];
  return (
    <span
      className="flex flex-col items-end leading-tight"
      title={`${formatRatePct(data.rate, 4)} every ${data.intervalHours}h${
        next ? ` · next in ${formatCountdown(next, now)}` : ""
      }`}
    >
      <span className={`text-[11px] font-semibold tabular-nums ${signTextClass(data.apr)}`}>
        {formatRatePct(data.apr, 2)}
      </span>
      {showSpark && history.length > 1 ? (
        <Sparkline
          points={history.map(p => ({ t: p.t, v: p.rate }))}
          color={data.apr >= 0 ? "#10b981" : "#f43f5e"}
          zeroLine
          width={48}
          height={12}
        />
      ) : (
        <span className={`text-[9px] tabular-nums ${muted}`}>{data.intervalHours}h</span>
      )}
    </span>
  );
}

export default function HlMarketsPanel({ spec, refreshKey, height, onSpecChange }: Props) {
  const theme = panelTheme(useSystemTheme());
  const now = useNow(1000);
  const [sortKey, setSortKey] = useState<SortKey>("oi");
  const [sortDesc, setSortDesc] = useState(true);

  const stats = usePolledJson<PerpStats>("/api/hyperliquid/perp-stats", refreshKey);
  const whales = usePolledJson<WhaleSnapshot>("/api/hyperliquid/whales", refreshKey);

  const topCoins = useMemo(
    () => (stats.data?.coins ?? []).slice(0, TOP_MARKETS_LIMIT).map(c => c.coin),
    [stats.data],
  );

  // "TOP" follows the largest markets; an explicit list is honoured as-is. Funding costs
  // one upstream call per market, so the automatic list stays short.
  const coins = spec.coins ?? topCoins;
  const coinsKey = coins.join(",");

  const funding = usePolledJson<FundingResponse>(
    coinsKey ? `/api/hyperliquid/funding?coins=${encodeURIComponent(coinsKey)}&window=24h` : null,
    refreshKey,
  );

  const cohort = whales.data?.cohorts?.[spec.cohort] ?? null;

  const rows = useMemo<MarketRow[]>(() => {
    const statByCoin = new Map((stats.data?.coins ?? []).map(c => [c.coin, c]));
    const fundingByCoin = new Map((funding.data?.coins ?? []).map(c => [c.coin, c.venues]));
    const splitByCoin = new Map((cohort?.perCoin ?? []).map(c => [c.coin, c]));
    const built = coins.map(coin => ({
      coin,
      stat: statByCoin.get(coin) ?? null,
      venues: fundingByCoin.get(coin) ?? {},
      split: splitByCoin.get(coin) ?? null,
    }));

    const value = (row: MarketRow): number => {
      switch (sortKey) {
        case "oi":
          return row.stat?.oiUsd ?? -1;
        case "funding":
          return row.venues.HL?.apr ?? Number.NEGATIVE_INFINITY;
        case "long":
          return row.split ? row.split.longPct : -1;
        case "coin":
          return 0;
      }
    };

    return built.sort((a, b) => {
      if (sortKey === "coin") {
        return sortDesc ? b.coin.localeCompare(a.coin) : a.coin.localeCompare(b.coin);
      }
      const diff = value(b) - value(a);
      return sortDesc ? diff : -diff;
    });
  }, [coins, stats.data, funding.data, cohort, sortKey, sortDesc]);

  if (stats.loading && !stats.data && !funding.data) {
    return (
      <PanelMessage theme={theme} height={height}>
        Loading markets…
      </PanelMessage>
    );
  }

  if (!stats.data && !funding.data && !whales.data) {
    return (
      <PanelMessage theme={theme} height={height} tone="error">
        {stats.error || funding.error || whales.error || "No market data available"}
      </PanelMessage>
    );
  }

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc(v => !v);
    else {
      setSortKey(key);
      setSortDesc(key !== "coin");
    }
  };

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDesc ? " ▾" : " ▴") : "");

  const unlisted = (funding.data?.coins ?? []).flatMap(coin =>
    VENUES.filter(v => !coin.venues[v]).map(v => `${coin.coin} on ${VENUE_LABELS[v]}`),
  );

  /**
   * Six columns of whole-market figures, then four inferred from a few hundred sampled
   * accounts — a split a reader cannot see, since both halves are just numbers in a row.
   * The band above the header names the population of each. Which venue quotes a funding
   * rate is left to the column headers, which already say Binance, Bybit and OKX; the
   * badge answers the one question the table cannot, how many accounts are behind a
   * number. The spans must keep adding up to the ten columns of GRID, and the second
   * group opens with a rule because a badge alone floats in the gap between two
   * right-aligned columns and could belong to either.
   */
  const sourceGroups = [
    {
      span: "col-span-6",
      source: "all" as PanelSource,
      label: EXCHANGE_SOURCE_BADGE,
      title: EXCHANGE_SOURCE_TITLE,
    },
    {
      span: `col-span-4 border-l pl-1.5 ${theme.border}`,
      source: "cohort" as PanelSource,
      label: cohortSourceBadge(cohort?.n ?? 0),
      title: cohortSourceTitle(cohort?.n ?? 0),
    },
  ];

  const controls = (
    <>
      <CoinPicker
        theme={theme}
        selected={spec.coins ?? []}
        suggestions={topCoins}
        emptyLabel={`Top ${TOP_MARKETS_LIMIT}`}
        onChange={next => onSpecChange({ ...spec, coins: next.length > 0 ? next : null })}
      />
      <label className={`flex items-center gap-1 text-[10px] ${theme.secondaryText}`}>
        Cohort
        <select
          value={spec.cohort}
          onChange={e => onSpecChange({ ...spec, cohort: e.target.value as HlCohort })}
          className={theme.select}
          title="Which tracked traders the long/short columns cover"
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

  return (
    <PanelShell
      title="Markets"
      subtitle={
        whales.data
          ? `funding · positioning · ${formatAge(whales.data.updatedAt, now)}`
          : "funding · positioning"
      }
      controls={controls}
      theme={theme}
      height={height}
      help={
        "Open interest and HL funding are Hyperliquid's own figures; Binance, Bybit and OKX quote their own." +
        " Funding is annualized — hover a rate for its raw value and next settlement." +
        ` Long/short is inferred from the ${cohort?.nWithPositions ?? 0} sampled traders holding a position, not from the whole exchange.` +
        (unlisted.length > 0
          ? ` Not listed: ${unlisted.slice(0, 3).join(", ")}${unlisted.length > 3 ? "…" : ""}.`
          : "")
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className={`sticky top-0 z-10 border-b ${theme.border} ${theme.headerBg}`}>
            <div className={`${GRID} px-3 pt-1`}>
              {sourceGroups.map(group => (
                <span key={group.source} className={`${group.span} flex items-center`}>
                  <SourceBadge
                    source={group.source}
                    label={group.label}
                    title={group.title}
                  />
                </span>
              ))}
            </div>
            <div
              className={`${GRID} px-3 pb-1 pt-0.5 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText}`}
            >
              <button type="button" className="text-left hover:underline" onClick={() => toggleSort("coin")}>
                Market{sortArrow("coin")}
              </button>
              <button type="button" className="text-right hover:underline" onClick={() => toggleSort("oi")}>
                Open int.{sortArrow("oi")}
              </button>
              <button
                type="button"
                className="text-right hover:underline"
                onClick={() => toggleSort("funding")}
                title="Annualized funding on Hyperliquid"
              >
                HL fund{sortArrow("funding")}
              </button>
              <span className="text-right">Binance</span>
              <span className="text-right">Bybit</span>
              <span className="text-right">OKX</span>
              <button type="button" className="text-left hover:underline pl-2" onClick={() => toggleSort("long")}>
                Long / short{sortArrow("long")}
              </button>
              <span className="text-right">Long</span>
              <span className="text-right">Short</span>
              <span className="text-right">Traders</span>
            </div>
          </div>

          {rows.map((row, idx) => {
            const pct = row.split ? row.split.longPct * 100 : 0;
            return (
              <div
                key={row.coin}
                className={`${GRID} px-3 py-1.5 items-center ${
                  idx % 2 === 0 ? theme.rowEvenBg : ""
                } ${theme.rowHoverBg}`}
              >
                <span className="text-[12px] font-semibold">{row.coin}</span>
                <span className="text-right text-[11px] tabular-nums">
                  {row.stat ? formatUsd(row.stat.oiUsd) : "—"}
                </span>
                <span className="flex justify-end">
                  <FundingValue data={row.venues.HL} now={now} muted={theme.secondaryText} showSpark />
                </span>
                <span className="flex justify-end">
                  <FundingValue data={row.venues.BINANCE} now={now} muted={theme.secondaryText} showSpark={false} />
                </span>
                <span className="flex justify-end">
                  <FundingValue data={row.venues.BYBIT} now={now} muted={theme.secondaryText} showSpark={false} />
                </span>
                <span className="flex justify-end">
                  <FundingValue data={row.venues.OKX} now={now} muted={theme.secondaryText} showSpark={false} />
                </span>
                <div className="pl-2 pr-3">
                  {row.split ? (
                    <>
                      <div className={`h-2 w-full rounded-full overflow-hidden flex ${theme.headerBg}`}>
                        <div className="bg-emerald-500 h-full" style={{ width: `${pct}%` }} />
                        <div className="bg-rose-500 h-full" style={{ width: `${100 - pct}%` }} />
                      </div>
                      <div className="flex justify-between text-[9px] mt-0.5 tabular-nums">
                        <span className="text-emerald-500">{pct.toFixed(1)}%</span>
                        <span className="text-rose-500">{(100 - pct).toFixed(1)}%</span>
                      </div>
                    </>
                  ) : (
                    <span className={`text-[10px] ${theme.secondaryText}`}>no tracked positions</span>
                  )}
                </div>
                <span className="text-right text-[11px] tabular-nums text-emerald-500">
                  {row.split ? formatUsd(row.split.longUsd) : "—"}
                </span>
                <span className="text-right text-[11px] tabular-nums text-rose-500">
                  {row.split ? formatUsd(row.split.shortUsd) : "—"}
                </span>
                <span className={`text-right text-[10px] tabular-nums ${theme.secondaryText}`}>
                  {row.split ? `${row.split.nLong}L / ${row.split.nShort}S` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </PanelShell>
  );
}
