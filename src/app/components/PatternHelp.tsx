"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PatternDirection } from "../lib/chartAlerts/catalog";
import PatternBadges from "./PatternBadges";
import styles from "./ChartMonitor.module.css";

/** A top-layer explanation that also works with keyboard focus and touch. */
export default function PatternHelp({ name, explanation, className, direction, unusual = false }: {
  name: string; explanation: string; className?: string; direction?: PatternDirection; unusual?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const cancelHide = () => clearTimeout(hideTimer.current);
  const hide = () => { cancelHide(); setPosition(null); };
  const show = () => {
    cancelHide();
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const above = rect.top > window.innerHeight / 2;
    const width = Math.min(320, window.innerWidth - 24);
    setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(above ? { bottom: window.innerHeight - rect.top + 6, maxHeight: rect.top - 18 }
        : { top: rect.bottom + 6, maxHeight: window.innerHeight - rect.bottom - 18 }) });
  };
  const deferHide = () => { cancelHide(); hideTimer.current = setTimeout(() => setPosition(null), 150); };

  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (!position) return;
    const dismiss = (event?: Event) => {
      if (event?.type === "scroll" && event.target instanceof Node && tooltip.current?.contains(event.target)) return;
      setPosition(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", escape, true);
    };
  }, [position]);

  return <>
    <button ref={trigger} type="button" className={`${styles.patternTrigger} ${className ?? ""}`}
      data-pattern-direction={direction}
      aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={deferHide}
      onFocus={show} onBlur={hide} onClick={show}>{name}</button>
    {position && createPortal(<div ref={tooltip} id={id} role="tooltip" className={styles.tooltip} style={position}
      onMouseEnter={cancelHide} onMouseLeave={deferHide}>
      {(direction || unusual) && <div className={styles.tooltipBadges}><PatternBadges directions={direction ? [direction] : []} unusual={unusual} /></div>}
      {explanation}
    </div>, document.body)}
  </>;
}
