"use client";
// One websocket per tab to Hyperliquid, shared by every panel that wants a trade feed.
//
// Hyperliquid has no all-coins trades subscription, so each coin is a separate
// subscription and they are reference counted: the socket opens on the first
// subscriber, resubscribes after a reconnect, and closes once the last one leaves.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface WsTrade {
  coin: string;
  side: "buy" | "sell";
  px: number;
  sz: number;
  notionalUsd: number;
  time: number;
  tid: number;
  users: string[];
}

type TradeListener = (trades: WsTrade[]) => void;
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
  tradeListeners: Set<TradeListener>;
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

const HUB_KEY = "__mccHlWsHub_v1";

function hub(): HubState {
  const w = globalThis as unknown as Record<string, HubState | undefined>;
  let state = w[HUB_KEY];
  if (!state) {
    state = {
      socket: null,
      status: "idle",
      counts: new Map(),
      tradeListeners: new Set(),
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

  const trades: WsTrade[] = [];
  for (const raw of payload.data as Array<Record<string, unknown>>) {
    const px = parseFloat(String(raw.px));
    const sz = parseFloat(String(raw.sz));
    if (!Number.isFinite(px) || !Number.isFinite(sz)) continue;
    trades.push({
      coin: String(raw.coin),
      // "B" means the buyer was the aggressor.
      side: raw.side === "B" ? "buy" : "sell",
      px,
      sz,
      notionalUsd: px * sz,
      time: Number(raw.time) || Date.now(),
      tid: Number(raw.tid) || 0,
      users: Array.isArray(raw.users) ? (raw.users as string[]) : [],
    });
  }
  if (trades.length > 0) h.tradeListeners.forEach(fn => fn(trades));
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

const MAX_BUFFER = 200;
const FLUSH_MS = 250;

interface Feed {
  key: string;
  trades: WsTrade[];
  seen: number;
}

const EMPTY_FEED: Feed = { key: "", trades: [], seen: 0 };

export interface TradeFeed {
  trades: WsTrade[];
  status: ConnectionStatus;
  /** Every trade received for the subscribed markets, including those below the filter. */
  seen: number;
}

/** Live trades for `coins` above `minUsd`, batched so bursts cause one render. */
export function useHlTrades(coins: string[], minUsd: number): TradeFeed {
  const key = coins.join("-");
  // Trades and the seen-counter move together and are tagged with the coin set they
  // belong to, so switching markets needs no reset: a stale tag is simply ignored.
  const [feed, setFeed] = useState<Feed>(() => ({ key, trades: [], seen: 0 }));

  // Connection state lives in the hub, so it is read as an external store rather than
  // mirrored into component state by an effect.
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

  const minUsdRef = useRef(minUsd);
  useEffect(() => {
    minUsdRef.current = minUsd;
  }, [minUsd]);

  useEffect(() => {
    const list = key ? key.split("-").filter(Boolean) : [];
    if (list.length === 0) return;

    let pending: WsTrade[] = [];
    let pendingSeen = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    // Bursts are coalesced into one state update per flush window, so a busy market
    // cannot drive a render per message.
    const flush = () => {
      flushTimer = null;
      if (pendingSeen === 0 && pending.length === 0) return;
      const count = pendingSeen;
      const batch = pending;
      pendingSeen = 0;
      pending = [];
      setFeed(prev => {
        const base = prev.key === key ? prev : { key, trades: [], seen: 0 };
        return {
          key,
          trades: batch.length > 0
            ? [...batch.reverse(), ...base.trades].slice(0, MAX_BUFFER)
            : base.trades,
          seen: base.seen + count,
        };
      });
    };

    const onTrades: TradeListener = incoming => {
      const mine = incoming.filter(t => list.includes(t.coin));
      if (mine.length === 0) return;
      pendingSeen += mine.length;
      const wanted = mine.filter(t => t.notionalUsd >= minUsdRef.current);
      pending.push(...wanted);
      if (pending.length > MAX_BUFFER) pending = pending.slice(-MAX_BUFFER);
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    };

    const h = hub();
    h.tradeListeners.add(onTrades);
    acquire(list);

    return () => {
      const state = hub();
      state.tradeListeners.delete(onTrades);
      if (flushTimer) clearTimeout(flushTimer);
      release(list);
    };
  }, [key]);

  const current = feed.key === key ? feed : EMPTY_FEED;
  return { trades: current.trades, status, seen: current.seen };
}
