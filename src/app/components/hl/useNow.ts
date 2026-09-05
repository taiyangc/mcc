"use client";
import { useEffect, useState } from "react";

/**
 * A ticking clock for relative timestamps ("2m ago", funding countdowns).
 * Reading Date.now() during render is impure and would not update on its own.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
