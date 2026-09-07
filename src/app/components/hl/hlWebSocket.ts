"use client";
// One websocket per tab to Hyperliquid, shared by every panel that wants a trade feed.
//
// Hyperliquid has no all-coins trades subscription, so each coin is a separate
// subscription and they are reference counted: the socket opens on the first
// subscriber, resubscribes after a reconnect, and closes once the last one leaves.
//
// The channel carries fills rather than orders; TradeAggregator folds them back into
// the orders that caused them.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { TradeAggregator } from "../../lib/hl/trades";
import { WHALE_MIN_USD_CHOICES } from "../../lib/hl/panels";
import type { AggregatedTrade, WsFill } from "../../lib/hl/trades";

export type { AggregatedTrade, WsFill };

type StatusListener = (status: ConnectionStatus) => void;
export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

const WS_URL = "wss://api.hyperliquid.xyz/ws";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
/** Keep the socket briefly after the last unsubscribe so a remount reuses it. */
const LINGER_MS = 2000;
const PING_INTERVAL_MS = 30_000;
/** Hyperliquid drops a connection that has been silent; reconnect before it does. */
const SILENCE_LIMIT_MS = 60_000;

interface HubState {
  socket: WebSocket | null;
  status: ConnectionStatus;
  counts: Map<string, number>;
  /** One aggregated feed per market set, keyed by the joined coin list. */
  feeds: Map<string, FeedState>;
  statusListeners: Set<StatusListener>;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lingerTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  lastMessageAt: number;
  intentionallyClosed: boolean;
  visibilityBound: boolean;
  hiddenClosed: boolean;
}

// Versioned: a dev reload must not hand back a hub built to an older shape.
const HUB_KEY = "__mccHlWsHub_v2";

function hub(): HubState {
  const w = globalThis as unknown as Record<string, HubState | undefined>;
  let state = w[HUB_KEY];
  if (!state) {
    state = {
      socket: null,
      status: "idle",
      counts: new Map(),
      feeds: new Map(),
      statusListeners: new Set(),
      reconnectAttempts: 0,
      reconnectTimer: null,
      lingerTimer: null,
      pingTimer: null,
      lastMessageAt: 0,
      intentionallyClosed: false,
      visibilityBound: false,
      hiddenClosed: false,
    };
    w[HUB_KEY] = state;
  }
  return state;
}

const FLUSH_MS = 250;
/** Rows handed to a panel. */
const MAX_ROWS = 200;
/**
 * Orders under the smallest threshold the whale panel offers are dust: their fills are
 * still aggregated, so an order can grow past the floor, but they are not retained.
 * Retaining them would push the rare large orders off the list within a minute.
 */
const KEEP_MIN_USD = Math.min(...WHALE_MIN_USD_CHOICES);

export interface TradeSnapshot {
  /** Retained orders, newest first. */
  orders: AggregatedTrade[];
  /** Every fill received for these markets, including those too small to keep. */
  seen: number;
}

const EMPTY_SNAPSHOT: TradeSnapshot = { orders: [], seen: 0 };

interface FeedState {
  coins: Set<string>;
  aggregator: TradeAggregator;
  /** Replaced on flush: its identity is what tells React the feed moved on. */
  snapshot: TradeSnapshot;
  listeners: Set<() => void>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  subscribers: number;
}

/** The feed for a market set, shared by every panel watching the same one. */
function feedFor(key: string): FeedState {
  const h = hub();
  let feed = h.feeds.get(key);
  if (!feed) {
    feed = {
      coins: new Set(key.split("-").filter(Boolean)),
      aggregator: new TradeAggregator(KEEP_MIN_USD),
      snapshot: EMPTY_SNAPSHOT,
      listeners: new Set(),
      flushTimer: null,
      subscribers: 0,
    };
    h.feeds.set(key, feed);
  }
  return feed;
}

/** Bursts are coalesced into one snapshot per window, so a busy market renders once. */
function scheduleFlush(feed: FeedState): void {
  if (feed.flushTimer) return;
  feed.flushTimer = setTimeout(() => {
    feed.flushTimer = null;
    feed.snapshot = { orders: feed.aggregator.snapshot(), seen: feed.aggregator.seen };
    feed.listeners.forEach(fn => fn());
  }, FLUSH_MS);
}

function dispatchFills(fills: WsFill[]): void {
  const h = hub();
  for (const [key, feed] of h.feeds) {
    // A render can create a feed that never goes on to mount. With nothing to notify it
    // would accumulate orders no one reads, so it is dropped instead.
    if (feed.subscribers === 0 && feed.listeners.size === 0) {
      if (feed.flushTimer) clearTimeout(feed.flushTimer);
      h.feeds.delete(key);
      continue;
    }
    let touched = false;
    for (const fill of fills) {
      if (!feed.coins.has(fill.coin)) continue;
      feed.aggregator.add(fill);
      touched = true;
    }
    if (touched) scheduleFlush(feed);
  }
}

function setStatus(status: ConnectionStatus): void {
  const h = hub();
  if (h.status === status) return;
  h.status = status;
  h.statusListeners.forEach(fn => fn(status));
}

function send(message: unknown): void {
  const h = hub();
  if (h.socket && h.socket.readyState === WebSocket.OPEN) {
    h.socket.send(JSON.stringify(message));
  }
}

function subscribeMessage(coin: string, subscribe: boolean) {
  return {
    method: subscribe ? "subscribe" : "unsubscribe",
    subscription: { type: "trades", coin },
  };
}

function clearTimers(h: HubState): void {
  if (h.reconnectTimer) {
    clearTimeout(h.reconnectTimer);
    h.reconnectTimer = null;
  }
  if (h.pingTimer) {
    clearInterval(h.pingTimer);
    h.pingTimer = null;
  }
}

function closeSocket(intentional: boolean): void {
  const h = hub();
  h.intentionallyClosed = intentional;
  clearTimers(h);
  if (h.socket) {
    const socket = h.socket;
    h.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closing.
    }
  }
  setStatus(intentional ? "idle" : "closed");
}

function scheduleReconnect(): void {
  const h = hub();
  if (h.intentionallyClosed || h.counts.size === 0 || h.reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** h.reconnectAttempts, RECONNECT_MAX_MS);
  h.reconnectAttempts += 1;
  h.reconnectTimer = setTimeout(() => {
    h.reconnectTimer = null;
    openSocket();
  }, delay);
}

function handleMessage(event: MessageEvent): void {
  const h = hub();
  h.lastMessageAt = Date.now();
  let payload: { channel?: string; data?: unknown };
  try {
    payload = JSON.parse(event.data as string);
  } catch {
    return;
  }
  if (payload.channel !== "trades" || !Array.isArray(payload.data)) return;

  const fills: WsFill[] = [];
  for (const raw of payload.data as Array<Record<string, unknown>>) {
    const px = parseFloat(String(raw.px));
    const sz = parseFloat(String(raw.sz));
    if (!Number.isFinite(px) || !Number.isFinite(sz)) continue;
    fills.push({
      coin: String(raw.coin),
      // "B" means the buyer was the aggressor.
      side: raw.side === "B" ? "buy" : "sell",
      px,
      sz,
      notionalUsd: px * sz,
      time: Number(raw.time) || Date.now(),
      tid: Number(raw.tid) || 0,
      hash: typeof raw.hash === "string" ? raw.hash : "",
      users: Array.isArray(raw.users) ? (raw.users as string[]) : [],
    });
  }
  if (fills.length > 0) dispatchFills(fills);
}

function openSocket(): void {
  const h = hub();
  if (h.socket || h.counts.size === 0) return;
  if (typeof window === "undefined") return;
  if (typeof document !== "undefined" && document.hidden) {
    h.hiddenClosed = true;
    return;
  }

  h.intentionallyClosed = false;
  setStatus("connecting");
  let socket: WebSocket;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  h.socket = socket;

  socket.onopen = () => {
    if (hub().socket !== socket) return;
    h.reconnectAttempts = 0;
    h.lastMessageAt = Date.now();
    setStatus("open");
    for (const coin of h.counts.keys()) send(subscribeMessage(coin, true));
    h.pingTimer = setInterval(() => {
      if (Date.now() - h.lastMessageAt > SILENCE_LIMIT_MS) {
        closeSocket(false);
        scheduleReconnect();
        return;
      }
      send({ method: "ping" });
    }, PING_INTERVAL_MS);
  };

  socket.onmessage = handleMessage;

  socket.onerror = () => {
    if (hub().socket !== socket) return;
    // onclose follows; reconnection is handled there.
  };

  socket.onclose = () => {
    if (hub().socket !== socket) return;
    h.socket = null;
    clearTimers(h);
    setStatus("closed");
    scheduleReconnect();
  };
}

function bindVisibility(): void {
  const h = hub();
  if (h.visibilityBound || typeof document === "undefined") return;
  h.visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    const state = hub();
    if (document.hidden) {
      if (state.socket || state.status === "connecting") {
        state.hiddenClosed = true;
        closeSocket(true);
      }
    } else if (state.hiddenClosed && state.counts.size > 0) {
      state.hiddenClosed = false;
      state.reconnectAttempts = 0;
      openSocket();
    }
  });
}

function acquire(coins: string[]): void {
  const h = hub();
  if (h.lingerTimer) {
    clearTimeout(h.lingerTimer);
    h.lingerTimer = null;
  }
  bindVisibility();
  for (const coin of coins) {
    const next = (h.counts.get(coin) ?? 0) + 1;
    h.counts.set(coin, next);
    if (next === 1 && h.socket && h.socket.readyState === WebSocket.OPEN) {
      send(subscribeMessage(coin, true));
    }
  }
  if (!h.socket) openSocket();
}

function release(coins: string[]): void {
  const h = hub();
  for (const coin of coins) {
    const next = (h.counts.get(coin) ?? 1) - 1;
    if (next <= 0) {
      h.counts.delete(coin);
      send(subscribeMessage(coin, false));
    } else {
      h.counts.set(coin, next);
    }
  }
  if (h.counts.size === 0 && !h.lingerTimer) {
    // Linger briefly: React's development double-mount would otherwise tear the
    // socket down and immediately rebuild it.
    h.lingerTimer = setTimeout(() => {
      h.lingerTimer = null;
      if (hub().counts.size === 0) closeSocket(true);
    }, LINGER_MS);
  }
}

export interface TradeFeed {
  /** Orders at or above `minUsd`, newest first. */
  trades: AggregatedTrade[];
  status: ConnectionStatus;
  /** Every fill received for the subscribed markets, including those below the filter. */
  seen: number;
  /** Biggest retained order, so an empty list can say whether the threshold is the reason. */
  largestUsd: number;
}

/**
 * Live orders for `coins` above `minUsd`.
 *
 * The threshold is applied here rather than on the way in, so moving it re-filters what
 * is already on screen instead of only affecting orders that arrive afterwards.
 */
export function useHlTrades(coins: string[], minUsd: number): TradeFeed {
  const key = coins.join("-");

  // Both the feed and the connection state live in the hub and are read as external
  // stores, rather than being mirrored into component state by an effect.
  const subscribeFeed = useCallback(
    (onChange: () => void) => {
      if (!key) return () => undefined;
      const feed = feedFor(key);
      feed.listeners.add(onChange);
      return () => {
        feed.listeners.delete(onChange);
      };
    },
    [key],
  );
  const getSnapshot = useCallback(() => (key ? feedFor(key).snapshot : EMPTY_SNAPSHOT), [key]);
  const snapshot = useSyncExternalStore(subscribeFeed, getSnapshot, () => EMPTY_SNAPSHOT);

  const subscribeStatus = useCallback((onChange: () => void) => {
    const h = hub();
    const listener: StatusListener = () => onChange();
    h.statusListeners.add(listener);
    return () => {
      h.statusListeners.delete(listener);
    };
  }, []);
  const status = useSyncExternalStore(
    subscribeStatus,
    () => hub().status,
    () => "idle" as ConnectionStatus,
  );

  useEffect(() => {
    const list = key ? key.split("-").filter(Boolean) : [];
    if (list.length === 0) return;
    const feed = feedFor(key);
    feed.subscribers += 1;
    acquire(list);

    return () => {
      feed.subscribers -= 1;
      // The last panel watching these markets takes the accumulated orders with it.
      if (feed.subscribers <= 0) {
        if (feed.flushTimer) clearTimeout(feed.flushTimer);
        hub().feeds.delete(key);
      }
      release(list);
    };
  }, [key]);

  const { trades, largestUsd } = useMemo(() => {
    const rows: AggregatedTrade[] = [];
    let largest = 0;
    for (const order of snapshot.orders) {
      if (order.notionalUsd > largest) largest = order.notionalUsd;
      if (order.notionalUsd >= minUsd && rows.length < MAX_ROWS) rows.push(order);
    }
    return { trades: rows, largestUsd: largest };
  }, [snapshot.orders, minUsd]);

  return { trades, status, seen: snapshot.seen, largestUsd };
}
