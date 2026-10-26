"use client";

import { useState } from "react";
import { CANDLE_PATTERNS, PATTERN_GROUPS, candleCountLabel } from "../lib/chartAlerts/catalog";
import PatternHelp from "./PatternHelp";
import PatternBadges, { definitionDirections } from "./PatternBadges";
import styles from "./ChartMonitor.module.css";

export default function PatternLibrary() {
  const [query, setQuery] = useState("");
  const [length, setLength] = useState("all");
  const [group, setGroup] = useState("all");
  const filtered = CANDLE_PATTERNS.filter(item => {
    const text = `${item.name} ${item.bullishName ?? ""} ${item.bearishName ?? ""} ${item.summary}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (group === "all" || item.group === group)
      && (length === "all" || (length === "4+" ? (item.maxCandles ?? item.candles) >= 4 : item.candles === Number(length)));
  }).sort((a, b) => a.candles - b.candles || a.name.localeCompare(b.name));

  return <details className={styles.guide}>
    <summary>Pattern library · {CANDLE_PATTERNS.length} detectors</summary>
    <p>61 TA-Lib pattern families plus Tweezer Top and Bottom. Families can include bullish and bearish versions. Hover, focus or tap a name for its meaning.</p>
    <div className={styles.libraryFields}>
      <label>Find a pattern<input type="search" value={query} placeholder="Doji, harami, three methods…" onChange={event => setQuery(event.target.value)} /></label>
      <div className={styles.fields}>
        <label>Candle count<select value={length} onChange={event => setLength(event.target.value)}><option value="all">All lengths</option><option value="1">1 candle</option><option value="2">2 candles</option><option value="3">3 candles</option><option value="4+">4+ candles</option></select></label>
        <label>Pattern type<select value={group} onChange={event => setGroup(event.target.value)}><option value="all">All types</option>{PATTERN_GROUPS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      </div>
    </div>
    <p className={styles.note} aria-live="polite">{filtered.length} of {CANDLE_PATTERNS.length} detectors</p>
    {filtered.map(item => {
      const directions = definitionDirections(item.direction);
      return <div key={item.code} className={styles.libraryItem}>
        <div className={styles.patternHeading}>
          <PatternHelp name={item.name} direction={directions.length === 1 ? directions[0] : undefined} explanation={`${candleCountLabel(item)}. ${item.summary}${item.gap ? " Requires the traditional price gap; this is not relaxed for continuously traded markets." : ""}`} />
          <PatternBadges directions={directions} />
        </div>
        <div className={styles.patternMeta}>{candleCountLabel(item)} · {PATTERN_GROUPS.find(group => group.key === item.group)?.label}{item.gap ? " · Gap required" : ""} <a href={item.source} target="_blank" rel="noreferrer">Reference ↗</a></div>
      </div>;
    })}
    {!filtered.length && <p>No patterns match these filters.</p>}
    <p className={styles.note}>Paired labels show possible variants or context-dependent bias. Live readings show the detected direction. Traditional names describe formations, not measured odds of success. Gap-dependent formations can be rare on crypto charts.</p>
  </details>;
}
