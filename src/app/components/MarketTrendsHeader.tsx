"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_TRENDS, MAX_TRENDS_PER_SIDE, TREND_CATEGORIES, TREND_PRESETS, TREND_SOURCE_NOTES,
  getTrendFeed, getTrendPreset, normalizeTrendSymbol, trendChange,
} from "../lib/trends";
import type { TrendCategory, TrendConfig, TrendDisplay, TrendQuote, TrendResult, TrendSide } from "../lib/trends";
import { formatSessionTime, getMarketSession, getOhlcSession } from "../lib/marketSession";
import { useNow } from "./hl/useNow";
import styles from "./MarketTrendsHeader.module.css";

function useTrendQuotes(symbols: string[]) {
  const key = [...new Set(symbols)].sort().join(",");
  const [results, setResults] = useState<Record<string, TrendResult>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      if (disposed || document.hidden || controller) return;
      clearTimeout(timer);
      controller = new AbortController();
      try {
        const response = await fetch(`/api/trends?symbols=${encodeURIComponent(key)}`, {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        if (!response.ok) throw new Error("Quotes unavailable. Retrying in a minute.");
        const data: { quotes: TrendResult[] } = await response.json();
        if (!disposed) {
          setResults(previous => Object.fromEntries(data.quotes.map(result => [result.symbol, {
            ...result,
            quote: result.quote ?? previous[result.symbol]?.quote ?? null,
          }])));
          setError(null);
        }
      } catch {
        if (!disposed) setError("Quotes unavailable. Retrying in a minute.");
      } finally {
        controller = null;
        if (!disposed && !document.hidden) timer = setTimeout(refresh, 60_000);
      }
    }

    function onVisibility() {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    }
    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key]);

  return { results, error };
}

function priceText(value: number | null, symbol: string): string {
  if (value === null) return "—";
  const preset = getTrendPreset(symbol);
  const isYield = preset?.yield;
  // Preserve useful precision for forex and small tokens instead of rounding them to zero.
  if (!isYield && (preset?.category === "FX" || Math.abs(value) < 10)) return value.toLocaleString("en-US", { maximumSignificantDigits: 6 });
  const decimals = isYield ? 3 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + (isYield ? "%" : "");
}

function quoteTime(quote: TrendQuote): string {
  const date = new Date(quote.asOf);
  if (quote.observationDate) return `Daily · ${date.toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" })}`;
  if (quote.asOfDate) return date.toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function SessionTime({ session, edge }: { session: ReturnType<typeof getOhlcSession>; edge: "open" | "close" }) {
  const time = session?.[edge];
  if (time === undefined) return null;
  return <time className={styles.sessionTime} dateTime={new Date(time).toISOString()}
    title={`${edge === "open" ? "Open" : "Close"} · ${session?.typical ? "Typical " : ""}${session?.label ?? "Market session"} · ${new Date(time).toLocaleString()}`}
    aria-label={`${edge === "open" ? "Open" : "Close"} time ${formatSessionTime(time)}`}>{formatSessionTime(time)}</time>;
}

function SessionTimes({ session }: { session: ReturnType<typeof getOhlcSession> }) {
  if (!session) return null;
  return <span className={styles.sessionTimes}>
    <SessionTime session={session} edge="open" />
    <SessionTime session={session} edge="close" />
  </span>;
}

function DayRange({ quote, closed, session }: { quote: TrendQuote; closed: boolean; session: ReturnType<typeof getOhlcSession> }) {
  const { low, high, open, price } = quote;
  if (low === null || high === null || high < low) return <>
    <span className={styles.noRange}>Day range unavailable</span>
    <SessionTimes session={session} />
  </>;
  const position = (value: number) => high === low ? 50 : Math.max(0, Math.min(100, (value - low) / (high - low) * 100));
  return (
    <div className={styles.range} aria-label={`Day low ${priceText(low, quote.symbol)}, high ${priceText(high, quote.symbol)}; tick is open${closed ? "" : ", dot is latest"}`}>
      <span>{priceText(low, quote.symbol)}</span>
      <span className={styles.track}>
        {open !== null && <span className={styles.openMark} style={{ left: `${position(open)}%` }} />}
        {!closed && <span className={styles.priceMark} style={{ left: `${position(price)}%` }} />}
      </span>
      <span>{priceText(high, quote.symbol)}</span>
      <span className={styles.rangeOpen}><SessionTime session={session} edge="open" /></span>
      <span className={styles.rangeClose}><SessionTime session={session} edge="close" /></span>
    </div>
  );
}

function TrendCard({ symbol, result, error, display, now, onEdit }: {
  symbol: string; result?: TrendResult; error: string | null; display: TrendDisplay; now: number; onEdit: () => void;
}) {
  const preset = getTrendPreset(symbol);
  const feed = getTrendFeed(symbol);
  const quote = result?.quote;
  const failure = result?.error || error;
  const change = quote ? trendChange(quote) : null;
  const direction = change && Math.abs(change.value) >= 0.005 ? Math.sign(change.value) : 0;
  const daily = feed?.source === "fred";
  const source = feed?.label ?? "Yahoo Finance";
  const session = quote ? getMarketSession(quote, now) : null;
  const displaySession = quote ? getOhlcSession(quote, now) : null;
  const closed = session?.state === "closed";
  const title = quote
    ? `${quote.name} (${feed?.providerSymbol ?? symbol})${quote.currency ? ` · ${quote.currency}` : ""}\nAs of ${quote.observationDate ?? quote.asOfDate ?? new Date(quote.asOf).toLocaleString()} · ${source}${quote.exchange ? ` · ${quote.exchange}` : ""}${quote.delayed ? " · delayed" : ""}\n${feed?.description ?? ""}\nChange vs previous ${daily ? "observation" : "close"} ${priceText(quote.previousClose, symbol)}\n${daily ? "Daily published rate; intraday OHLC is not available." : `Open ${priceText(quote.open, symbol)} · High ${priceText(quote.high, symbol)} · Low ${priceText(quote.low, symbol)} · Latest ${priceText(quote.price, symbol)}`}${failure ? `\nStale: ${failure}` : ""}\nClick to edit market or source`
    : `${preset?.description ?? symbol} · ${source}\n${failure ?? "Loading quote…"}\nClick to edit market or source`;
  return (
    <button type="button" className={styles.card} onClick={onEdit} title={title} aria-label={`Edit ${preset?.label ?? symbol} trend`}>
      <span className={styles.cardHeading}>
        <span className={styles.symbol}>{preset?.label ?? symbol}</span>
        <span className={closed ? styles.closed : failure ? styles.stale : styles.timestamp}>{closed ? "Closed" : failure ? quote ? "Stale" : "Unavailable" : quote ? quoteTime(quote) : "Loading"}</span>
      </span>
      <span className={styles.reading}>
        <span className={styles.price}>{quote ? priceText(quote.price, symbol) : "—"}</span>
        <span className={direction > 0 ? styles.up : direction < 0 ? styles.down : styles.neutral}>
          {change ? `${direction > 0 ? "↗ +" : direction < 0 ? "↘ −" : ""}${Math.abs(change.value).toFixed(2)}${change.unit === "bp" ? " bp" : "%"}` : "—"}
        </span>
      </span>
      {display === "compact" && !daily && <SessionTimes session={displaySession} />}
      <span className={styles.cardSource}>{source}{quote?.delayed ? " · delayed" : ""}{closed && failure ? " · stale quote" : ""}</span>
      {display !== "compact" && daily && <span className={styles.noRange}>Daily rate · no intraday OHLC</span>}
      {display === "range" && !daily && (quote ? <DayRange quote={quote} closed={closed} session={displaySession} /> : <span className={styles.noRange}>Day range · —</span>)}
      {display === "ohlc" && !daily && (
        <span className={styles.ohlc}>
          {([['O', quote?.open, 'open'], ['H', quote?.high, undefined], ['L', quote?.low, undefined], ['C*', quote?.price, 'close']] as const).map(([label, value, edge]) => (
            <span key={label} className={styles.ohlcValue}>
              <span className={styles.dim}>{label}</span>
              <span>
                {priceText(value ?? null, symbol)}
                {edge && <SessionTime session={displaySession} edge={edge} />}
              </span>
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function TrendEditor({ side, symbols, focusIndex, onChange, onSave, onClose, saveError }: {
  side: TrendSide; symbols: string[]; focusIndex: number; onSave: (symbols: string[]) => boolean; onClose: () => void;
  onChange: (symbols: string[]) => void; saveError: string;
}) {
  // Keep typed values separate from applied selections, including while reordering/removing rows.
  const [rows, setRows] = useState(() => symbols.length
    ? symbols.map(value => ({ value, applied: value })) : [{ value: "", applied: "" }]);
  const draft = rows.map(row => row.value);
  const [activeIndex, setActiveIndex] = useState(focusIndex);
  const [category, setCategory] = useState<TrendCategory>(getTrendPreset(symbols[focusIndex] ?? "")?.category ?? "Rates");
  const [error, setError] = useState("");
  const listId = useId();
  const root = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const input = root.current?.querySelectorAll("input")[focusIndex];
    input?.focus();
    input?.select();
  }, [focusIndex]);

  const entries = draft.filter(s => s.trim()).map(normalizeTrendSymbol);
  const normalized = entries.includes(null) ? null : [...new Set(entries as string[])];
  const applySelection = (next: typeof rows) => {
    setRows(next);
    setError("");
    onChange([...new Set(next.map(row => row.applied).filter(Boolean))]);
  };
  const save = () => {
    if (normalized === null) {
      setError("Pick a preset (US02Y, DXY, BTC) or use a Yahoo symbol (AAPL, GC=F).");
      return;
    }
    if (onSave(normalized)) onClose();
  };

  return (
    <form ref={root} className={styles.editor} aria-label={`Edit ${side} trends`} onSubmit={event => { event.preventDefault(); save(); }}>
      <div className={styles.editorHeading}><strong>{side === "left" ? "Left" : "Right"} trends</strong><button type="button" onClick={onClose} aria-label="Close trend editing">×</button></div>
      <p className={styles.help}>Choose a market and its source. Click a card to edit either.</p>
      <datalist id={listId}>
        {TREND_PRESETS.map(preset => <option key={preset.symbol} value={preset.label}>{preset.description}</option>)}
      </datalist>
      {draft.map((symbol, index) => {
        const preset = getTrendPreset(symbol);
        const feed = getTrendFeed(symbol);
        const sources = preset?.sources ?? (feed ? [feed] : []);
        return <div key={index}>
          <div className={styles.editorRow}>
            <input aria-label={`${side} trend ${index + 1}`} list={listId} value={preset?.label ?? symbol} placeholder="US02Y, DXY, AAPL…" maxLength={40} autoComplete="off" spellCheck={false}
              data-active={index === activeIndex} onFocus={() => setActiveIndex(index)}
              onChange={event => { setError(""); setRows(rows.map((row, i) => i === index ? { ...row, value: event.target.value } : row)); }} />
            <button type="button" disabled={index === 0} aria-label={`Move trend ${index + 1} earlier`} onClick={() => {
              const next = [...rows];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              applySelection(next);
              setActiveIndex(index - 1);
            }}>↑</button>
            <button type="button" aria-label={`Remove trend ${index + 1}`} onClick={() => {
              applySelection(rows.filter((_, i) => i !== index));
              setActiveIndex(Math.max(0, Math.min(activeIndex > index ? activeIndex - 1 : activeIndex, draft.length - 2)));
            }}>×</button>
          </div>
          <label className={styles.sourcePicker}>
            <span>Source</span>
            <select aria-label={`${side} trend ${index + 1} source`} value={feed?.symbol ?? ""} disabled={sources.length < 2} title={feed?.description}
              onFocus={() => setActiveIndex(index)} onChange={event => applySelection(rows.map((row, i) => i === index ? { value: event.target.value, applied: event.target.value } : row))}>
              {!sources.length && <option value="">Choose a market</option>}
              {sources.map((source, n) => <option key={source.symbol} value={source.symbol}>{source.label}{n === 0 ? " (default)" : ""}</option>)}
            </select>
          </label>
        </div>;
      })}
      {getTrendFeed(draft[activeIndex] ?? "") && <p className={styles.help}>{getTrendFeed(draft[activeIndex])?.description}</p>}
      {draft.length < MAX_TRENDS_PER_SIDE && <button type="button" className={styles.add} onClick={() => { setActiveIndex(draft.length); setRows([...rows, { value: "", applied: "" }]); }}>+ Add market</button>}
      <div className={styles.categories} role="group" aria-label="Preset category">
        {TREND_CATEGORIES.map(value => <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}
      </div>
      <p className={styles.help}>{TREND_SOURCE_NOTES[category]}</p>
      <p className={styles.help}>Choose for market {activeIndex + 1}</p>
      <div className={styles.presets} role="group" aria-label={`${category} presets`}>
        {TREND_PRESETS.filter(p => p.category === category).map(p => (
          <button key={p.symbol} type="button" title={p.description} aria-label={`Select ${p.label}`} aria-pressed={getTrendPreset(draft[activeIndex] ?? "")?.symbol === p.symbol}
            disabled={draft.some((s, i) => i !== activeIndex && normalizeTrendSymbol(s) === p.symbol)}
            onClick={() => {
              const selected = { value: p.symbol, applied: p.symbol };
              applySelection(rows.length === 0 ? [selected] : rows.map((row, i) => i === activeIndex ? selected : row));
            }}>{p.label}{p.sources[0].source === "fred" ? " †" : ""}</button>
        ))}
      </div>
      {(error || saveError) && <p role="alert" className={styles.formError}>{error || saveError}</p>}
      <p className={styles.help}>Up to {MAX_TRENDS_PER_SIDE} per side. Remove all to hide. Quotes may be delayed.</p>
      <div className={styles.editorActions}>
        <button type="button" onClick={() => { applySelection(DEFAULT_TRENDS[side].map(value => ({ value, applied: value }))); setActiveIndex(0); }}>Reset</button>
        <span />
        <button type="button" onClick={onClose}>Close</button>
        <button type="submit" className={styles.save}>Save</button>
      </div>
      <p className={styles.help}>Selections save automatically. Click Save to apply typed symbols.</p>
    </form>
  );
}

function TrendGroup({ side, symbols, display, results, error, now, onChange, onSave, saveError }: {
  side: TrendSide; symbols: string[]; display: TrendDisplay; results: Record<string, TrendResult>;
  error: string | null; now: number; onChange: (symbols: string[]) => void; onSave: (symbols: string[]) => boolean; saveError: string;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const root = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  const close = () => { setEditing(null); editButton.current?.focus(); };

  useEffect(() => {
    if (editing === null) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setEditing(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setEditing(null); editButton.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [editing]);

  return (
    <section ref={root} className={styles.side} aria-label={`${side} asset trends`}>
      <div className={styles.sideToolbar}>
        <span>{symbols.length ? "DAILY CHANGE" : "ASSET TRENDS"}</span>
        <button ref={editButton} type="button" aria-label={`Edit ${side} trends`} aria-expanded={editing !== null} aria-controls={editorId} onClick={() => editing === null ? setEditing(0) : close()}>✎ Edit</button>
      </div>
      <div className={styles.rail}>
        {symbols.map((symbol, index) => <TrendCard key={symbol} symbol={symbol} result={results[symbol]} error={error} display={display} now={now} onEdit={() => setEditing(index)} />)}
        {symbols.length === 0 && <button type="button" className={styles.empty} onClick={() => setEditing(0)}>+ Add a trend</button>}
      </div>
      {editing !== null && <div id={editorId} className={styles.editorAnchor}>
        <TrendEditor side={side} symbols={symbols} focusIndex={editing} onClose={close} onChange={onChange} onSave={onSave} saveError={saveError} />
      </div>}
    </section>
  );
}

export default function MarketTrendsHeader({ children, config, onChange, onSave, saveError }: {
  children: ReactNode; config: TrendConfig; onChange: (config: TrendConfig) => void;
  onSave: (config: TrendConfig) => boolean; saveError: string;
}) {
  const { results, error } = useTrendQuotes([...config.left, ...config.right]);
  const now = useNow(15_000);

  const group = (side: TrendSide) => <TrendGroup side={side} symbols={config[side]} display={config.display} results={results} error={error} now={now} onChange={symbols => onChange({ ...config, [side]: symbols })} onSave={symbols => onSave({ ...config, [side]: symbols })} saveError={saveError} />;

  return (
    <header className={styles.header}>
      {group("left")}
      <div className={styles.title}>
        {children}
        <div className={styles.displayOptions} role="group" aria-label="Trend display">
          {([["compact", "Change"], ["range", "Day range"], ["ohlc", "OHLC"]] as const).map(([display, label]) => (
            <button key={display} type="button" aria-pressed={config.display === display} onClick={() => onChange({ ...config, display })}>{label}</button>
          ))}
        </div>
        <span className={styles.source}><a href="https://finance.yahoo.com/" target="_blank" rel="noopener noreferrer">Yahoo</a> · <a href="https://www.cnbc.com/bonds/" target="_blank" rel="noopener noreferrer">CNBC</a> · <a href="https://fred.stlouisfed.org/" target="_blank" rel="noopener noreferrer">FRED</a> · quotes may be delayed</span>
        {config.display === "ohlc" && <span className={styles.source}>C* = latest</span>}
      </div>
      {group("right")}
    </header>
  );
}
