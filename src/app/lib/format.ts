// Display formatters shared by the Hyperliquid panels.

/** "$1.23B" / "$45.6M" / "$7.89K" / "$12.34" — compact USD for dense tables. */
export function formatUsd(value: number, opts: { sign?: boolean } = {}): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : opts.sign && value > 0 ? "+" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Compact plain number: 1.2B / 34.5M / 678.9K / 12.34 */
export function formatCompact(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(decimals)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(decimals)}`;
  return `${sign}${abs.toPrecision(3)}`;
}

/** 0.1234 → "12.34%" */
export function formatPct(fraction: number, decimals = 2): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** A funding rate (per interval or annualized) as a signed percentage. */
export function formatRatePct(fraction: number, decimals = 4): string {
  if (!Number.isFinite(fraction)) return "—";
  const sign = fraction > 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(decimals)}%`;
}

/** Significant figures every price is shown to, whatever its scale. */
const PX_SIGNIFICANT_DIGITS = 6;

/**
 * A price at the precision it actually carries: "79,294.9", "1.41331", "0.0084213".
 *
 * One fixed number of decimals cannot serve a book holding both BTC and kPEPE. Two places
 * round XRP's entry and its mark to the same 1.41 and hide the move the row exists to
 * show; six pad BTC with noise. Fixing the significant figures instead and dropping
 * trailing zeros gives every coin the same amount of information.
 */
export function formatPx(px: number | null | undefined): string {
  if (px === null || px === undefined || !Number.isFinite(px) || px === 0) return "—";
  const magnitude = Math.floor(Math.log10(Math.abs(px))) + 1;
  const decimals = Math.min(Math.max(PX_SIGNIFICANT_DIGITS - magnitude, 0), 8);
  return px.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** 0x1234…abcd */
export function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Time until a future timestamp: "2h 05m" / "45s" / "now". */
export function formatCountdown(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return "now";
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** Wall-clock time of day, used for feed rows. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** "3m ago" / "just now" — relative age for snapshot timestamps. */
export function formatAge(ms: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - ms);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
