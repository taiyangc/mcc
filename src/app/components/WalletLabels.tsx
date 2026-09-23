"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { truncateAddress } from "../lib/format";
import type { WalletLabels } from "../lib/hl/walletLabels";

const EMPTY_LABELS: WalletLabels = {};
const WalletLabelsContext = createContext<WalletLabels>(EMPTY_LABELS);

// This promise lives for the browser document, including Strict Mode replays and
// component remounts. A full page load creates a new module and a fresh request.
// Keep failures too: no widget refresh, focus event or timer retries the download.
let pageLabels: Promise<WalletLabels> | null = null;

function loadPageLabels(): Promise<WalletLabels> {
  pageLabels ??= fetch("/api/hyperliquid/wallet-labels", {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  })
    .then(async res => {
      if (!res.ok) return EMPTY_LABELS;
      const body: { labels: WalletLabels } = await res.json();
      return body.labels ?? EMPTY_LABELS;
    })
    .catch(() => EMPTY_LABELS);
  return pageLabels;
}

export function WalletLabelsProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState(EMPTY_LABELS);

  useEffect(() => {
    let active = true;
    void loadPageLabels().then(next => {
      if (active) setLabels(next);
    });
    return () => { active = false; };
  }, []);

  return <WalletLabelsContext.Provider value={labels}>{children}</WalletLabelsContext.Provider>;
}

export function WalletLink({ address, title, className = "" }: {
  address: string;
  title?: string;
  className?: string;
}) {
  const labels = useContext(WalletLabelsContext);
  const label = labels[address.toLowerCase()];
  const source = label?.source === "hypurrscan" ? "HypurrScan" : "Hyperliquid leaderboard";
  const tooltip = [
    label ? `${label.name} · ${source} alias` : null,
    address,
    title,
  ].filter(Boolean).join("\n");

  return (
    <a
      href={`https://hypurrscan.io/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      className={`inline-block max-w-full truncate align-bottom hover:underline ${className}`}
    >
      {label?.name ?? truncateAddress(address)}
    </a>
  );
}
