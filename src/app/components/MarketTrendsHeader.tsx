"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_TRENDS, MAX_TRENDS_PER_SIDE, TREND_CATEGORIES, TREND_PRESETS, TREND_SOURCE_NOTES,
  getTrendFeed, getTrendPreset, normalizeTrendSymbol, trendChange,
} from "../lib/trends";
import type { TrendCategory, TrendConfig, TrendDisplay, TrendQuote, TrendResult, TrendSide } from "../lib/trends";
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

function DayRange({ quote }: { quote: TrendQuote }) {
  const { low, high, open, price } = quote;
  if (low === null || high === null || high < low) return <span className={styles.noRange}>Day range unavailable</span>;
  const position = (value: number) => high === low ? 50 : Math.max(0, Math.min(100, (value - low) / (high - low) * 100));
  return (
    <div className={styles.range} aria-label={`Day low ${priceText(low, quote.symbol)}, high ${priceText(high, quote.symbol)}; tick is open, dot is latest`}>
      <span>{priceText(low, quote.symbol)}</span>
      <span className={styles.track}>
        {open !== null && <span className={styles.openMark} style={{ left: `${position(open)}%` }} />}
        <span className={styles.priceMark} style={{ left: `${position(price)}%` }} />
      </span>
      <span>{priceText(high, quote.symbol)}</span>
    </div>
  );
}

function TrendCard({ symbol, result, error, display, onEdit }: {
  symbol: string; result?: TrendResult; error: string | null; display: TrendDisplay; onEdit: () => void;
}) {
  const preset = getTrendPreset(symbol);
  const feed = getTrendFeed(symbol);
  const quote = result?.quote;
  const failure = result?.error || error;
  const change = quote ? trendChange(quote) : null;
  const direction = change && Math.abs(change.value) >= 0.005 ? Math.sign(change.value) : 0;
  const daily = feed?.source === "fred";
  const source = feed?.label ?? "Yahoo Finance";
  const title = quote
    ? `${quote.name} (${feed?.providerSymbol ?? symbol})${quote.currency ? ` · ${quote.currency}` : ""}\nAs of ${quote.observationDate ?? quote.asOfDate ?? new Date(quote.asOf).toLocaleString()} · ${source}${quote.exchange ? ` · ${quote.exchange}` : ""}${quote.delayed ? " · delayed" : ""}\n${feed?.description ?? ""}\nChange vs previous ${daily ? "observation" : "close"} ${priceText(quote.previousClose, symbol)}\n${daily ? "Daily published rate; intraday OHLC is not available." : `Open ${priceText(quote.open, symbol)} · High ${priceText(quote.high, symbol)} · Low ${priceText(quote.low, symbol)} · Latest ${priceText(quote.price, symbol)}`}${failure ? `\nStale: ${failure}` : ""}\nClick to edit market or source`
    : `${preset?.description ?? symbol} · ${source}\n${failure ?? "Loading quote…"}\nClick to edit market or source`;
  return (
    <button type="button" className={styles.card} onClick={onEdit} title={title} aria-label={`Edit ${preset?.label ?? symbol} trend`}>
      <span className={styles.cardHeading}>
        <span className={styles.symbol}>{preset?.label ?? symbol}</span>
        <span className={failure ? styles.stale : styles.timestamp}>{failure ? quote ? "Stale" : "Unavailable" : quote ? quoteTime(quote) : "Loading"}</span>
      </span>
      <span className={styles.reading}>
        <span className={styles.price}>{quote ? priceText(quote.price, symbol) : "—"}</span>
        <span className={direction > 0 ? styles.up : direction < 0 ? styles.down : styles.neutral}>
          {change ? `${direction > 0 ? "↗ +" : direction < 0 ? "↘ −" : ""}${Math.abs(change.value).toFixed(2)}${change.unit === "bp" ? " bp" : "%"}` : "—"}
        </span>
      </span>
      <span className={styles.cardSource}>{source}{quote?.delayed ? " · delayed" : ""}</span>
      {display !== "compact" && daily && <span className={styles.noRange}>Daily rate · no intraday OHLC</span>}
      {display === "range" && !daily && (quote ? <DayRange quote={quote} /> : <span className={styles.noRange}>Day range · —</span>)}
      {display === "ohlc" && !daily && (
        <span className={styles.ohlc}>
          {([['O', quote?.open], ['H', quote?.high], ['L', quote?.low], ['C*', quote?.price]] as const).map(([label, value]) => (
            <span key={label}><span className={styles.dim}>{label}</span> {priceText(value ?? null, symbol)}</span>
          ))}
        </span>
      )}
    </button>
  );
}

function TrendEditor({ side, symbols, focusIndex, onSave, onClose, hasUnsavedChanges, saveError }: {
  side: TrendSide; symbols: string[]; focusIndex: number; onSave: (symbols: string[]) => boolean; onClose: () => void;
  hasUnsavedChanges: boolean; saveError: string;
}) {
  const [draft, setDraft] = useState(symbols.length ? [...symbols] : [""]);
  const [activeIndex, setActiveIndex] = useState(focusIndex);
  const [category, setCategory] = useState<TrendCategory>(getTrendPreset(symbols[focusIndex] ?? "")?.category ?? "Rates");
  const [error, setError] = useState("");
  const [didSave, setDidSave] = useState(false);
  const listId = useId();
  const root = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const input = root.current?.querySelectorAll("input")[focusIndex];
    input?.focus();
    input?.select();
  }, [focusIndex]);

  const entries = draft.filter(s => s.trim()).map(normalizeTrendSymbol);
  const normalized = entries.includes(null) ? null : [...new Set(entries as string[])];
  const changed = hasUnsavedChanges || normalized === null || JSON.stringify(normalized) !== JSON.stringify(symbols);
  const save = () => {
    if (normalized === null) {
      setError("Pick a preset (US02Y, DXY, BTC) or use a Yahoo symbol (AAPL, GC=F).");
      return;
    }
    if (onSave(normalized)) {
      setDraft(normalized);
      setDidSave(true);
      setError("");
    }
  };

  return (
    <form ref={root} className={styles.editor} aria-label={`Edit ${side} trends`} onSubmit={event => { event.preventDefault(); save(); }}>
      <div className={styles.editorHeading}><strong>{side === "left" ? "Left" : "Right"} trends</strong><button type="button" onClick={onClose} aria-label="Cancel trend editing">×</button></div>
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
              onChange={event => { setError(""); setDraft(draft.map((s, i) => i === index ? event.target.value : s)); }} />
            <button type="button" disabled={index === 0} aria-label={`Move trend ${index + 1} earlier`} onClick={() => {
              const next = [...draft];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              setDraft(next);
              setActiveIndex(index - 1);
            }}>↑</button>
            <button type="button" aria-label={`Remove trend ${index + 1}`} onClick={() => {
              setDraft(draft.filter((_, i) => i !== index));
              setActiveIndex(Math.max(0, Math.min(activeIndex > index ? activeIndex - 1 : activeIndex, draft.length - 2)));
            }}>×</button>
          </div>
          <label className={styles.sourcePicker}>
            <span>Source</span>
            <select aria-label={`${side} trend ${index + 1} source`} value={feed?.symbol ?? ""} disabled={sources.length < 2} title={feed?.description}
              onFocus={() => setActiveIndex(index)} onChange={event => { setError(""); setDraft(draft.map((s, i) => i === index ? event.target.value : s)); }}>
              {!sources.length && <option value="">Choose a market</option>}
              {sources.map((source, n) => <option key={source.symbol} value={source.symbol}>{source.label}{n === 0 ? " (default)" : ""}</option>)}
            </select>
          </label>
        </div>;
      })}
      {getTrendFeed(draft[activeIndex] ?? "") && <p className={styles.help}>{getTrendFeed(draft[activeIndex])?.description}</p>}
      {draft.length < MAX_TRENDS_PER_SIDE && <button type="button" className={styles.add} onClick={() => { setActiveIndex(draft.length); setDraft([...draft, ""]); }}>+ Add market</button>}
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
              setError("");
              setDraft(draft.length === 0 ? [p.symbol] : draft.map((s, i) => i === activeIndex ? p.symbol : s));
            }}>{p.label}{p.sources[0].source === "fred" ? " †" : ""}</button>
        ))}
      </div>
      {(error || saveError) && <p role="alert" className={styles.formError}>{error || saveError}</p>}
      <p className={styles.help}>Up to {MAX_TRENDS_PER_SIDE} per side. Remove all to hide. Quotes may be delayed.</p>
      <div className={styles.editorActions}>
        <button type="button" onClick={() => { setDraft([...DEFAULT_TRENDS[side]]); setActiveIndex(0); setError(""); }}>Reset</button>
        <span />
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className={styles.save} disabled={!changed}>{!changed && didSave ? "Saved" : "Save"}</button>
      </div>
      <p className={styles.help} role="status">{!changed && didSave ? "Charts and both banner sides saved." : "Save includes charts and both banner sides."}</p>
    </form>
  );
}

function TrendGroup({ side, symbols, display, results, error, onSave, hasUnsavedChanges, saveError }: {
  side: TrendSide; symbols: string[]; display: TrendDisplay; results: Record<string, TrendResult>;
  error: string | null; onSave: (symbols: string[]) => boolean; hasUnsavedChanges: boolean; saveError: string;
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
        {symbols.map((symbol, index) => <TrendCard key={symbol} symbol={symbol} result={results[symbol]} error={error} display={display} onEdit={() => setEditing(index)} />)}
        {symbols.length === 0 && <button type="button" className={styles.empty} onClick={() => setEditing(0)}>+ Add a trend</button>}
      </div>
      {editing !== null && <div id={editorId} className={styles.editorAnchor}>
        <TrendEditor side={side} symbols={symbols} focusIndex={editing} onClose={close} onSave={onSave} hasUnsavedChanges={hasUnsavedChanges} saveError={saveError} />
      </div>}
    </section>
  );
}

export default function MarketTrendsHeader({ children, config, onChange, onSave, hasUnsavedChanges, saveError }: {
  children: ReactNode; config: TrendConfig; onChange: (config: TrendConfig) => void;
  onSave: (config: TrendConfig) => boolean; hasUnsavedChanges: boolean; saveError: string;
}) {
  const { results, error } = useTrendQuotes([...config.left, ...config.right]);

  const group = (side: TrendSide) => <TrendGroup side={side} symbols={config[side]} display={config.display} results={results} error={error} onSave={symbols => onSave({ ...config, [side]: symbols })} hasUnsavedChanges={hasUnsavedChanges} saveError={saveError} />;

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
        {config.display === "ohlc" && <span className={styles.source}>C* = latest; final at session close</span>}
      </div>
      {group("right")}
    </header>
  );
}
