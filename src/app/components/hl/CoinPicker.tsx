"use client";
import { useMemo, useState } from "react";
import type { PanelTheme } from "./panelTheme";
import { MAJOR_COIN_CHOICES } from "../../lib/hl/panels";

interface CoinPickerProps {
  selected: string[];
  onChange: (coins: string[]) => void;
  /** Extra choices, typically the top coins by open interest. */
  suggestions?: string[];
  theme: PanelTheme;
  max?: number;
  /** Label shown when nothing is explicitly selected (e.g. "following the top markets"). */
  emptyLabel?: string;
}

/** Chip multi-select for the coin list a panel shows. */
export default function CoinPicker({
  selected,
  onChange,
  suggestions = [],
  theme,
  max = 12,
  emptyLabel,
}: CoinPickerProps) {
  const [open, setOpen] = useState(false);

  const choices = useMemo(() => {
    const all = [...MAJOR_COIN_CHOICES, ...suggestions, ...selected];
    return all.filter((c, i) => all.indexOf(c) === i);
  }, [suggestions, selected]);

  const toggle = (coin: string) => {
    if (selected.includes(coin)) {
      if (selected.length === 1) return; // never leave the panel with nothing to show
      onChange(selected.filter(c => c !== coin));
    } else {
      if (selected.length >= max) return;
      onChange([...selected, coin]);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`${theme.select} flex items-center gap-1`}
        title="Choose which markets this panel shows"
      >
        {selected.length === 0 && emptyLabel
          ? emptyLabel
          : `${selected.length} coin${selected.length === 1 ? "" : "s"}`}
        <span className="opacity-60">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-20 mt-1 p-2 rounded border shadow-lg ${theme.headerBg} ${theme.border} w-56 max-h-56 overflow-y-auto`}
          >
            <div className="flex flex-wrap gap-1">
              {choices.map(coin => {
                const active = selected.includes(coin);
                return (
                  <button
                    key={coin}
                    type="button"
                    onClick={() => toggle(coin)}
                    className={`px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors ${
                      active ? theme.chipActive : theme.chip
                    }`}
                  >
                    {coin}
                  </button>
                );
              })}
            </div>
            <div className={`mt-2 text-[9px] ${theme.secondaryText}`}>
              Up to {max} markets.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
