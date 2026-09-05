// Server-side Hyperliquid API client: request helper, rate-limit ledger, TTL cache.
//
// Hyperliquid allows 1200 weight/minute per IP. On localhost the Next server and
// the browser share that IP, so every server-side caller goes through the same
// ledger and leaves headroom for the browser's own direct calls.

export const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
export const HL_LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

/** Documented weights: 2 for the cheap per-user/book requests, 20 for everything else. */
export const WEIGHT_CHEAP = 2;
export const WEIGHT_DEFAULT = 20;

const WINDOW_MS = 60_000;
/** Leave ~300 of the 1200/min budget for the browser's direct calls. */
const WINDOW_BUDGET = 900;

interface LedgerState {
  spends: Array<{ t: number; w: number }>;
}

interface GlobalHlState {
  ledger: LedgerState;
  caches: Map<string, TtlCache<unknown>>;
}

// Module-level state is per bundle chunk and is discarded by dev HMR, so the shared
// pieces live on globalThis under a versioned key.
const GLOBAL_KEY = "__mccHlState_v1";

function globalState(): GlobalHlState {
  const g = globalThis as unknown as Record<string, GlobalHlState | undefined>;
  let state = g[GLOBAL_KEY];
  if (!state) {
    state = { ledger: { spends: [] }, caches: new Map() };
    g[GLOBAL_KEY] = state;
  }
  return state;
}

function prune(ledger: LedgerState, now: number): void {
  while (ledger.spends.length > 0 && now - ledger.spends[0].t > WINDOW_MS) {
    ledger.spends.shift();
  }
}

/** Weight spent in the trailing 60s window. */
export function spentWeight(): number {
  const ledger = globalState().ledger;
  prune(ledger, Date.now());
  return ledger.spends.reduce((sum, s) => sum + s.w, 0);
}

/** Reserve budget for a request. Returns false when the window is exhausted. */
export function reserveWeight(weight: number): boolean {
  const ledger = globalState().ledger;
  const now = Date.now();
  prune(ledger, now);
  const spent = ledger.spends.reduce((sum, s) => sum + s.w, 0);
  if (spent + weight > WINDOW_BUDGET) return false;
  ledger.spends.push({ t: now, w: weight });
  return true;
}

/** How much of the window budget is still free. */
export function remainingWeight(): number {
  return Math.max(0, WINDOW_BUDGET - spentWeight());
}

export class RateLimitError extends Error {
  constructor(message = "Hyperliquid rate limit reached") {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface HlInfoOptions {
  /** Documented request weight; defaults to 20 (the weight of most info requests). */
  weight?: number;
  timeoutMs?: number;
  /** Skip the ledger check (used for the one-off leaderboard fetch, which is a different host). */
  skipLedger?: boolean;
}

/**
 * POST to the Hyperliquid info endpoint.
 * Throws RateLimitError when the local ledger or the server says we are over budget;
 * returns null for any other failure so callers can keep their previous snapshot.
 */
export async function hlInfo<T>(body: unknown, options: HlInfoOptions = {}): Promise<T | null> {
  const { weight = WEIGHT_DEFAULT, timeoutMs = 8000, skipLedger = false } = options;
  if (!skipLedger && !reserveWeight(weight)) {
    throw new RateLimitError("local weight budget exhausted");
  }
  try {
    const res = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) throw new RateLimitError();
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    return null;
  }
}

/** Run `fn` over `items` with at most `concurrency` in flight, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

/**
 * TTL cache that collapses concurrent misses onto one in-flight promise, so a burst
 * of panel requests produces a single upstream call.
 */
export class TtlCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private inFlight = new Map<string, Promise<T>>();

  constructor(private ttlMs: number, private maxEntries = 64) {}

  peek(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return entry.value;
  }

  isFresh(key: string): boolean {
    const entry = this.entries.get(key);
    return !!entry && entry.expires > Date.now();
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  /** Returns the cached value when fresh, otherwise awaits (and shares) one loader call. */
  async get(key: string, loader: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expires > Date.now()) return entry.value;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = loader()
      .then(value => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }
}

/** A TtlCache that survives dev HMR, keyed by name. */
export function sharedCache<T>(name: string, ttlMs: number, maxEntries = 64): TtlCache<T> {
  const caches = globalState().caches;
  const existing = caches.get(name);
  if (existing) return existing as TtlCache<T>;
  const created = new TtlCache<T>(ttlMs, maxEntries);
  caches.set(name, created as TtlCache<unknown>);
  return created;
}

/** Fixed-size ring buffer for time series and event feeds. */
export class RingBuffer<T> {
  private items: T[] = [];
  constructor(private capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  pushMany(items: T[]): void {
    for (const item of items) this.push(item);
  }

  get length(): number {
    return this.items.length;
  }

  last(): T | undefined {
    return this.items[this.items.length - 1];
  }

  toArray(): T[] {
    return this.items.slice();
  }

  /** Most recent `n` items, oldest first. */
  recent(n: number): T[] {
    return this.items.slice(Math.max(0, this.items.length - n));
  }
}
