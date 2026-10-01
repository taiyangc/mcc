import test from "node:test";
import assert from "node:assert/strict";
import { applyDashboardEdits, dashboardKey, parseDashboardConfig, writeDashboardParams } from "../src/app/lib/dashboard.ts";

const configured = () => parseDashboardConfig(new URLSearchParams({
  pairs: "BINANCE:BTCUSDT,HLCORE:WHALE", width: "3", height: "2", interval: "60",
  iv: "15,240", sizes: "2x1,1x2", ri: "30,120", ar: "0,0",
  tl: "CNBC:US2Y,YAHOO:^TNX", tr: "CNBC:BTC.CM=", td: "ohlc",
}));

test("one dashboard snapshot restores charts, layout, intervals, both banner sides and explicit sources", () => {
  const config = configured();
  const stored = JSON.parse(JSON.stringify(config));
  assert.deepEqual(parseDashboardConfig(new URLSearchParams(), stored), config);
  const params = writeDashboardParams(new URLSearchParams("campaign=example"), config);
  assert.equal(params.get("campaign"), "example");
  assert.deepEqual(parseDashboardConfig(params), config);
  assert.deepEqual(config.trends.left, ["CNBC:US2Y", "YAHOO:^TNX"]);
  assert.deepEqual(config.intervals, ["15", "240"]);
  assert.equal(params.get("ar"), "0,0");
});

test("shared chart links override saved charts without inheriting settings from different chart slots", () => {
  const config = parseDashboardConfig(new URLSearchParams("pairs=COINBASE:ETHUSD&interval=5&tl=US02Y&tr=&td=compact"), configured());
  assert.deepEqual(config.pairs, ["COINBASE:ETHUSD"]);
  assert.equal(config.width, 2);
  assert.deepEqual(config.intervals, ["5"]);
  assert.deepEqual(config.chartSizes, {});
  assert.deepEqual(config.refreshIntervals, {});
  assert.deepEqual(config.autoRefreshEnabled, { 0: false });
  assert.deepEqual(config.trends, { left: ["CNBC:US2Y"], right: [], display: "compact" });
});

test("legacy banner preferences and intervals migrate, but never override a saved dashboard or explicit URL", () => {
  const legacy = { left: ["^TNX"], right: ["BTC"], display: "compact" };
  const first = parseDashboardConfig(new URLSearchParams(), null, legacy, "15");
  assert.deepEqual(first.trends.left, ["CNBC:US10Y"]);
  assert.equal(first.defaultInterval, "15");
  assert.deepEqual(first.intervals, ["15", "15"]);
  assert.deepEqual(parseDashboardConfig(new URLSearchParams(), configured(), legacy, "15"), configured());
  const shared = parseDashboardConfig(new URLSearchParams("pairs=BINANCE:ETHUSDT&interval=240"), null, legacy, "15");
  assert.deepEqual(shared.intervals, ["240"]);
});

test("Save compares every configuration field and ignores spelling-only edits and transient UI state", () => {
  const config = configured();
  const original = dashboardKey(config);
  assert.equal(dashboardKey(applyDashboardEdits(config, [" binance:btcusdt ", "HLCORE:WHALE"])), original);
  assert.equal(dashboardKey({ ...config, configOpen: true, quote: 4.5 }), original);
  const changes = [
    { pairs: ["COINBASE:BTCUSD", config.pairs[1]] }, { width: 4 }, { height: 3 },
    { defaultInterval: "D" }, { intervals: ["30", "240"] },
    { chartSizes: {} }, { refreshIntervals: {} }, { autoRefreshEnabled: { 0: true, 1: false } },
    { trends: { ...config.trends, left: ["CNBC:US2Y", "CNBC:US10Y"] } },
    { trends: { ...config.trends, right: ["BTC-USD"] } },
    { trends: { ...config.trends, display: "range" } },
  ];
  for (const change of changes) assert.notEqual(dashboardKey({ ...config, ...change }), original, JSON.stringify(change));
  assert.equal(dashboardKey(parseDashboardConfig(new URLSearchParams(), config)), original);
  const lowercaseLink = parseDashboardConfig(new URLSearchParams("pairs=binance:btcusdt&interval=60&iv=15"));
  assert.deepEqual(lowercaseLink.pairs, ["BINANCE:BTCUSDT"]);
  const unchanged = applyDashboardEdits(lowercaseLink, lowercaseLink.pairs);
  assert.equal(dashboardKey(unchanged), dashboardKey(lowercaseLink));
  assert.deepEqual(unchanged.intervals, ["15"]);
});

test("saving edited chart symbols and a banner together preserves unrelated per-chart configuration", () => {
  const config = configured();
  const trends = { ...config.trends, right: ["CNBC:ETH.CM="] };
  const next = applyDashboardEdits(config, ["coinbase:ethusd", "HLCORE:WHALE"], trends);
  assert.deepEqual(next.pairs, ["COINBASE:ETHUSD", "HLCORE:WHALE"]);
  assert.deepEqual(next.intervals, ["60", "240"]);
  assert.deepEqual(next.chartSizes, config.chartSizes);
  assert.deepEqual(next.refreshIntervals, config.refreshIntervals);
  assert.deepEqual(next.autoRefreshEnabled, config.autoRefreshEnabled);
  assert.deepEqual(next.trends, trends);
});

test("empty chart inputs reindex saved settings, sparse new inputs do not create empty widgets", () => {
  const config = configured();
  const removed = applyDashboardEdits(config, ["", config.pairs[1]]);
  assert.deepEqual(removed.pairs, ["HLCORE:WHALE"]);
  assert.deepEqual(removed.intervals, ["240"]);
  assert.deepEqual(removed.chartSizes, { 0: { cols: 1, rows: 2 } });
  assert.deepEqual(removed.refreshIntervals, { 0: 120 });
  assert.deepEqual(removed.autoRefreshEnabled, { 0: false });
  const added = applyDashboardEdits(config, [...config.pairs, "", "HLCORE:ALL"]);
  assert.equal(added.pairs.length, 3);
  assert.equal(added.intervals[2], "60");
  assert.equal(added.autoRefreshEnabled[2], true);
});

test("empty dashboards and empty banner sides remain empty after saving and sharing", () => {
  const config = parseDashboardConfig(new URLSearchParams("pairs=&tl=&tr=&td=range"));
  assert.deepEqual(config.pairs, []);
  assert.deepEqual(config.trends.left, []);
  assert.deepEqual(config.trends.right, []);
  assert.deepEqual(parseDashboardConfig(writeDashboardParams(new URLSearchParams(), config)), config);
});

test("explicitly disabled auto-refresh survives Save, while an absent flag keeps panel defaults", () => {
  const initial = parseDashboardConfig(new URLSearchParams("pairs=HLCORE:ALL,BINANCE:BTCUSDT"));
  assert.deepEqual(initial.autoRefreshEnabled, { 0: true, 1: false });
  initial.autoRefreshEnabled[0] = false;
  assert.deepEqual(parseDashboardConfig(writeDashboardParams(new URLSearchParams(), initial)).autoRefreshEnabled, { 0: false, 1: false });
});

test("malformed saved data falls back safely and never restores expanded settings", () => {
  const config = parseDashboardConfig(new URLSearchParams(), {
    pairs: [null], width: -1, height: Infinity, defaultInterval: "invalid", intervals: "invalid",
    chartSizes: { 0: { cols: 999, rows: -2 } }, refreshIntervals: { 0: -10 },
    autoRefreshEnabled: { 0: "yes" }, trends: { left: [null] }, configOpen: true,
  });
  assert.deepEqual(config.pairs, ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT"]);
  assert.equal(config.width, 1);
  assert.equal(config.height, 2);
  assert.deepEqual(config.intervals, ["D", "D"]);
  assert.deepEqual(config.chartSizes, { 0: { cols: 10, rows: 1 } });
  assert.deepEqual(config.refreshIntervals, {});
  assert.equal("configOpen" in config, false);
});
