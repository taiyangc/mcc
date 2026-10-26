/** Shared, lightweight vocabulary. The native recognizers stay on the server. */
export type CandleGroup = "reversals" | "continuations" | "basics" | "neutral";
export type PatternDirection = "up" | "down" | "neutral";
export type PatternCategory = CandleGroup | "momentum" | "breakouts";

export interface PatternDefinition {
  code: string;
  name: string;
  candles: number;
  maxCandles?: number;
  group: CandleGroup;
  direction: PatternDirection | "signed" | "lower-rejection" | "upper-rejection";
  trend: "opposite" | "same" | "none";
  summary: string;
  source: string;
  bullishName?: string;
  bearishName?: string;
  /** TA-Lib's default fraction of the first body; never relaxed for crypto. */
  penetration?: number;
  gap?: boolean;
  suppresses?: string[];
}

export const PATTERN_GROUPS: { key: CandleGroup; label: string }[] = [
  { key: "reversals", label: "Reversals" },
  { key: "continuations", label: "Continuations" },
  { key: "basics", label: "Basic candles" },
  { key: "neutral", label: "Indecision" },
];

function pattern(code: string, name: string, candles: number, group: CandleGroup,
  direction: PatternDefinition["direction"], summary: string,
  extra: Partial<PatternDefinition> = {}): PatternDefinition {
  return { code, name, candles, group, direction, summary,
    trend: group === "reversals" ? "opposite" : group === "continuations" ? "same" : "none",
    source: `https://ta-lib.org/functions/${code.toLowerCase()}.html`, ...extra };
}

// One entry per TA-Lib CDL function, rather than counting bullish/bearish aliases
// as separate recognizers. Descriptions follow the bundled TA-Lib C definitions.
export const CANDLE_PATTERNS: readonly PatternDefinition[] = [
  pattern("CDL2CROWS", "Two crows", 3, "reversals", "down",
    "A rising candle is followed by two falling candles; the last closes back inside the first body after an upside body gap.", { gap: true }),
  pattern("CDL3BLACKCROWS", "Three black crows", 3, "reversals", "down",
    "Three falling candles open within the preceding bodies and finish near their lows. After a rise, they suggest selling pressure."),
  pattern("CDL3INSIDE", "Three inside up / down", 3, "reversals", "signed",
    "A harami is followed by a third candle that closes beyond the first candle's open in the reversal direction.",
    { bullishName: "Three inside up", bearishName: "Three inside down" }),
  pattern("CDL3LINESTRIKE", "Three-line strike", 4, "continuations", "signed",
    "Three candles advance together, then an opposite candle erases their bodies. The label follows TA-Lib's traditional continuation reading; other references interpret it as a reversal."),
  pattern("CDL3OUTSIDE", "Three outside up / down", 3, "reversals", "signed",
    "An engulfing pair is followed by a third close farther in the engulfing candle's direction.",
    { bullishName: "Three outside up", bearishName: "Three outside down" }),
  pattern("CDL3STARSINSOUTH", "Three stars in the south", 3, "reversals", "up",
    "Three falling candles contract after a decline; the first has a long lower wick and the last is small inside the second range."),
  pattern("CDL3WHITESOLDIERS", "Three white soldiers", 3, "reversals", "up",
    "Three rising candles open within the preceding bodies and finish near their highs. After a decline, they suggest buying pressure."),
  pattern("CDLABANDONEDBABY", "Abandoned baby", 3, "reversals", "signed",
    "An isolated doji is separated from both neighboring candles by gaps, including the wicks; the third candle reverses into the first body.",
    { penetration: 0.3, gap: true }),
  pattern("CDLADVANCEBLOCK", "Advance block", 3, "reversals", "down",
    "Three rising closes show weakening progress through shrinking bodies or longer upper wicks. This flags a tiring advance."),
  pattern("CDLBELTHOLD", "Belt hold", 1, "reversals", "signed",
    "A long body opens at or very near its low (bullish) or high (bearish), with almost no opening-side wick."),
  pattern("CDLBREAKAWAY", "Breakaway", 5, "reversals", "signed",
    "A long candle and body gap extend a trend; after further extension, the fifth candle reverses into that original gap.", { gap: true }),
  pattern("CDLCLOSINGMARUBOZU", "Closing marubozu", 1, "basics", "signed",
    "A long body finishes near its high or low with almost no closing-side wick. The opening side may have a wick.",
    { suppresses: ["CDLLONGLINE"] }),
  pattern("CDLCONCEALBABYSWALL", "Concealing baby swallow", 4, "reversals", "up",
    "Two nearly wickless falling candles precede a gapped-down third candle with an upper wick; a fourth falling candle engulfs the third's full range.", { gap: true }),
  pattern("CDLCOUNTERATTACK", "Counterattack", 2, "reversals", "signed",
    "Two long, opposite-color bodies finish at approximately the same closing price, suggesting resistance to the previous move."),
  pattern("CDLDARKCLOUDCOVER", "Dark cloud cover", 2, "reversals", "down",
    "After a long rising candle, price opens above its high and falls more than halfway into its body.", { penetration: 0.5, gap: true }),
  pattern("CDLDOJI", "Doji", 1, "neutral", "neutral",
    "Open and close are nearly equal relative to recent ranges. This shows indecision, without a directional forecast.", { suppresses: ["CDLSHORTLINE"] }),
  pattern("CDLDOJISTAR", "Doji star", 2, "reversals", "signed",
    "A doji body gaps away from a long body in the trend's direction. It flags a pause that still needs reversal confirmation.", { gap: true }),
  pattern("CDLDRAGONFLYDOJI", "Dragonfly doji", 1, "neutral", "lower-rejection",
    "Open and close sit near the high above a long lower wick. Lower-price rejection is bullish only with a preceding decline here.",
    { suppresses: ["CDLDOJI", "CDLLONGLEGGEDDOJI"] }),
  pattern("CDLENGULFING", "Engulfing", 2, "reversals", "signed",
    "The second, opposite-color body contains the first body. Wicks need not be engulfed; a touching boundary is labeled separately."),
  pattern("CDLEVENINGDOJISTAR", "Evening doji star", 3, "reversals", "down",
    "A long rising body, a gapped-up doji, then a falling candle penetrating the first body mark a potential turn lower.",
    { penetration: 0.3, gap: true, suppresses: ["CDLEVENINGSTAR"] }),
  pattern("CDLEVENINGSTAR", "Evening star", 3, "reversals", "down",
    "A long rising body is followed by a small body above it, then a falling candle closing well inside the first body.", { penetration: 0.3, gap: true }),
  pattern("CDLGAPSIDESIDEWHITE", "Gap side-by-side white lines", 3, "continuations", "signed",
    "Two similar rising candles with nearly equal opens sit beyond an upside or downside body gap, keeping the gap open.",
    { gap: true, bullishName: "Upside gap side-by-side white lines", bearishName: "Downside gap side-by-side white lines" }),
  pattern("CDLGRAVESTONEDOJI", "Gravestone doji", 1, "neutral", "upper-rejection",
    "Open and close sit near the low below a long upper wick. Higher-price rejection is bearish only with a preceding rise here.",
    { suppresses: ["CDLDOJI", "CDLLONGLEGGEDDOJI"] }),
  pattern("CDLHAMMER", "Hammer", 1, "reversals", "up",
    "A small body sits above a long lower wick near the preceding low. After a decline, it suggests lower-price rejection."),
  pattern("CDLHANGINGMAN", "Hanging man", 1, "reversals", "down",
    "A small body above a long lower wick occurs near recent highs. After a rise, the selling within this candle merits confirmation."),
  pattern("CDLHARAMI", "Harami", 2, "reversals", "signed",
    "A small body is contained inside a preceding long body, indicating a contraction of the prior move."),
  pattern("CDLHARAMICROSS", "Harami cross", 2, "reversals", "signed",
    "A doji body sits inside a preceding long body. This is the indecision variant of a harami.", { suppresses: ["CDLHARAMI"] }),
  pattern("CDLHIGHWAVE", "High-wave candle", 1, "neutral", "neutral",
    "A small body has unusually long wicks on both sides. Price explored both directions without a decisive close.", { suppresses: ["CDLSPINNINGTOP"] }),
  pattern("CDLHIKKAKE", "Hikkake", 3, "reversals", "signed",
    "An inside bar is followed by an attempted breakout. A close through the opposite side of the inside bar within three more candles confirms the trap; it can reverse or continue a trend.",
    { trend: "none", maxCandles: 6 }),
  pattern("CDLHIKKAKEMOD", "Modified hikkake", 4, "reversals", "signed",
    "A hikkake adds an earlier narrowing candle with a close near one extreme. Confirmation requires the opposite breakout within three later candles.", { maxCandles: 7 }),
  pattern("CDLHOMINGPIGEON", "Homing pigeon", 2, "reversals", "up",
    "A small falling body is contained in a previous long falling body. After a decline, it marks easing selling pressure."),
  pattern("CDLIDENTICAL3CROWS", "Identical three crows", 3, "reversals", "down",
    "Three falling candles close near their lows, each reopening near the previous close. A stricter variation of three black crows.", { suppresses: ["CDL3BLACKCROWS"] }),
  pattern("CDLINNECK", "In-neck", 2, "continuations", "down",
    "After a long falling candle, a rising candle opens below its low but recovers only just inside its body.", { gap: true }),
  pattern("CDLINVERTEDHAMMER", "Inverted hammer", 1, "reversals", "up",
    "A small body with a long upper wick gaps below the prior body after a decline. A rebound still needs follow-through.", { gap: true }),
  pattern("CDLKICKING", "Kicking", 2, "reversals", "signed",
    "Opposite marubozu candles are separated by a full gap. Direction follows the second candle; this abrupt switch does not require a prior trend filter.", { gap: true, trend: "none" }),
  pattern("CDLKICKINGBYLENGTH", "Kicking by length", 2, "reversals", "signed",
    "The same gapped marubozu pair as kicking, but direction follows the longer body. It can disagree with the ordinary kicking interpretation.", { gap: true, trend: "none" }),
  pattern("CDLLADDERBOTTOM", "Ladder bottom", 5, "reversals", "up",
    "Three falling candles and a fourth with an upper wick are followed by a rising candle opening above the fourth body and closing above its high."),
  pattern("CDLLONGLEGGEDDOJI", "Long-legged doji", 1, "neutral", "neutral",
    "A doji has at least one long wick, showing price exploration with little net movement. Often illustrated with two long wicks; this recognizer accepts either side.", { suppresses: ["CDLDOJI", "CDLSPINNINGTOP"] }),
  pattern("CDLLONGLINE", "Long-line candle", 1, "basics", "signed",
    "A relatively long real body has short wicks. Its color describes the candle's direction, without proving a continuing trend."),
  pattern("CDLMARUBOZU", "Marubozu", 1, "basics", "signed",
    "A relatively long body has almost no wick at either end. Buying or selling dominated this candle; size is compared with recent bodies.",
    { suppresses: ["CDLCLOSINGMARUBOZU", "CDLLONGLINE"] }),
  pattern("CDLMATCHINGLOW", "Matching low", 2, "reversals", "up",
    "Two falling candles finish at almost the same close. Traditionally read as possible support after a decline; their lows need not match."),
  pattern("CDLMATHOLD", "Mat hold", 5, "continuations", "up",
    "A long rising candle and upside body gap precede three small pullback candles; a final rising candle clears their highs. This recognizer covers the bullish form.", { penetration: 0.5, gap: true }),
  pattern("CDLMORNINGDOJISTAR", "Morning doji star", 3, "reversals", "up",
    "A long falling body, a gapped-down doji, then a rising candle penetrating the first body mark a potential turn higher.",
    { penetration: 0.3, gap: true, suppresses: ["CDLMORNINGSTAR"] }),
  pattern("CDLMORNINGSTAR", "Morning star", 3, "reversals", "up",
    "A long falling body is followed by a small body below it, then a rising candle closing well inside the first body.", { penetration: 0.3, gap: true }),
  pattern("CDLONNECK", "On-neck", 2, "continuations", "down",
    "After a long falling candle, a rising candle opens below its low and recovers only to that previous low.", { gap: true }),
  pattern("CDLPIERCING", "Piercing line", 2, "reversals", "up",
    "Following a long falling candle, price opens below its low and rises beyond the body's midpoint, without fully engulfing it.", { gap: true }),
  pattern("CDLRICKSHAWMAN", "Rickshaw man", 1, "neutral", "neutral",
    "A long-legged doji has its tiny body near the middle of the range. Both sides pushed price but neither held control.",
    { suppresses: ["CDLDOJI", "CDLLONGLEGGEDDOJI", "CDLSPINNINGTOP", "CDLHIGHWAVE"] }),
  pattern("CDLRISEFALL3METHODS", "Rising / falling three methods", 5, "continuations", "signed",
    "Three small countertrend bodies hold within the first long candle's range; a fifth candle resumes the trend beyond the first close.",
    { bullishName: "Rising three methods", bearishName: "Falling three methods" }),
  pattern("CDLSEPARATINGLINES", "Separating lines", 2, "continuations", "signed",
    "An opposite-color pair shares nearly the same opening price; the second is a long belt-hold candle in the established trend's direction."),
  pattern("CDLSHOOTINGSTAR", "Shooting star", 1, "reversals", "down",
    "A small body with a long upper wick gaps above the preceding body after a rise, suggesting higher-price rejection.", { gap: true }),
  pattern("CDLSHORTLINE", "Short-line candle", 1, "basics", "neutral",
    "A small real body and short wicks describe a quiet candle relative to recent activity. Its color alone is not a directional signal."),
  pattern("CDLSPINNINGTOP", "Spinning top", 1, "neutral", "neutral",
    "A small real body lies between two longer wicks. This is indecision regardless of whether the candle closes green or red."),
  pattern("CDLSTALLEDPATTERN", "Stalled pattern", 3, "reversals", "down",
    "Two long rising candles are followed by a small rising body near the second candle's top, suggesting the advance is losing momentum."),
  pattern("CDLSTICKSANDWICH", "Stick sandwich", 3, "reversals", "up",
    "A rising candle sits between two falling candles whose closes nearly match. Traditionally read as possible support after a decline."),
  pattern("CDLTAKURI", "Takuri", 1, "neutral", "lower-rejection",
    "A dragonfly-like doji has an exceptionally long lower wick. It flags lower-price rejection, with bullish context only after a decline here.",
    { suppresses: ["CDLDOJI", "CDLLONGLEGGEDDOJI", "CDLDRAGONFLYDOJI"] }),
  pattern("CDLTASUKIGAP", "Tasuki gap", 3, "continuations", "signed",
    "Two same-color bodies create a gap; an opposite third body retraces into that gap without closing it.",
    { gap: true, bullishName: "Upside tasuki gap", bearishName: "Downside tasuki gap" }),
  pattern("CDLTHRUSTING", "Thrusting", 2, "continuations", "down",
    "A rising candle opens below the prior falling candle's low and recovers into its body, but fails to reach its midpoint.", { gap: true }),
  pattern("CDLTRISTAR", "Tri-star", 3, "reversals", "signed",
    "Three doji bodies form a turning sequence: the middle doji gaps away from the first and the third retreats toward it.", { gap: true }),
  pattern("CDLUNIQUE3RIVER", "Unique three river", 3, "reversals", "up",
    "A long falling candle is followed by a smaller falling body making a lower low, then a small rising candle above that low."),
  pattern("CDLUPSIDEGAP2CROWS", "Upside gap two crows", 3, "reversals", "down",
    "After a rising candle, two falling bodies remain above an upside gap; the third body engulfs the second, indicating weakening demand.", { gap: true }),
  pattern("CDLXSIDEGAP3METHODS", "Gap three methods", 3, "continuations", "signed",
    "Two same-color bodies gap in the trend's direction, then an opposite candle opens in the second body and closes in the first, filling the body gap.",
    { gap: true, bullishName: "Upside gap three methods", bearishName: "Downside gap three methods" }),
  pattern("TWEEZERBOTTOM", "Tweezer bottom", 2, "reversals", "up",
    "A falling candle and rising candle test nearly equal lows after a decline. Here, the lows must be within 0.05× prior ATR and both bodies at least 0.1× ATR.",
    { source: "https://www.tradingview.com/support/solutions/43000592709-tweezer-bottom-bullish/" }),
  pattern("TWEEZERTOP", "Tweezer top", 2, "reversals", "down",
    "A rising candle and falling candle test nearly equal highs after an advance. Here, the highs must be within 0.05× prior ATR and both bodies at least 0.1× ATR.",
    { source: "https://www.tradingview.com/support/solutions/43000752737-candlestick-pattern-in-screener/" }),
];

export const PATTERN_BY_CODE = new Map(CANDLE_PATTERNS.map(item => [item.code, item]));
export const TALIB_PATTERNS = CANDLE_PATTERNS.filter(item => item.code.startsWith("CDL"));

export function patternName(definition: PatternDefinition, direction: PatternDirection): string {
  if (definition.direction !== "signed" || direction === "neutral") return definition.name;
  return (direction === "up" ? definition.bullishName : definition.bearishName)
    ?? `${direction === "up" ? "Bullish" : "Bearish"} ${definition.name.toLowerCase()}`;
}

export function candleCountLabel(definition: Pick<PatternDefinition, "candles" | "maxCandles">): string {
  return definition.maxCandles ? `${definition.candles}–${definition.maxCandles} candles`
    : `${definition.candles} candle${definition.candles === 1 ? "" : "s"}`;
}
