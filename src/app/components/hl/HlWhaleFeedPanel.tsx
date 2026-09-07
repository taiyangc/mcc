"use client";
// Panel 2c: live whale activity. Orders stream over the shared websocket; position
// changes and the biggest open positions come from the tracked-cohort job.

import { useMemo, useState } from "react";
import { usePolledJson } from "./usePolledJson";
import { useHlTrades } from "./hlWebSocket";
import { panelTheme, sideTextClass, signTextClass } from "./panelTheme";
import { PanelMessage, PanelShell } from "./PanelChrome";
import CoinPicker from "./CoinPicker";
import { useSystemTheme } from "../../lib/useSystemTheme";
import { useNow } from "./useNow";
import { formatAge, formatClock, formatUsd, truncateAddress } from "../../lib/format";
import { WHALE_MIN_USD_CHOICES } from "../../lib/hl/panels";
import type { HlWhalesSpec } from "../../lib/hl/panels";
import type { PerpStats } from "../../lib/hl/perpStats";
import type { WhaleSnapshot } from "../../lib/hl/whaleCohort";

interface Props {
  spec: HlWhalesSpec;
  refreshKey: number;
  height: number;
  onSpecChange: (spec: HlWhalesSpec) => void;
}

type Tab = "trades" | "changes" | "positions";

/** Hyperliquid caps websocket subscriptions per connection; stay well under it. */
const MAX_SUBSCRIPTIONS = 20;

const EXPLORER = "https://hypurrscan.io/address/";

export default function HlWhaleFeedPanel({ spec, refreshKey, height, onSpecChange }: Props) {
  const theme = panelTheme(useSystemTheme());
  const [tab, setTab] = useState<Tab>("trades");
  const now = useNow(5000);

  const stats = usePolledJson<PerpStats>("/api/hyperliquid/perp-stats", refreshKey);
  const whales = usePolledJson<WhaleSnapshot>("/api/hyperliquid/whales", refreshKey);

  const topCoins = useMemo(
    () => (stats.data?.coins ?? []).slice(0, MAX_SUBSCRIPTIONS).map(c => c.coin),
    [stats.data],
  );

  // "TOP" follows the biggest markets automatically; an explicit list is honoured as-is.
  const coins = useMemo(() => {
    if (spec.coins) return spec.coins.slice(0, MAX_SUBSCRIPTIONS);
    return topCoins;
  }, [spec.coins, topCoins]);

  const { trades, status, seen, largestUsd } = useHlTrades(coins, spec.minUsd);

  const changes = useMemo(
    () =>
      (whales.data?.changes ?? []).filter(
        c => Math.abs(c.deltaUsd) >= spec.minUsd && (!spec.coins || spec.coins.includes(c.coin)),
      ),
    [whales.data, spec.minUsd, spec.coins],
  );

  const positions = useMemo(
    () =>
      (whales.data?.positions ?? []).filter(
        p => !spec.coins || spec.coins.includes(p.coin),
      ),
    [whales.data, spec.coins],
  );

  if (stats.loading && !stats.data && !whales.data) {
    return (
      <PanelMessage theme={theme} height={height}>
        Connecting to Hyperliquid…
      </PanelMessage>
    );
  }

  const statusLabel =
    status === "open" ? "live" : status === "connecting" ? "connecting…" : "reconnecting…";
  const statusColor =
    status === "open" ? "text-emerald-500" : status === "connecting" ? "text-amber-500" : "text-rose-500";

  const controls = (
    <>
      <div className={`flex rounded overflow-hidden border ${theme.border}`}>
        {(["trades", "changes", "positions"] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
              tab === t ? theme.tabActive : theme.tabIdle
            }`}
          >
            {t === "changes" ? "position changes" : t}
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
        max={MAX_SUBSCRIPTIONS}
        emptyLabel="Top markets"
        onChange={next => onSpecChange({ ...spec, coins: next.length > 0 ? next : null })}
      />
      {spec.coins && (
        <button
          type="button"
          onClick={() => onSpecChange({ ...spec, coins: null })}
          className={theme.select}
          title="Follow the largest markets automatically"
        >
          Top markets
        </button>
      )}
    </>
  );

  return (
    <PanelShell
      title="Hyperliquid Whale Activity"
      subtitle={
        <span className={statusColor}>
          {statusLabel} · {coins.length} market{coins.length === 1 ? "" : "s"}
        </span>
      }
      controls={controls}
      theme={theme}
      height={height}
      footer={
        whales.data?.lastError ? (
          <span>Cohort refresh failing: {whales.data.lastError}</span>
        ) : (
          <span>
            Fills stream live from Hyperliquid, grouped into the order that caused them.
            Position data covers{" "}
            {whales.data?.cohortSize ?? 0} tracked traders
            {whales.data ? `, ${formatAge(whales.data.updatedAt, now)}` : ""}.
          </span>
        )
      }
    >
      {tab === "trades" && (
        <>
          <div
            className={`grid grid-cols-[0.55fr_0.5fr_0.45fr_0.8fr_0.8fr_0.4fr_0.8fr] px-3 py-1 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText} border-b ${theme.border} sticky top-0 ${theme.headerBg}`}
          >
            <span>Time</span>
            <span>Market</span>
            <span>Side</span>
            <span className="text-right">Notional</span>
            <span className="text-right">Price</span>
            <span className="text-right">Fills</span>
            <span className="text-right">Taker</span>
          </div>
          {trades.length === 0 ? (
            <div className={`flex flex-col items-center justify-center py-10 text-sm gap-1 ${theme.secondaryText}`}>
              <span>Waiting for orders above {formatUsd(spec.minUsd)}…</span>
              <span className="text-[10px]">
                {seen > 0
                  ? `${seen.toLocaleString()} fills seen on ${coins.length} market${coins.length === 1 ? "" : "s"}` +
                    (largestUsd > 0 ? `, biggest order so far ${formatUsd(largestUsd)}` : "")
                  : "Connecting to the trade stream…"}
              </span>
            </div>
          ) : (
            trades.map((trade, idx) => (
              <div
                key={trade.id}
                className={`grid grid-cols-[0.55fr_0.5fr_0.45fr_0.8fr_0.8fr_0.4fr_0.8fr] px-3 py-1 text-[11px] tabular-nums ${
                  idx % 2 === 0 ? theme.rowEvenBg : ""
                } ${theme.rowHoverBg}`}
              >
                <span className={theme.secondaryText}>{formatClock(trade.time)}</span>
                <span className="font-medium">{trade.coin}</span>
                <span className={sideTextClass(trade.side === "buy")}>
                  {trade.side === "buy" ? "BUY" : "SELL"}
                </span>
                <span className="text-right font-medium">{formatUsd(trade.notionalUsd)}</span>
                <span
                  className="text-right"
                  title={trade.fills > 1 ? "Notional-weighted average fill price" : undefined}
                >
                  {trade.px.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </span>
                <span className={`text-right ${theme.secondaryText}`}>{trade.fills}</span>
                <span className="text-right truncate">
                  {trade.taker && (
                    <a
                      href={`${EXPLORER}${trade.taker}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      title={`Aggressor · ${trade.fills} fill${trade.fills === 1 ? "" : "s"}`}
                    >
                      {truncateAddress(trade.taker)}
                    </a>
                  )}
                </span>
              </div>
            ))
          )}
        </>
      )}

      {tab === "changes" && (
        <>
          <div
            className={`grid grid-cols-[0.5fr_0.55fr_0.7fr_0.8fr_0.8fr_0.75fr] px-3 py-1 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText} border-b ${theme.border} sticky top-0 ${theme.headerBg}`}
          >
            <span>Market</span>
            <span>Side</span>
            <span>Action</span>
            <span className="text-right">Change</span>
            <span className="text-right">Position</span>
            <span className="text-right">Trader</span>
          </div>
          {changes.length === 0 ? (
            <div className={`flex items-center justify-center py-10 text-sm ${theme.secondaryText}`}>
              No position changes above {formatUsd(spec.minUsd)} yet.
            </div>
          ) : (
            changes.map((change, idx) => (
              <div
                key={`${change.user}-${change.coin}-${change.t}-${idx}`}
                className={`grid grid-cols-[0.5fr_0.55fr_0.7fr_0.8fr_0.8fr_0.75fr] px-3 py-1 text-[11px] tabular-nums ${
                  idx % 2 === 0 ? theme.rowEvenBg : ""
                } ${theme.rowHoverBg}`}
              >
                <span className="font-medium">{change.coin}</span>
                <span className={sideTextClass(change.side === "long")}>
                  {change.side.toUpperCase()}
                </span>
                <span className={theme.secondaryText}>{change.kind}</span>
                <span className={`text-right font-medium ${signTextClass(change.deltaUsd)}`}>
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
            ))
          )}
        </>
      )}

      {tab === "positions" && (
        <>
          <div
            className={`grid grid-cols-[0.5fr_0.45fr_0.75fr_0.7fr_0.7fr_0.55fr_0.75fr] px-3 py-1 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText} border-b ${theme.border} sticky top-0 ${theme.headerBg}`}
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
            positions.map((position, idx) => (
              <div
                key={`${position.user}-${position.coin}`}
                className={`grid grid-cols-[0.5fr_0.45fr_0.75fr_0.7fr_0.7fr_0.55fr_0.75fr] px-3 py-1 text-[11px] tabular-nums ${
                  idx % 2 === 0 ? theme.rowEvenBg : ""
                } ${theme.rowHoverBg}`}
              >
                <span className="font-medium">{position.coin}</span>
                <span className={sideTextClass(position.side === "long")}>
                  {position.side.toUpperCase()}
                </span>
                <span className="text-right font-medium">
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
            ))
          )}
        </>
      )}
    </PanelShell>
  );
}
