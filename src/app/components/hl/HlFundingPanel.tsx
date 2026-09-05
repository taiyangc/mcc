"use client";
// Panel 2d: funding across Hyperliquid, Binance, Bybit and OKX.
//
// Venues settle on different schedules (Hyperliquid hourly, most CEXes every 8h, some
// Binance alts every 4h), so raw rates are not comparable. The table leads with the
// annualized rate and keeps the raw per-interval rate beside it.

import { useMemo, useState } from "react";
import { usePolledJson } from "./usePolledJson";
import { panelTheme, signTextClass } from "./panelTheme";
import { PanelMessage, PanelShell } from "./PanelChrome";
import CoinPicker from "./CoinPicker";
import Sparkline from "../charts/Sparkline";
import { useSystemTheme } from "../../lib/useSystemTheme";
import { useNow } from "./useNow";
import { formatCountdown, formatRatePct } from "../../lib/format";
import { VENUES, VENUE_LABELS, nextFundingAfter } from "../../lib/hl/funding";
import type { Venue, VenueFunding } from "../../lib/hl/funding";
import type { HlFundingSpec } from "../../lib/hl/panels";
import type { PerpStats } from "../../lib/hl/perpStats";
import type { FundingResponse, HistoryWindow } from "../../lib/hl/fundingData";

interface Props {
  spec: HlFundingSpec;
  refreshKey: number;
  height: number;
  onSpecChange: (spec: HlFundingSpec) => void;
}

function VenueCell({
  data,
  theme,
  now,
}: {
  data: VenueFunding | null | undefined;
  theme: ReturnType<typeof panelTheme>;
  now: number;
}) {
  if (!data) {
    return <span className={`text-[10px] ${theme.secondaryText}`}>not listed</span>;
  }
  const history = data.history ?? [];
  const nextFunding = nextFundingAfter(data.nextFundingTime, data.intervalHours, now);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`text-[11px] font-semibold tabular-nums ${signTextClass(data.apr)}`}>
        {formatRatePct(data.apr, 2)}
      </span>
      <span className={`text-[9px] tabular-nums ${theme.secondaryText}`}>
        {formatRatePct(data.rate, 4)} / {data.intervalHours}h
      </span>
      <div className="flex items-center gap-1">
        {history.length > 1 && (
          <Sparkline
            points={history.map(p => ({ t: p.t, v: p.rate }))}
            color={data.apr >= 0 ? "#10b981" : "#f43f5e"}
            zeroLine
            zeroColor={theme.gridLine}
            width={54}
            height={16}
          />
        )}
        {nextFunding && (
          <span
            className={`text-[9px] tabular-nums ${theme.secondaryText}`}
            title="Time until the next funding settlement"
          >
            {formatCountdown(nextFunding, now)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function HlFundingPanel({ spec, refreshKey, height, onSpecChange }: Props) {
  const theme = panelTheme(useSystemTheme());
  const [window, setWindow] = useState<HistoryWindow>("24h");
  // The next-funding countdown needs its own second hand; it is display-only and does
  // not trigger a fetch.
  const now = useNow(1000);

  const url = `/api/hyperliquid/funding?coins=${encodeURIComponent(spec.coins.join(","))}&window=${window}`;
  const funding = usePolledJson<FundingResponse>(url, refreshKey);
  const stats = usePolledJson<PerpStats>("/api/hyperliquid/perp-stats", refreshKey);

  const suggestions = useMemo(
    () => (stats.data?.coins ?? []).slice(0, 20).map(c => c.coin),
    [stats.data],
  );

  if (funding.loading && !funding.data) {
    return (
      <PanelMessage theme={theme} height={height}>
        Loading funding rates…
      </PanelMessage>
    );
  }

  if (!funding.data) {
    return (
      <PanelMessage theme={theme} height={height} tone="error">
        {funding.error || "No funding data available"}
      </PanelMessage>
    );
  }

  const unlisted = funding.data.coins.flatMap(coin =>
    VENUES.filter(v => !coin.venues[v]).map(v => `${coin.coin} on ${VENUE_LABELS[v]}`),
  );

  const controls = (
    <>
      <CoinPicker
        theme={theme}
        selected={spec.coins}
        suggestions={suggestions}
        onChange={coins => onSpecChange({ kind: "funding", coins })}
      />
      <label className={`flex items-center gap-1 text-[10px] ${theme.secondaryText}`}>
        History
        <select
          value={window}
          onChange={e => setWindow(e.target.value === "7d" ? "7d" : "24h")}
          className={theme.select}
        >
          <option value="24h">24h</option>
          <option value="7d">7d</option>
        </select>
      </label>
    </>
  );

  return (
    <PanelShell
      title="Funding Rates"
      subtitle="annualized"
      controls={controls}
      theme={theme}
      height={height}
      footer={
        <span>
          Rates shown annualized; raw rate and settlement interval beneath.
          {unlisted.length > 0 ? ` Not listed: ${unlisted.slice(0, 4).join(", ")}${unlisted.length > 4 ? "…" : ""}.` : ""}
        </span>
      }
    >
      <div
        className={`grid grid-cols-[0.6fr_repeat(4,1fr)] px-3 py-1 text-[9px] font-medium uppercase tracking-wider ${theme.secondaryText} border-b ${theme.border} sticky top-0 ${theme.headerBg}`}
      >
        <span>Market</span>
        {VENUES.map(v => (
          <span key={v} className="text-right">
            {VENUE_LABELS[v]}
          </span>
        ))}
      </div>
      {funding.data.coins.map((coin, idx) => (
        <div
          key={coin.coin}
          className={`grid grid-cols-[0.6fr_repeat(4,1fr)] px-3 py-1.5 items-start ${
            idx % 2 === 0 ? theme.rowEvenBg : ""
          } ${theme.rowHoverBg}`}
        >
          <span className="text-[12px] font-semibold self-center">{coin.coin}</span>
          {VENUES.map(v => (
            <div key={v} className="flex justify-end">
              <VenueCell data={coin.venues[v as Venue]} theme={theme} now={now} />
            </div>
          ))}
        </div>
      ))}
    </PanelShell>
  );
}
