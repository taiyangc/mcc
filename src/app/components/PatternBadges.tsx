import type { PatternDefinition, PatternDirection } from "../lib/chartAlerts/catalog";
import type { PatternSignal } from "../lib/chartAlerts/types";
import styles from "./ChartMonitor.module.css";

const LABELS = { up: "↑ Bullish", down: "↓ Bearish", neutral: "◇ Neutral", unusual: "! Unusual" };

/** Catalog families can have several possible biases; live readings have one. */
export function definitionDirections(direction: PatternDefinition["direction"]): PatternDirection[] {
  if (direction === "signed") return ["up", "down"];
  if (direction === "lower-rejection") return ["up", "neutral"];
  if (direction === "upper-rejection") return ["down", "neutral"];
  return [direction];
}

export function isUnusualMove(signal: Pick<PatternSignal, "category">): boolean {
  return signal.category === "momentum" || signal.category === "breakouts";
}

export default function PatternBadges({ directions = [], unusual = false }: { directions?: readonly PatternDirection[]; unusual?: boolean }) {
  const tones = [...directions, ...(unusual ? ["unusual" as const] : [])];
  return <span className={styles.patternBadges}>
    {tones.map(tone => <span key={tone} className={styles.patternBadge} data-pattern-tone={tone}>{LABELS[tone]}</span>)}
  </span>;
}
