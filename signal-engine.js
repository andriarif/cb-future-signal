const DISPLAY_TIMEZONE = "Asia/Jakarta";
const M5_MS = 5 * 60 * 1000;

// ==========================================
// NORMALIZE CANDLES
// ==========================================

export function normalizeCandles(raw) {
  let rows = [];

  if (Array.isArray(raw)) {
    rows = raw;
  } else if (Array.isArray(raw?.data)) {
    rows = raw.data;
  } else if (Array.isArray(raw?.candles)) {
    rows = raw.candles;
  } else if (Array.isArray(raw?.data?.candles)) {
    rows = raw.data.candles;
  }

  return rows
    .map((c) => {
      const value =
        c.time ??
        c.timestamp ??
        c.ts ??
        c.open_time ??
        c.openTime;

      let time;

      if (typeof value === "number") {
        time = new Date(
          value < 1e12 ? value * 1000 : value
        );
      } else {
        time = new Date(value);
      }

      return {
        time,
        open: Number(c.open ?? c.o),
        high: Number(c.high ?? c.h),
        low: Number(c.low ?? c.l),
        close: Number(c.close ?? c.c),
        volume: Number(c.volume ?? c.v ?? 0)
      };
    })
    .filter(
      (c) =>
        Number.isFinite(c.time.getTime()) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
    )
    .sort((a, b) => a.time - b.time);
}

// ==========================================
// INDICATORS
// ==========================================

function sma(values, period) {
  if (values.length < period) return null;

  let sum = 0;

  for (
    let i = values.length - period;
    i < values.length;
    i++
  ) {
    sum += values[i];
  }

  return sum / period;
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let value = sma(
    values.slice(0, period),
    period
  );

  for (let i = period; i < values.length; i++) {
    value =
      (values[i] - value) * multiplier +
      value;
  }

  return value;
}

function stddev(values, period) {
  if (values.length < period) return null;

  const recent = values.slice(-period);

  const mean =
    recent.reduce((a, b) => a + b, 0) /
    period;

  const variance =
    recent.reduce(
      (sum, value) =>
        sum + Math.pow(value - mean, 2),
      0
    ) / period;

  return Math.sqrt(variance);
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change =
      values[i] - values[i - 1];

    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {
    const change =
      values[i] - values[i - 1];

    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    avgGain =
      (avgGain * (period - 1) + gain) /
      period;

    avgLoss =
      (avgLoss * (period - 1) + loss) /
      period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

// ==========================================
// PRICE ACTION
// ==========================================

function bullishPin(candle) {
  const body = Math.abs(
    candle.close - candle.open
  );

  const lowerWick =
    Math.min(candle.open, candle.close) -
    candle.low;

  const upperWick =
    candle.high -
    Math.max(candle.open, candle.close);

  return (
    lowerWick > body * 1.5 &&
    lowerWick > upperWick
  );
}

function bearishPin(candle) {
  const body = Math.abs(
    candle.close - candle.open
  );

  const upperWick =
    candle.high -
    Math.max(candle.open, candle.close);

  const lowerWick =
    Math.min(candle.open, candle.close) -
    candle.low;

  return (
    upperWick > body * 1.5 &&
    upperWick > lowerWick
  );
}

function bullishEngulf(previous, current) {
  return (
    previous.close < previous.open &&
    current.close > current.open &&
    current.open <= previous.close &&
    current.close >= previous.open
  );
}

function bearishEngulf(previous, current) {
  return (
    previous.close > previous.open &&
    current.close < current.open &&
    current.open >= previous.close &&
    current.close <= previous.open
  );
}

// ==========================================
// CLOSED M5 CANDLE
// ==========================================

function getLatestClosedCandle(
  candles,
  now = new Date()
) {
  const closed = candles.filter((candle) => {
    const closeTime =
      candle.time.getTime() + M5_MS;

    return closeTime <= now.getTime();
  });

  if (closed.length === 0) return null;

  return closed[closed.length - 1];
}

// ==========================================
// WIB FORMAT
// ==========================================

function formatWIB(iso) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: DISPLAY_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

// ==========================================
// ANALYZE
// ==========================================

export function analyze(
  asset,
  candles,
  minScore = 3
) {
  if (!Array.isArray(candles)) return null;

  if (candles.length < 220) return null;

  const now = new Date();

  const candle =
    getLatestClosedCandle(
      candles,
      now
    );

  if (!candle) return null;

  const index =
    candles.findIndex(
      (c) =>
        c.time.getTime() ===
        candle.time.getTime()
    );

  if (index < 200) return null;

  const previous =
    candles[index - 1];

  const closes = candles
    .slice(0, index + 1)
    .map((c) => c.close);

  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const previousCloses =
    closes.slice(0, -1);

  const previousEma50 =
    ema(previousCloses, 50);

  const currentRsi =
    rsi(closes, 14);

  const previousRsi =
    rsi(previousCloses, 14);

  const middle =
    sma(closes, 20);

  const deviation =
    stddev(closes, 20);

  let buyScore = 0;
  let sellScore = 0;

  const buyReasons = [];
  const sellReasons = [];

  // EMA50
  if (candle.close > ema50) {
    buyScore++;
    buyReasons.push("EMA50 bullish");
  }

  if (candle.close < ema50) {
    sellScore++;
    sellReasons.push("EMA50 bearish");
  }

  // EMA50 direction
  if (
    previousEma50 !== null &&
    ema50 > previousEma50
  ) {
    buyScore++;
    buyReasons.push("EMA50 naik");
  }

  if (
    previousEma50 !== null &&
    ema50 < previousEma50
  ) {
    sellScore++;
    sellReasons.push("EMA50 turun");
  }

  // EMA200
  if (candle.close > ema200) {
    buyScore++;
    buyReasons.push("Above EMA200");
  }

  if (candle.close < ema200) {
    sellScore++;
    sellReasons.push("Below EMA200");
  }

  // RSI 14
  if (
    currentRsi !== null &&
    previousRsi !== null
  ) {
    if (
      currentRsi >= 40 &&
      currentRsi < 60 &&
      currentRsi > previousRsi
    ) {
      buyScore++;
      buyReasons.push(
        `RSI naik ${currentRsi.toFixed(1)}`
      );
    }

    if (
      currentRsi > 40 &&
      currentRsi <= 60 &&
      currentRsi < previousRsi
    ) {
      sellScore++;
      sellReasons.push(
        `RSI turun ${currentRsi.toFixed(1)}`
      );
    }
  }

  // Candle
  if (candle.close > candle.open) {
    buyScore++;
    buyReasons.push("Candle bullish");
  }

  if (candle.close < candle.open) {
    sellScore++;
    sellReasons.push("Candle bearish");
  }

  // Price action
  if (
    bullishPin(candle) ||
    bullishEngulf(previous, candle)
  ) {
    buyScore++;
    buyReasons.push("Price action bullish");
  }

  if (
    bearishPin(candle) ||
    bearishEngulf(previous, candle)
  ) {
    sellScore++;
    sellReasons.push("Price action bearish");
  }

  // Bollinger middle
  if (
    middle !== null &&
    candle.close > middle
  ) {
    buyScore++;
    buyReasons.push("Above BB middle");
  }

  if (
    middle !== null &&
    candle.close < middle
  ) {
    sellScore++;
    sellReasons.push("Below BB middle");
  }

  // ========================================
  // SIGNAL
  // ========================================

  let direction;
  let score;
  let reasons;

  if (
    buyScore >= minScore &&
    buyScore > sellScore
  ) {
    direction = "CALL";
    score = buyScore;
    reasons = buyReasons;
  } else if (
    sellScore >= minScore &&
    sellScore > buyScore
  ) {
    direction = "PUT";
    score = sellScore;
    reasons = sellReasons;
  } else {
    return null;
  }

  // ========================================
  // ENTRY CANDLE BERIKUTNYA
  // ========================================

  const entryTime = new Date(
    candle.time.getTime() + M5_MS
  );

  const expiryTime = new Date(
    entryTime.getTime() + M5_MS
  );

  // ========================================
  // ANTI STALE
  // ========================================

  const secondsUntilEntry =
    (entryTime.getTime() -
      now.getTime()) /
    1000;

  if (
    secondsUntilEntry <= 0 ||
    secondsUntilEntry > 300
  ) {
    return null;
  }

  return {
    asset,
    direction,
    score,
    timeframe: "M5",

    signalTime: now.toISOString(),

    sourceCandleTime:
      candle.time.toISOString(),

    entryTime:
      entryTime.toISOString(),

    expiryTime:
      expiryTime.toISOString(),

    entryPrice: candle.close,

    expirationMinutes: 5,

    displayTimezone:
      DISPLAY_TIMEZONE,

    displayEntryTime:
      formatWIB(entryTime.toISOString()),

    displayExpiryTime:
      formatWIB(expiryTime.toISOString()),

    reasons
  };
}

// ==========================================
// TELEGRAM
// ==========================================

export function formatSignal(signal) {
  const direction =
    signal.direction === "CALL"
      ? "BUY"
      : "SELL";

  const emoji =
    signal.direction === "CALL"
      ? "🟩"
      : "🟥";

  const entryDate =
    new Date(signal.entryTime);

  const mg1 = new Date(
    entryDate.getTime() + 5 * 60 * 1000
  );

  const mg2 = new Date(
    mg1.getTime() + 5 * 60 * 1000
  );

  const mg3 = new Date(
    mg2.getTime() + 5 * 60 * 1000
  );

  return `⚡ SIGNAL

🌐 ${signal.asset} OTC
Timeframe: M5
⏱ Expiration: 5 minutes

⏰ Entry: ${formatWIB(
    signal.entryTime
  )} WIB

${emoji} Direction: ${direction}

📊 Martingale:
1⃣ ${formatWIB(mg1.toISOString())}
2⃣ ${formatWIB(mg2.toISOString())}
3⃣ ${formatWIB(mg3.toISOString())}

📊 Confirmation: ${signal.score}/10

${signal.reasons
  .map((r) => `🔎 ${r}`)
  .join("\n")}

⚠️ ENTRY SESUAI JAM DI ATAS`;
}
