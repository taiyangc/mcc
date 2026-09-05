"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";

// Several panels can point at the same route (all four cohort panels share /whales),
// so requests are shared per URL: one in-flight fetch, one parsed copy, many readers.
// The cache is an external store, which lets components read it during render without
// a synchronising effect.

export interface PolledSnapshot<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface Entry<T> {
  snapshot: PolledSnapshot<T>;
  fetchedAt: number;
  inFlight: Promise<T> | null;
  listeners: Set<() => void>;
}

const EMPTY: PolledSnapshot<unknown> = { data: null, error: null, loading: true };
const store = new Map<string, Entry<unknown>>();

function entryFor<T>(url: string): Entry<T> {
  let entry = store.get(url) as Entry<T> | undefined;
  if (!entry) {
    entry = {
      snapshot: EMPTY as PolledSnapshot<T>,
      fetchedAt: 0,
      inFlight: null,
      listeners: new Set(),
    };
    store.set(url, entry as Entry<unknown>);
  }
  return entry;
}

function publish<T>(entry: Entry<T>, snapshot: PolledSnapshot<T>): void {
  entry.snapshot = snapshot;
  entry.listeners.forEach(fn => fn());
}

function load<T>(url: string, force: boolean): void {
  const entry = entryFor<T>(url);
  if (entry.inFlight) return;
  // Collapse the burst of calls that happens when several panels mount at once.
  if (!force && entry.snapshot.data !== null && Date.now() - entry.fetchedAt < 2000) return;

  entry.inFlight = (async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) detail = body.error;
      } catch {
        // Non-JSON error body; the status is enough.
      }
      throw new Error(detail);
    }
    return (await res.json()) as T;
  })()
    .then(value => {
      entry.fetchedAt = Date.now();
      publish(entry, { data: value, error: null, loading: false });
      return value;
    })
    .catch(err => {
      const message = err instanceof Error ? err.message : "Request failed";
      // Keep the last good value: a transient failure should not blank a live panel.
      publish(entry, { data: entry.snapshot.data, error: message, loading: false });
      throw err;
    })
    .finally(() => {
      entry.inFlight = null;
    }) as Promise<T>;

  entry.inFlight.catch(() => undefined);
}

export interface PolledJson<T> extends PolledSnapshot<T> {
  refresh: () => void;
}

/**
 * Fetch JSON from `url`, refetching whenever `refreshKey` changes.
 *
 * Polling cadence is owned by the dashboard: the page's global tick bumps refreshKey at
 * each cell's configured interval, so this hook holds no timer of its own.
 */
export function usePolledJson<T>(url: string | null, refreshKey: number): PolledJson<T> {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!url) return () => undefined;
      const entry = entryFor<T>(url);
      entry.listeners.add(onChange);
      return () => {
        entry.listeners.delete(onChange);
      };
    },
    [url],
  );

  const getSnapshot = useCallback(
    () => (url ? entryFor<T>(url).snapshot : (EMPTY as PolledSnapshot<T>)),
    [url],
  );

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY as PolledSnapshot<T>,
  );

  useEffect(() => {
    if (!url) return;
    load<T>(url, refreshKey > 0);
  }, [url, refreshKey]);

  const refresh = useCallback(() => {
    if (url) load<T>(url, true);
  }, [url]);

  return { ...snapshot, refresh };
}
