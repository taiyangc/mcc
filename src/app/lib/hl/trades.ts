// Folding Hyperliquid's fill stream back into orders.
//
// The `trades` websocket channel reports one entry per maker/taker match, not one per
// order: a market order that sweeps the book arrives as a burst of small fills sharing
// the transaction hash of the aggressing order. A size filter applied per fill therefore
// never fires at whale thresholds. Three minutes on the twenty largest markets carried
// 4,145 fills, none above $1M and the largest $392K, yet those same fills added up to a
// $2.7M ETH buy (266 fills) and a $1.5M ETH sell (56 fills) — exactly the orders a whale
// tracker exists to show. Fills are folded back into their order, and thresholds apply
// to the order.

export type TradeSide = "buy" | "sell";

/** One maker/taker match, as it arrives on the websocket. */
export interface WsFill {
  coin: string;
  /** The aggressor's side. */
  side: TradeSide;
  px: number;
  sz: number;
  notionalUsd: number;
  time: number;
  tid: number;
  /** Transaction hash of the aggressing order, shared by every fill it caused. */
  hash: string;
  /** The two counterparties, as [buyer, seller]. */
  users: string[];
}

/** What a run of fills adds up to. */
export interface AggregatedTrade {
  /** Stable for the order's whole life, so a row keeps its identity as fills land. */
  id: string;
  coin: string;
  side: TradeSide;
  /** Notional-weighted average fill price: what the order actually paid. */
  px: number;
  sz: number;
  notionalUsd: number;
  /** Earliest fill seen for the order. */
  time: number;
  fills: number;
  /** The aggressor, or null when the feed does not name one. */
  taker: string | null;
}

/** Orders held open for late fills. An order's fills land together, so this is generous. */
const RECENT_ORDERS = 500;
/** Orders retained for display. Whale-sized orders are rare; this is tens of minutes. */
const KEPT_ORDERS = 1000;

/**
 * A fifth of all fills carry an all-zero hash. Grouping those would fuse unrelated
 * trades into one phantom whale, so they are treated as orders of their own.
 */
function isPlaceholderHash(hash: string): boolean {
  return !hash || /^0x0*$/.test(hash);
}

/**
 * Identity of the order a fill belongs to. One transaction can touch more than one
 * market, so the market and side are part of the key.
 */
export function orderKey(fill: WsFill): string {
  if (isPlaceholderHash(fill.hash)) return `tid:${fill.tid}`;
  return `${fill.hash}|${fill.coin}|${fill.side}`;
}

/** `users` is [buyer, seller], so `side` — the aggressor's side — picks the taker out. */
function takerOf(fill: WsFill): string | null {
  return (fill.side === "buy" ? fill.users[0] : fill.users[1]) ?? null;
}

/**
 * Rolling fill-to-order aggregator for one set of markets.
 *
 * Two windows are kept. Every recent order stays open so a straggling fill still lands
 * on the order it belongs to, while orders that reach `keepMinUsd` are retained far
 * longer — otherwise the dust flowing through a busy market would push a $1M sweep off
 * the list within a minute of it happening.
 *
 * Orders are mutated in place: a row already on screen grows as the rest of its fills
 * arrive, rather than appearing again as a second, larger trade.
 */
export class TradeAggregator {
  private recent = new Map<string, AggregatedTrade>();
  /** Oldest first; `snapshot` walks it backwards. */
  private kept: AggregatedTrade[] = [];
  private keptSet = new WeakSet<AggregatedTrade>();
  private keepMinUsd: number;
  /** Every fill taken in, including those too small to keep. */
  seen = 0;

  constructor(keepMinUsd: number) {
    this.keepMinUsd = keepMinUsd;
  }

  add(fill: WsFill): void {
    this.seen += 1;

    const id = orderKey(fill);
    let order = this.recent.get(id);
    if (order) {
      order.sz += fill.sz;
      order.notionalUsd += fill.notionalUsd;
      order.fills += 1;
      if (order.sz > 0) order.px = order.notionalUsd / order.sz;
      if (fill.time < order.time) order.time = fill.time;
    } else {
      order = {
        id,
        coin: fill.coin,
        side: fill.side,
        px: fill.px,
        sz: fill.sz,
        notionalUsd: fill.notionalUsd,
        time: fill.time,
        fills: 1,
        taker: takerOf(fill),
      };
      this.recent.set(id, order);
      // Map iterates in insertion order, so the front of it is the oldest order.
      while (this.recent.size > RECENT_ORDERS) {
        const oldest = this.recent.keys().next();
        if (oldest.done) break;
        this.recent.delete(oldest.value);
      }
    }

    // An order joins the display list on the fill that first carries it over the floor,
    // and keeps growing there because the list holds the same object.
    if (order.notionalUsd >= this.keepMinUsd && !this.keptSet.has(order)) {
      this.keptSet.add(order);
      this.kept.push(order);
      if (this.kept.length > KEPT_ORDERS) this.kept.splice(0, this.kept.length - KEPT_ORDERS);
    }
  }

  /** Every kept order, newest first, as values the caller can hold on to. */
  snapshot(): AggregatedTrade[] {
    const orders: AggregatedTrade[] = [];
    for (let i = this.kept.length - 1; i >= 0; i--) {
      const order = this.kept[i];
      // Only an order still open for fills can change under the caller. The rest are
      // final, so they are handed out as they are rather than copied every flush.
      orders.push(this.recent.has(order.id) ? { ...order } : order);
    }
    return orders;
  }
}
