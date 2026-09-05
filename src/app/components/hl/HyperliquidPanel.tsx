"use client";
import { useCallback, useEffect, useRef } from "react";
import HlCorePanel from "./HlCorePanel";
import HlMarketsPanel from "./HlMarketsPanel";
import HlWhaleFeedPanel from "./HlWhaleFeedPanel";
import { serializeHlPanel } from "../../lib/hl/panels";
import type { HlPanelSpec } from "../../lib/hl/panels";

interface Props {
  spec: HlPanelSpec;
  refreshKey: number;
  height: number;
  /** Writes the edited spec back into the dashboard's pair list (and the URL). */
  onPairChange?: (pair: string) => void;
}

export default function HyperliquidPanel({ spec, refreshKey, height, onPairChange }: Props) {
  // The callback is recreated on every page render and captures the cell index, so it is
  // read through a ref: a debounced control must never write to a stale index. The ref is
  // updated after commit, so onSpecChange stays stable across renders.
  const changeRef = useRef(onPairChange);
  useEffect(() => {
    changeRef.current = onPairChange;
  }, [onPairChange]);

  const onSpecChange = useCallback((next: HlPanelSpec) => {
    changeRef.current?.(serializeHlPanel(next));
  }, []);

  switch (spec.kind) {
    case "core":
      return (
        <HlCorePanel spec={spec} refreshKey={refreshKey} height={height} onSpecChange={onSpecChange} />
      );
    case "markets":
      return (
        <HlMarketsPanel spec={spec} refreshKey={refreshKey} height={height} onSpecChange={onSpecChange} />
      );
    case "whales":
      return (
        <HlWhaleFeedPanel spec={spec} refreshKey={refreshKey} height={height} onSpecChange={onSpecChange} />
      );
  }
}
