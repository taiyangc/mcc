"use client";
// Panel 2c: whale activity. Everything here comes from the tracked-trader job, which
// re-reads each member's positions every minute and diffs consecutive passes: what
// moved, what was opened or closed outright, and what the largest books look like now.

import { useMemo, useState } from "react";
import { usePolledJson } from "./usePolledJson";
import {
  panelTheme,
  sideTextClass,
  signTextClass,
  sizeRowClass,
  sizeTier,
  sizeTierLabel,
  sizeValueClass,
  sizeWeightClass,
} from "./panelTheme";
import { PanelMessage, PanelShell } from "./PanelChrome";
import CoinPicker from "./CoinPicker";
import { useSystemTheme } from "../../lib/useSystemTheme";
import { useNow } from "./useNow";
import { formatAge, formatClock, formatUsd, truncateAddress } from "../../lib/format";
import { WHALE_MIN_USD_CHOICES } from "../../lib/hl/panels";
import type { HlWhalesSpec } from "../../lib/hl/panels";
import type { PositionChange, PositionChangeKind } from "../../lib/hl/aggregate";
import type { PerpStats } from "../../lib/hl/perpStats";
import type { WhaleSnapshot } from "../../lib/hl/whaleCohort";

interface Props {
  spec: HlWhalesSpec;
  refreshKey: number;
  height: number;
  onSpecChange: (spec: HlWhalesSpec) => void;
}

type Tab = "all" | "new" | "top";

const TAB_LABELS: Record<Tab, string> = {
  all: "all positions",
  new: "new positions",
  top: "top positions",
};

/** A flip closes a position and opens the opposite one, so it belongs with both. */
const NEW_POSITION_KINDS: PositionChangeKind[] = ["open", "close", "flip"];

/** How many markets the picker offers and accepts. */
const MAX_COINS = 20;

/** Two missed cycles: past that the cohort is stale rather than merely between passes. */
const STALE_AFTER_MS = 150_000;

/**
 * How far a single account may lag the snapshot it appears in before it is worth
 * flagging. The cohort is read in one pass, so almost every row carries the snapshot's
 * own timestamp — a column of it would say the same thing a hundred times over. Only an
 * account a cycle failed to reach has anything to report, and only that one is marked.
 */
const ROW_STALE_AFTER_MS = 90_000;

const EXPLORER = "https://hypurrscan.io/address/";

const CHANGE_COLUMNS = "grid-cols-[0.55fr_0.5fr_0.5fr_0.6fr_0.8fr_0.8fr_0.75fr]";
const POSITION_COLUMNS = "grid-cols-[0.5fr_0.45fr_0.75fr_0.7fr_0.7fr_0.55fr_0.75fr]";

export default function HlWhaleFeedPanel({ spec, refreshKey, height, onSpecChange }: Props) {
  const theme = panelTheme(useSystemTheme());
  const [tab, setTab] = useState<Tab>("all");
  const now = useNow(5000);

  const stats = usePolledJson<PerpStats>("/api/hyperliquid/perp-stats", refreshKey);
  const whales = usePolledJson<WhaleSnapshot>("/api/hyperliquid/whales", refreshKey);

  const topCoins = useMemo(
    () => (stats.data?.coins ?? []).slice(0, MAX_COINS).map(c => c.coin),
    [stats.data],
  );

  // Filtered on magnitude, not on the signed delta: a flip moves almost no net notional
  // and would otherwise disappear at every threshold.
  const changes = useMemo(
    () =>
      (whales.data?.changes ?? []).filter(
        c => c.magnitude >= spec.minUsd && (!spec.coins || spec.coins.includes(c.coin)),
      ),
    [whales.data, spec.minUsd, spec.coins],
  );

  const newPositions = useMemo(
    () => changes.filter(c => NEW_POSITION_KINDS.includes(c.kind)),
    [changes],
  );

  const positions = useMemo(
    () =>
      (whales.data?.positions ?? []).filter(
        p => !spec.coins || spec.coins.includes(p.coin),
      ),
    [whales.data, spec.coins],
  );

  if (whales.loading && !whales.data) {
    return (
      <PanelMessage theme={theme} height={height}>
        Connecting to Hyperliquid…
      </PanelMessage>
    );
  }

  const snapshotAt = whales.data?.updatedAt ?? 0;
  const stale = whales.data ? now - snapshotAt > STALE_AFTER_MS : false;

  const controls = (
    <>
      <div className={`flex rounded overflow-hidden border ${theme.border}`}>
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
              tab === t ? theme.tabActive : theme.tabIdle
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <label className={`flex items-center gap-1 text-[10px] ${theme.secondaryText}`}>
        Min
        <select
          value={spec.minUsd}
          onChange={e => onSpecChange({ ...spec, minUsd: Number(e.target.value) })}
          className={theme.select}
        >
          {WHALE_MIN_USD_CHOICES.map(v => (
            <option key={v} value={v}>
              {formatUsd(v)}
            </option>
          ))}
        </select>
      </label>
      <CoinPicker
        theme={theme}
        selected={spec.coins ?? []}
        suggestions={topCoins}
        max={MAX_COINS}
        emptyLabel="All markets"
        onChange={next => onSpecChange({ ...spec, coins: next.length > 0 ? next : null })}
      />
      {spec.coins && (
        <button
          type="button"
          onClick={() => onSpecChange({ ...spec, coins: null })}
          className={theme.select}
          title="Stop filtering by market"
        >
          All markets
        </button>
      )}
    </>
  );

  /** Both change tabs are the same table; only which rows reach it differs. */
  const changeTable = (rows: PositionChange[], emptyLabel: string) => (
    <>
      <div
        className={`grid ${CHANGE_COLUMNS} px-3 py-1 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText} border-b ${theme.border} sticky top-0 ${theme.headerBg}`}
      >
        <span>Time</span>
        <span>Market</span>
        <span>Side</span>
        <span>Action</span>
        <span className="text-right">Change</span>
        <span className="text-right">Position</span>
        <span className="text-right">Trader</span>
      </div>
      {rows.length === 0 ? (
        <div className={`flex items-center justify-center py-10 text-sm ${theme.secondaryText}`}>
          {whales.data?.warming
            ? "Building the tracked cohort…"
            : `${emptyLabel} above ${formatUsd(spec.minUsd)} yet.`}
        </div>
      ) : (
        rows.map((change, idx) => {
          const tier = sizeTier(change.magnitude);
          const isLong = change.side === "long";
          return (
            <div
              key={`${change.user}-${change.coin}-${change.t}-${idx}`}
              className={`grid ${CHANGE_COLUMNS} px-3 py-1 text-[11px] tabular-nums ${
                tier === 0 && idx % 2 === 0 ? theme.rowEvenBg : ""
              } ${sizeRowClass(isLong, tier)} ${theme.rowHoverBg}`}
            >
              <span className={theme.secondaryText}>{formatClock(change.t)}</span>
              <span className="font-medium">{change.coin}</span>
              <span className={sideTextClass(isLong)}>{change.side.toUpperCase()}</span>
              <span className={theme.secondaryText}>{change.kind}</span>
              <span
                className={`text-right ${signTextClass(change.deltaUsd)} ${sizeWeightClass(tier)}`}
                title={sizeTierLabel(tier)}
              >
                {formatUsd(change.deltaUsd, { sign: true })}
              </span>
              <span className="text-right">{formatUsd(change.positionValue)}</span>
              <span className="text-right truncate">
                <a
                  href={`${EXPLORER}${change.user}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  title={change.tags.join(", ")}
                >
                  {truncateAddress(change.user)}
                </a>
              </span>
            </div>
          );
        })
      )}
    </>
  );

  return (
    <PanelShell
      title="Hyperliquid Whale Activity"
      subtitle={
        whales.data ? (
          <span className={stale ? "text-amber-500" : "text-emerald-500"}>
            {formatAge(whales.data.updatedAt, now)} · {whales.data.cohortSize} traders
          </span>
        ) : undefined
      }
      controls={controls}
      theme={theme}
      height={height}
      footer={
        whales.data?.lastError ? (
          <span>Cohort refresh failing: {whales.data.lastError}</span>
        ) : (
          <span>
            {tab === "top"
              ? "The largest books held by the tracked traders."
              : "Every position the tracked traders move, found by re-reading them each minute."}
            {" "}Sizes are notional, and an open or close is measured by the position itself.
          </span>
        )
      }
    >
      {tab === "all" && changeTable(changes, "No position changes")}
      {tab === "new" && changeTable(newPositions, "No positions opened or closed")}

      {tab === "top" && (
        <>
          <div
            className={`grid ${POSITION_COLUMNS} px-3 py-1 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText} border-b ${theme.border} sticky top-0 ${theme.headerBg}`}
          >
            <span>Market</span>
            <span>Side</span>
            <span className="text-right">Notional</span>
            <span className="text-right">Entry</span>
            <span className="text-right">uPnL</span>
            <span className="text-right">Lev</span>
            <span className="text-right">Trader</span>
          </div>
          {positions.length === 0 ? (
            <div className={`flex items-center justify-center py-10 text-sm ${theme.secondaryText}`}>
              {whales.data?.warming ? "Building the tracked cohort…" : "No positions to show."}
            </div>
          ) : (
            positions.map((position, idx) => {
              const tier = sizeTier(position.positionValue);
              const isLong = position.side === "long";
              const lagging = snapshotAt - position.updatedAt >= ROW_STALE_AFTER_MS;
              return (
                <div
                  key={`${position.user}-${position.coin}`}
                  className={`grid ${POSITION_COLUMNS} px-3 py-1 text-[11px] tabular-nums ${
                    tier === 0 && idx % 2 === 0 ? theme.rowEvenBg : ""
                  } ${sizeRowClass(isLong, tier)} ${theme.rowHoverBg}`}
                >
                  <span className="font-medium">{position.coin}</span>
                  <span className={sideTextClass(isLong)}>{position.side.toUpperCase()}</span>
                  <span
                    className={`text-right ${sizeValueClass(isLong, tier)}`}
                    title={sizeTierLabel(tier)}
                  >
                    {formatUsd(Math.abs(position.positionValue))}
                  </span>
                  <span className="text-right">
                    {position.entryPx ? position.entryPx.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}
                  </span>
                  <span className={`text-right ${signTextClass(position.unrealizedPnl)}`}>
                    {formatUsd(position.unrealizedPnl, { sign: true })}
                  </span>
                  <span className="text-right">{position.leverage ? `${position.leverage}x` : "—"}</span>
                  <span className="text-right truncate">
                    {lagging && (
                      <span
                        className="text-amber-500 mr-1"
                        title={`A later pass could not reach this trader; read ${formatAge(position.updatedAt, now)}`}
                      >
                        •
                      </span>
                    )}
                    <a
                      href={`${EXPLORER}${position.user}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      title={position.tags.length > 0 ? position.tags.join(", ") : undefined}
                    >
                      {truncateAddress(position.user)}
                    </a>
                  </span>
                </div>
              );
            })
          )}
        </>
      )}
    </PanelShell>
  );
}
