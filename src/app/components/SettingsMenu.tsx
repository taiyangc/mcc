"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./MarketTrendsHeader.module.css";

interface SettingsDraft {
  pairs: string[];
  width: number;
  height: number;
}

function SettingsEditor({ initial, defaultInterval, intervalOptions, onIntervalChange, onSave, onClose, saveError }: {
  initial: SettingsDraft;
  defaultInterval: string;
  intervalOptions: { value: string; label: string }[];
  onIntervalChange: (interval: string) => void;
  onSave: (draft: SettingsDraft) => boolean;
  onClose: () => void;
  saveError: string;
}) {
  const [pairs, setPairs] = useState(initial.pairs);
  const [width, setWidth] = useState(String(initial.width));
  const [height, setHeight] = useState(String(initial.height));
  const count = Math.max(1, Math.min(100, (Number(width) || 1) * (Number(height) || 1)));
  return <form id="chart-settings" aria-label="Chart settings" className={styles.editor} onSubmit={event => {
    event.preventDefault();
    if (onSave({ pairs, width: Number(width), height: Number(height) })) onClose();
  }}>
    <div className={styles.editorHeading}>
      <strong>Chart settings</strong>
      <button type="button" onClick={onClose} aria-label="Close chart settings">×</button>
    </div>
    <p className={styles.help}>Selections save automatically. Click Save to apply typed inputs.</p>
    <div className={styles.settingsDimensions}>
      <label>Width<input autoFocus type="number" min={1} max={10} required value={width} onChange={event => setWidth(event.target.value)} /></label>
      <label>Height<input type="number" min={1} max={10} required value={height} onChange={event => setHeight(event.target.value)} /></label>
    </div>
    <label className={styles.settingsInterval}>Default interval
      <select value={defaultInterval} onChange={event => onIntervalChange(event.target.value)}>
        {intervalOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <div className={styles.settingsSymbols}>
      {Array.from({ length: count }, (_, index) => <label key={index}>Chart {index + 1}
        <input type="text" aria-label={`Chart ${index + 1} symbol`} value={pairs[index] ?? ""} placeholder="PAIR" autoComplete="off" spellCheck={false}
          onChange={event => setPairs(previous => {
            const next = [...previous];
            next[index] = event.target.value;
            return next;
          })} />
      </label>)}
    </div>
    {saveError && <p role="alert" className={styles.formError}>{saveError}</p>}
    <div className={styles.editorActions}>
      <span />
      <button type="button" onClick={onClose}>Close</button>
      <button type="submit" className={styles.save}>Save</button>
    </div>
  </form>;
}

export default function SettingsMenu({ open, onToggle, onClose, ...editorProps }: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
} & Omit<Parameters<typeof SettingsEditor>[0], "onClose">) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { onClose(); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return <div ref={root} className={styles.settingsRoot}>
    <button ref={trigger} type="button" onClick={onToggle} aria-label={open ? "Hide chart settings" : "Show chart settings"}
      aria-expanded={open} aria-controls="chart-settings" title="Chart settings"
      className={`p-1.5 rounded focus-visible:outline-2 focus-visible:outline-blue-500 ${open ? "bg-blue-50 dark:bg-zinc-800 text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-zinc-400"} hover:bg-gray-100 dark:hover:bg-zinc-800`}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 2h4l.5 2.5 1.5.6 2.1-1.4 2.8 2.8-1.4 2.1.6 1.5L22 10v4l-2.5.5-.6 1.5 1.4 2.1-2.8 2.8-2.1-1.4-1.5.6L14 22h-4l-.5-2.5-1.5-.6-2.1 1.4-2.8-2.8 1.4-2.1-.6-1.5L2 14v-4l2.5-.5.6-1.5-1.4-2.1 2.8-2.8 2.1 1.4 1.5-.6L10 2Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
    {open && <div className={`${styles.editorAnchor} ${styles.settingsAnchor}`}><SettingsEditor {...editorProps} onClose={close} /></div>}
  </div>;
}
