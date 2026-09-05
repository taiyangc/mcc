"use client";
import { useCallback, useEffect, useRef } from "react";
import HlPositioningPanel from "./HlPositioningPanel";
import HlWhaleFeedPanel from "./HlWhaleFeedPanel";
import HlFundingPanel from "./HlFundingPanel";
import HlLongShortPanel from "./HlLongShortPanel";
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
    case "oi":
    case "margin":
      return (
        <HlPositioningPanel
          spec={spec}
          refreshKey={refreshKey}
          height={height}
          onSpecChange={onSpecChange}
        />
      );
    case "whales":
      return (
        <HlWhaleFeedPanel
          spec={spec}
          refreshKey={refreshKey}
          height={height}
          onSpecChange={onSpecChange}
        />
      );
    case "funding":
      return (
        <HlFundingPanel
          spec={spec}
          refreshKey={refreshKey}
          height={height}
          onSpecChange={onSpecChange}
        />
      );
    case "longshort":
      return (
        <HlLongShortPanel
          spec={spec}
          refreshKey={refreshKey}
          height={height}
          onSpecChange={onSpecChange}
        />
      );
  }
}
