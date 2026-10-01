# mcc

Modern multicoincharts.com rebuilt with next.js

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Other scripts: `npm run build` (also type checks), `npm run lint`, `npm test`.

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Header asset trends

Small quote cards flank the title: US10Y and DXY on the left, BTC and ETH on the
right. Click a card or **Edit** to change symbols in place, reorder them, add up to
four per side, or remove all cards from a side. The preset picker is grouped into
**Rates**, **Indices**, **FX**, **Commodities**, and **Crypto**. Select an input, then
choose a preset to replace that market; **Add market** creates another slot.
Each market has a **Source** selector listing the supported feeds. The source
appears on its card, and the selection persists in saved preferences and shared
URLs. A single-source market shows its source without offering a switch.
Custom entries use Yahoo Finance symbols such as `AAPL`, `GC=F` or `EURUSD=X`.
Shortcuts such as `US02Y` (also `US2Y` and `TVC:US02Y`), `DXY` and `BTC` also work.
**Save** in chart settings or either banner editor stores one complete dashboard
on this device: charts, layout, chart intervals and refresh settings, both banner
sides, source choices, and banner display mode. Save is gray and disabled when
there are no changes; a successful save shows **Saved**. A failed storage write
shows an error and leaves Save available. Banner editors stay open after saving
so the confirmation is visible.

Returning to the base URL restores the saved dashboard. Applied settings also
remain in the shareable URL (`tl`, `tr`, `td` for the banner, `iv` for per-chart
intervals); explicit URL configuration takes precedence, including empty sides.
Saved dashboards use `mcc.dashboard.v1`. Earlier banner preferences and chart
intervals are read for migration, without overriding a newer dashboard or link.

The compact **Add Chart**, **Share Charts**, and **Settings** icons sit directly
under the title, with tooltips and accessible names. Chart layout controls start
collapsed on every page load and history navigation, even if they were open when
saved; the gear opens the dimensions, interval and symbol settings.

Choose **Change**, **Day range**, or **OHLC** beneath the title. Changes compare the
latest regular-session price with the previous close. Treasury yields display
percent yields and changes in basis points. On the range bar, the tick is the
open and the dot is the latest price.
OHLC's **C\*** is the current session's latest value, final only at session close.
Quote times appear on the cards; hover for the full timestamp, source symbol and
OHLC values. Data may be delayed by the provider.

Rates cover Treasury maturities **1m, 3m, 6m, 1y, 2y, 3y, 5y, 7y, 10y, 20y, 30y**,
plus **SOFR** and effective **Fed funds**. All Treasury presets have intraday
quotes and actual session OHLC. All maturities default to CNBC's native Tradeweb
yield quotes, keeping the curve on one source. For
example, [US02Y uses CNBC's US2Y](https://www.cnbc.com/quotes/US2Y), including
open, high, low, latest yield and previous close. Bond price fields are not used.
Earlier FRED Treasury selections and the old `^FVX`, `^TNX`, and `^TYX` defaults
migrate to CNBC automatically. US05Y, US10Y and US30Y also offer Yahoo's Cboe
yield indices, with explicit source IDs such as `YAHOO:^TNX` so the choice is
preserved. These indices and Tradeweb's benchmarks can have different sessions.

| Category | Default source | Other supported sources |
| --- | --- | --- |
| Treasury rates | CNBC / Tradeweb | Yahoo / Cboe for 5y, 10y, 30y |
| Overnight rates | FRED, daily | None |
| Indices | Yahoo Finance | CNBC |
| FX | Yahoo Finance | CNBC |
| Commodities | Yahoo Finance futures | CNBC futures from the same exchange, except Brent |
| Crypto | Yahoo Finance | CNBC / Coin Metrics |

The editor explains source differences: delays, FX/crypto daily cutoffs and
aggregation, and futures contract rolls. CNBC's ICE Brent contract is not offered
as an alternate feed for Yahoo's NYMEX Brent contract. Hover over a card for the
provider's instrument/contract name, exchange, timestamp and OHLC. Every value
in a card comes from the selected source; failures retain that source's dated
snapshot rather than silently switching providers or mixing their fields.

Only SOFR and Fed funds use daily Federal Reserve observations via FRED. These
presets are marked **†**, and their cards show **Daily · date**. Their changes
compare the last two published observations in basis points. They have no
intraday OHLC or day range, and the cards say so. The observation date stays
visible when a new reading has not yet been published.

Other macro presets include Dow, Russell 2000, DAX, FTSE, Nikkei, Hang Seng,
EUR/USD, USD/JPY, GBP/USD, AUD/USD, USD/CAD, USD/CHF, USD/CNH, silver, copper,
Brent, and natural gas, alongside the original SPX, NDX, VIX, DXY, gold and WTI.
Commodity presets refer to futures; FX presets describe the pair direction.

The banner loads no TradingView scripts, iframes, chart library or price history
into the browser. `/api/trends` requests one daily bar per symbol from Yahoo
Finance's public chart endpoint (`range=1d&interval=1d`) and returns only a quote
snapshot. CNBC returns a current quote with session OHLC without loading any
history. FRED requests cover only the last three weeks and reduce them to the
last two valid daily observations on the server; successful responses are cached
for 15 minutes. Yahoo/CNBC quotes and failed requests are cached for one minute. The
loader deduplicates requests, bounds the server
cache, and retains timestamped stale values on failures. The browser makes one
batch request per minute, pauses while hidden, and cancels requests on unmount
or symbol changes. The Yahoo/CNBC endpoints are unofficial and can be rate-limited or
unavailable; the cards show those failures instead of made-up prices.

TradingView's [Single Ticker](https://www.tradingview.com/widget-docs/widgets/tickers/single-ticker/),
[Ticker Tag](https://www.tradingview.com/widget-docs/widgets/tickers/ticker-tag/)
and [Mini Chart](https://www.tradingview.com/widget-docs/widgets/charts/mini-chart/)
were considered. Single Ticker gives price/change, Ticker Tag adds a chart popup,
and Mini Chart includes history. A live Single Ticker check rejected `TVC:US10Y`
and `TVC:DXY` as unavailable in widgets, so the header uses direct quote snapshots.

## Hyperliquid data panels

**Market Moves** tracks major OI, funding and volume changes in both directions.

Four first-party panels read public APIs directly instead of embedding third-party
pages. Each is a cell in the grid, encoded as one entry in the URL's `pairs` list:

| Pair string | Panel |
| --- | --- |
| `HLCORE:<cohort>` | Exchange overview: open interest, volume, margin, leverage, long vs short |
| `HLMARKETS:<coins>:<cohort>` | One row per market, with funding on every venue beside trader positioning |
| `HLWHALES:<minUsd>:<coins>` | Tracked-wallet position changes and biggest open positions |
| `HLMOVES:<window>:<metric>:<layout>:<coins>:<direction>` | Ranked market move events or one row per pair |

`<coins>` is either `TOP`, which follows the largest markets by open interest, or a
list joined with `-` (`,` separates cells in the URL). Coin names keep their case,
since Hyperliquid lists `kPEPE`, `kBONK` and `kSHIB`. Cohorts are `ALL`, `VOL`
(highest 24h volume), `PNL` (highest 30d PnL, shown as "smart money") and `WHALE` (an
open position of $1M or more).

Funding and positioning share the markets table because they are read together:
funding is what a position costs to hold. Columns are sortable, and each funding cell
shows the annualized rate with its raw value and next settlement on hover.

Add **Market Moves** from **Add Chart → Hyperliquid**. Its default is
`HLMOVES:15m:ALL:EVENTS:TOP:BOTH`: 15-minute changes across 12 liquid default-DEX
markets selected by recent open interest. Choose up to 12 specific coins, switch
between 5m/15m/1h, OI/funding/volume, increases/decreases, and Events/Pairs. These
controls are saved in the dashboard URL. Pair links open a native Hyperliquid
TradingView chart in a new tab. Events retain the last hour of observations and
can be ranked by strength or recency.

Volume compares complete candle windows to the median of the preceding 12 windows,
so it can work immediately from public history. OI and current funding require a
full observed window, collected as the dashboard refreshes. Leave auto-refresh at
1m or faster; gaps restart warm-up. History and events live in this server process
and reset on restart; separate server instances have separate histories. The UI
shows readiness, unavailable windows and stale data. No persistent worker or
database is required for this version.

### Where the numbers come from

- **Open interest and per-coin stats**: `metaAndAssetCtxs` on `api.hyperliquid.xyz/info`,
  plus the undocumented `globalStats` for the all-dex total. `openInterest` is
  denominated in coins, so it is multiplied by the mark price.
- **Market moves**: OI changes use coin units (±5% and ±$500K at a constant mark),
  funding changes use hourly basis points (±0.5 bp/h), and volume changes use base
  volume (≥3× or ≤⅓× typical, with a $100K estimated baseline and $250K estimated
  impact floor). Events require $5M recent OI and $1M daily volume. Arrows describe
  the metric's direction, not buying/selling or liquidation attribution. Volume
  dollar impact is an estimate. Repeated observations update an event episode
  rather than adding identical rows.
- **Long/short, margin, positions**: Hyperliquid publishes no exchange-wide positioning
  figure — perp open interest is symmetric, so every long/short number on every
  dashboard is a sample of some address set. Here that set is built from the public
  leaderboard (ranked by 24h volume and 30d PnL, never by the row's `accountValue`,
  which is stale) and swept for anyone holding size, then each member's
  `clearinghouseState` is polled. Panels label these figures as tracked traders rather
  than as exchange totals. `All tracked markets` means all default-DEX perpetual markets
  in this cohort; it does not include every exchange trader or every HIP-3 DEX.
- **Whale activity**: successive account snapshots are compared once per minute. An
  increase appears as **Open · add**, a reduction as **Close · partial**, and a complete
  disappearance as **Close · full**. These are net changes between reads, not individual
  fills or an exchange-wide alert stream. A position opened and closed between reads is
  invisible. The signed **Net flow** amount estimates the bought or sold notional at the
  latest mark; a reversal includes both the old and new sides. The $1M filter applies
  to the larger position seen before or after the change, not to the trade amount.
- **Funding**: `predictedFundings` returns Hyperliquid, Binance and Bybit in one call,
  which also avoids Binance's geo-blocking. OKX is queried directly. Settlement
  intervals differ per venue and per coin — Hyperliquid settles hourly, most venues
  every 8h, some Binance alts every 4h — so rates are shown annualized.
- **Wallet labels**: HypurrScan `globalAliases` and Hyperliquid leaderboard
  `displayName` values are merged by lowercase wallet address. HypurrScan takes
  precedence when both name a wallet. Whale activity, top positions and unstaking
  rows share one label request per full page load; widget refreshes, tab switches
  and remounts reuse it. Hover a name to see its source and full address. Unnamed
  wallets keep their shortened address, and either source can work independently
  if the other is unavailable. These labels are aliases, not verified identities.

### Cost and lifecycle

Hyperliquid allows 1200 request-weight per minute per IP, and on localhost the server
and the browser share it, so all server-side calls pass through a shared ledger that
reserves against a 900/minute ceiling. The cohort refresh is request-driven: it runs
only while a panel is asking, serves the previous snapshot while a new pass is in
flight, and stops entirely when the last panel is removed. Panels hold no timers of
their own — the dashboard's existing per-cell auto-refresh drives them, and it defaults
to on for these panels.

Market Moves shares the existing market-stat snapshots and caches candles by coin,
including in-flight requests across different widgets and windows. It backfills up
to 13 hours once, then requests new minutes and repairs detected gaps, with three
requests in flight at most per scan. Response-size weight is reserved in the same
ledger. Failed candle refreshes retain previous observations with their original
timestamps and explicit coverage warnings.

## TypeScript 7 — how lint works here

This project runs **TypeScript 7.0.2**, the native (Go) compiler. TS 7 does not
ship the JavaScript compiler API that tooling consumes via `require("typescript")`,
which has two consequences:

- **`next build`** requires `experimental.useTypeScriptCli: true` in
  `next.config.ts`. Without it Next.js tries to type check through the TS JS API
  and fails with *"TypeScript 7.0.2 does not provide the compiler API required by
  Next.js."* With the flag, Next.js shells out to the `tsc` CLI instead.
- **`npm run lint`** works, but only through a shim. `typescript-eslint` still
  declares peer `typescript: >=4.8.4 <6.1.0` and hard-throws at load time on TS 7,
  so the lint script preloads `scripts/eslint-ts6.cjs`, which patches
  `Module._resolveFilename` to resolve `typescript` to the side-by-side
  `typescript-6` alias (`npm:typescript@^6.0.3`). ESLint parses with TS 6 while
  `tsc` and `next build` use TS 7.

### Removing the shim

Delete `scripts/eslint-ts6.cjs`, the `typescript-6` devDependency, and the
`--require` in the `lint` script once
[`typescript-eslint` supports TS 7](https://github.com/typescript-eslint/typescript-eslint/issues/10940).
As of `typescript-eslint@8.71.0`, the peer range still caps at
`<6.1.0`, so all three pieces are still needed.

### Do not "fix" this by dropping the TypeScript ESLint config

Removing `eslint-config-next/typescript` from `eslint.config.mjs` makes `eslint .`
exit `0`, but that is a **false green**: `typescript-eslint` supplies the TS parser,
so ESLint silently stops linting `.ts`/`.tsx` files altogether and reports zero
problems while checking nothing. (It also drops the `ignores` that keep `.next/`
build output from being linted.)

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
