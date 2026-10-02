import { getTrendFeed, getTrendPreset } from "./trends.ts";
import type { TrendQuote } from "./trends.ts";

interface Schedule {
  zone: string;
  open: number;
  close: number;
  overnight?: boolean;
  break?: [number, number];
  label?: string;
}

const NEW_YORK = "America/New_York";
const US_EQUITY: Schedule = { zone: NEW_YORK, open: 570, close: 960 };
const INDEX_HOURS: Record<string, Schedule> = {
  SPX: US_EQUITY, NDX: US_EQUITY, DJI: US_EQUITY, RUT: US_EQUITY,
  VIX: { zone: NEW_YORK, open: 570, close: 975 },
  DAX: { zone: "Europe/Berlin", open: 540, close: 1050 },
  FTSE: { zone: "Europe/London", open: 480, close: 990 },
  NIKKEI: { zone: "Asia/Tokyo", open: 540, close: 930, break: [690, 750] },
  HSI: { zone: "Asia/Hong_Kong", open: 570, close: 960, break: [720, 780] },
};

function scheduleFor(symbol: string): Schedule | undefined {
  const preset = getTrendPreset(symbol);
  if (!preset) return;
  if (preset.category === "Indices") return INDEX_HOURS[preset.label];
  // Treasury closure uses a global window plus feed activity below, so live
  // overseas quotes are not cut off at the end of US business hours.
  // These presets are full-size COMEX/NYMEX contracts, with a daily maintenance break.
  // https://www.cmegroup.com/trading-hours.html
  if (preset.category === "Commodities") return { zone: NEW_YORK, open: 1080, close: 1020, overnight: true };
  // Spot FX and the cash dollar index follow the FX week, not ICE DX futures hours.
  if (preset.category === "FX") return { zone: NEW_YORK, open: 1020, close: 1020, overnight: true };
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function localParts(time: number, zone: string) {
  let formatter = dateFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    dateFormatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(time).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
}

/** Convert an exchange wall-clock time using its IANA zone, including DST changes. */
function atLocalTime(day: number, minutes: number, zone: string): number {
  const wallTime = day + minutes * 60_000;
  let instant = wallTime;
  for (let i = 0; i < 3; i++) instant += wallTime - localParts(instant, zone);
  return instant;
}

const DAY = 86_400_000;

/** Last opened Tradeweb regional window: Tokyo 09:00 to New York 17:00. */
function treasuryWindow(time: number) {
  // https://www.tradeweb.com/our-markets/institutional/rates/government-bonds/
  const today = Math.floor(localParts(time, "Asia/Tokyo") / DAY) * DAY;
  for (let offset = 0; offset >= -7; offset--) {
    const day = today + offset * DAY;
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const open = atLocalTime(day, 540, "Asia/Tokyo");
    if (open > time) continue;
    return {
      open, close: atLocalTime(day, 1020, NEW_YORK), typical: true,
      label: "Tradeweb regional window (Tokyo open to New York close); quotes can update outside these hours",
    };
  }
  return null;
}

function scheduledSession(schedule: Schedule, now: number, selection: "currentOrNext" | "lastOpened" = "currentOrNext") {
  const wallTime = localParts(now, schedule.zone);
  const today = Math.floor(wallTime / DAY) * DAY;
  // Status uses the current/next session; displayed prices belong to the last
  // session that opened before their quote timestamp, even after it has closed.
  const offsets = selection === "lastOpened" ? [0, -1, -2, -3, -4, -5, -6, -7] : [-1, 0, 1, 2, 3, 4, 5, 6, 7];
  for (const offset of offsets) {
    const day = today + offset * DAY;
    const weekday = new Date(day).getUTCDay();
    if (schedule.overnight ? weekday === 5 || weekday === 6 : weekday === 0 || weekday === 6) continue;
    const open = atLocalTime(day, schedule.open, schedule.zone);
    const close = atLocalTime(day + (schedule.overnight ? DAY : 0), schedule.close, schedule.zone);
    if (selection === "lastOpened" ? open > now : close <= now) continue;
    const pause = schedule.break?.map(minutes => atLocalTime(day, minutes, schedule.zone));
    return { open, close, paused: !!pause && now >= pause[0] && now < pause[1] };
  }
  return null;
}

export interface MarketSession {
  state: "open" | "closed" | "continuous" | "daily" | "unknown";
  open?: number;
  close?: number;
  typical?: boolean;
  label?: string;
  paused?: boolean;
}

export function getMarketSession(quote: TrendQuote, now: number): MarketSession {
  const preset = getTrendPreset(quote.symbol);
  if (quote.observationDate || quote.source === "fred") return { state: "daily" };
  if (quote.alwaysOpen || preset?.category === "Crypto") return { state: "continuous" };
  const schedule = scheduleFor(quote.symbol);
  // Yahoo's all-day commodity/FX bars are quote-day boundaries, not exchange hours.
  const useProvider = quote.session && preset?.category !== "Commodities" && preset?.category !== "FX";
  const session = useProvider ? quote.session : schedule ? scheduledSession(schedule, now) : quote.session;
  if (!session) {
    // A cached status is not evidence of the market's current state after polling fails.
    const fresh = now >= quote.fetchedAt - 60_000 && now - quote.fetchedAt <= 120_000;
    const state = fresh ? quote.marketState ?? (quote.asOfDate ? "closed" : "unknown") : "unknown";
    if (getTrendFeed(quote.symbol)?.cnbcType === "BOND") {
      const window = treasuryWindow(now);
      if (window && now >= window.close) {
        // CNBC leaves REG_MKT on frozen closing quotes and omits mainmktstatus.
        // Outside regional hours, only recent activity AFTER the close can keep
        // the feed open. Check age against the ticking clock, not the fetch time.
        const active = state === "open" && !quote.asOfDate && quote.asOf >= window.close
          && quote.asOf <= now + 60_000 && now - quote.asOf <= 5 * 60_000;
        if (!active) return { state: "closed" };
      }
    }
    return { state };
  }
  const paused = schedule?.break ? scheduledSession(schedule, now)?.paused : false;
  const inSession = now >= session.open && now < session.close && !paused;
  // Closed-provider flags include holidays/halts. Do not carry one into a later session.
  const reportedClosed = quote.marketState === "closed" && quote.fetchedAt >= session.open && quote.fetchedAt < session.close;
  return {
    ...session,
    state: !inSession || reportedClosed || !!quote.asOfDate ? "closed" : "open",
    typical: !useProvider && !!schedule,
    label: schedule?.label,
    paused: !!paused,
  };
}

/** Display hours are independent of the evidence used to mark a market closed. */
export function getOhlcSession(quote: TrendQuote, now: number): Pick<MarketSession, "open" | "close" | "typical" | "label"> | null {
  if (quote.observationDate || quote.source === "fred") return null;
  if (quote.alwaysOpen || getTrendPreset(quote.symbol)?.category === "Crypto") {
    // Crypto has daily bars, but no daily market closure. Retain the provider's
    // bar window; otherwise display a UTC day as a reference, never as a cutoff.
    const day = Math.floor(quote.asOf / DAY) * DAY;
    return {
      ...(quote.session ?? { open: day, close: day + DAY }),
      typical: !quote.session,
      label: "Daily quote window; market trades 24/7",
    };
  }
  if (!quote.session && getTrendFeed(quote.symbol)?.cnbcType === "BOND") {
    // Keep the OHLC window with its quote even after a later session opens.
    return treasuryWindow(quote.asOf);
  }
  const session = getMarketSession(quote, now);
  const schedule = scheduleFor(quote.symbol);
  if (session.typical && schedule) {
    // Date-only snapshots refer to that exchange trading date, not midnight UTC.
    const quotedAt = quote.asOfDate
      ? atLocalTime(Date.parse(`${quote.asOfDate}T00:00:00Z`), schedule.close - 1, schedule.zone)
      : quote.asOf;
    return { ...scheduledSession(schedule, quotedAt, "lastOpened"), typical: true, label: schedule.label };
  }
  return session.open !== undefined && session.close !== undefined ? session : null;
}

/** Short date and clock time in the viewer's timezone, including overnight dates. */
export function formatSessionTime(time: number, timeZone?: string): string {
  const date = new Date(time);
  const zone = timeZone ? { timeZone } : {};
  const day = date.toLocaleDateString([], { month: "numeric", day: "numeric", ...zone });
  const clock = date.toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", hour12: false, ...zone,
  });
  return `${day} ${clock}`;
}
