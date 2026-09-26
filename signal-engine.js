function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function normalizeCandles(raw) {
  let rows = raw;

  if (raw && !Array.isArray(raw)) {
    for (const k of ["candles", "data", "result", "items"]) {
      if (Array.isArray(raw[k])) {
        rows = raw[k];
        break;
      }
    }
  }

  if (!Array.isArray(rows)) {
    throw new Error("Response candle bukan array.");
  }

  const aliases = {
    timestamp: "time",
    ts: "time",
    datetime: "time",
    date: "time",
    o: "open",
    h: "high",
    l: "low",
    c: "close",
    v: "volume"
  };

  return rows
    .map(r => {
      const x = { ...r };

      for (const [a, b] of Object.entries(aliases)) {
        if (x[b] === undefined && x[a] !== undefined) {
          x[b] = x[a];
        }
      }

      const t =
        typeof x.time === "number"
          ? (
              x.time > 10000000000
                ? x.time
                : x.time * 1000
            )
          : Date.parse(x.time);

      return {
        time: new Date(t),
        open: num(x.open),
        high: num(x.high),
        low: num(x.low),
        close: num(x.close),
        volume: num(x.volume || 0)
      };
    })
    .filter(
      x =>
        !Number.isNaN(x.time.getTime()) &&
        [
          x.open,
          x.high,
          x.low,
          x.close
        ].every(Number.isFinite)
    )
    .sort((a, b) => a.time - b.time);
}

function ema(values, period) {
  const k = 2 / (period + 1);

  const out =
    Array(values.length).fill(NaN);

  let previous = NaN;

  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      continue;
    }

    previous =
      Number.isFinite(previous)
        ? values[i] * k +
          previous * (1 - k)
        : values[i];

    out[i] = previous;
  }

  return out;
}

function sma(values, period, index) {
  if (index < period - 1) {
    return NaN;
  }

  let sum = 0;

  for (
    let i = index - period + 1;
    i <= index;
    i++
  ) {
    sum += values[i];
  }

  return sum / period;
}

function std(values, period, index, mean) {
  if (index < period - 1) {
    return NaN;
  }

  let sum = 0;

  for (
    let i = index - period + 1;
    i <= index;
    i++
  ) {
    sum +=
      (values[i] - mean) ** 2;
  }

  return Math.sqrt(sum / period);
}

function rsi(values, period = 14) {
  const out =
    Array(values.length).fill(NaN);

  let gain = 0;
  let loss = 0;

  for (let i = 1; i < values.length; i++) {
    const change =
      values[i] - values[i - 1];

    const currentGain =
      Math.max(change, 0);

    const currentLoss =
      Math.max(-change, 0);

    if (i <= period) {
      gain += currentGain;
      loss += currentLoss;

      if (i === period) {
        out[i] =
          loss === 0
            ? 100
            : 100 -
              100 /
                (1 + gain / loss);
      }
    } else {
      gain =
        (gain * (period - 1) +
          currentGain) /
        period;

      loss =
        (loss * (period - 1) +
          currentLoss) /
        period;

      out[i] =
        loss === 0
          ? 100
          : 100 -
            100 /
              (1 + gain / loss);
    }
  }

  return out;
}

function candleBody(candle) {
  return Math.abs(
    candle.close - candle.open
  );
}

function upperWick(candle) {
  return (
    candle.high -
    Math.max(
      candle.open,
      candle.close
    )
  );
}

function lowerWick(candle) {
  return (
    Math.min(
      candle.open,
      candle.close
    ) - candle.low
  );
}

function bullishPin(candle) {
  const body =
    Math.max(
      candleBody(candle),
      1e-12
    );

  return (
    candle.close > candle.open &&
    lowerWick(candle) >= 1.5 * body &&
    upperWick(candle) <= 1.5 * body
  );
}

function bearishPin(candle) {
  const body =
    Math.max(
      candleBody(candle),
      1e-12
    );

  return (
    candle.close < candle.open &&
    upperWick(candle) >= 1.5 * body &&
    lowerWick(candle) <= 1.5 * body
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

/*
=========================================================
 M5 SIGNAL ENGINE
=========================================================

Timeframe       : M5
EMA             : 50
RSI             : 14
RSI BUY area    : >= 40
RSI SELL area   : <= 60
Confirmation    : Candle close
Expiration      : 5 minutes
Timezone display : UTC+6

Signal dibuat dari candle M5 yang sudah CLOSED.

Contoh:

Candle:
07:50 - 07:55

Signal:
Entry 07:55

Expiration:
08:00
=========================================================
*/

export function analyze(
  asset,
  candles,
  minScore = 2
) {
  if (candles.length < 220) {
    return null;
  }

  const closes =
    candles.map(
      candle => candle.close
    );

  const ema50 =
    ema(closes, 50);

  const ema200 =
    ema(closes, 200);

  const rsi14 =
    rsi(closes, 14);

  const index =
    candles.length - 1;

  const previousIndex =
    index - 1;

  if (previousIndex < 1) {
    return null;
  }

  const current =
    candles[index];

  const previous =
    candles[previousIndex];

  if (
    !Number.isFinite(ema50[index]) ||
    !Number.isFinite(ema200[index]) ||
    !Number.isFinite(rsi14[index])
  ) {
    return null;
  }

  /*
  ========================================================
  BOLLINGER BAND
  ========================================================
  */

  const middle =
    sma(closes, 20, index);

  const deviation =
    std(
      closes,
      20,
      index,
      middle
    );

  const upperBand =
    middle + 2 * deviation;

  const lowerBand =
    middle - 2 * deviation;

  /*
  ========================================================
  SUPPORT / RESISTANCE
  ========================================================
  */

  let support =
    Infinity;

  let resistance =
    -Infinity;

  for (
    let i =
      Math.max(0, index - 20);
    i < index;
    i++
  ) {
    support =
      Math.min(
        support,
        candles[i].low
      );

    resistance =
      Math.max(
        resistance,
        candles[i].high
      );
  }

  const range =
    Math.max(
      current.high -
        current.low,
      1e-12
    );

  const tolerance =
    Math.max(
      range,
      current.close * 0.0005
    );

  let bullishScore = 0;
  let bearishScore = 0;

  const bullishReasons = [];
  const bearishReasons = [];

  /*
  ========================================================
  1. EMA50 / EMA200 TREND
  ========================================================
  */

  if (
    ema50[index] >
    ema200[index]
  ) {
    bullishScore++;

    bullishReasons.push(
      "EMA bullish"
    );
  }

  if (
    ema50[index] <
    ema200[index]
  ) {
    bearishScore++;

    bearishReasons.push(
      "EMA bearish"
    );
  }

  /*
  ========================================================
  2. EMA50 SLOPE
  ========================================================
  */

  if (
    ema50[index] >
    ema50[previousIndex]
  ) {
    bullishScore++;

    bullishReasons.push(
      "EMA50 naik"
    );
  }

  if (
    ema50[index] <
    ema50[previousIndex]
  ) {
    bearishScore++;

    bearishReasons.push(
      "EMA50 turun"
    );
  }

  /*
  ========================================================
  3. PRICE VS EMA50
  ========================================================
  */

  if (
    current.close >
    ema50[index]
  ) {
    bullishScore++;

    bullishReasons.push(
      "Price above EMA50"
    );
  }

  if (
    current.close <
    ema50[index]
  ) {
    bearishScore++;

    bearishReasons.push(
      "Price below EMA50"
    );
  }

  /*
  ========================================================
  4. RSI14 MOMENTUM
  ========================================================
  */

  if (
    rsi14[index] >
    rsi14[previousIndex]
  ) {
    bullishScore++;

    bullishReasons.push(
      `RSI naik ${rsi14[index].toFixed(1)}`
    );
  }

  if (
    rsi14[index] <
    rsi14[previousIndex]
  ) {
    bearishScore++;

    bearishReasons.push(
      `RSI turun ${rsi14[index].toFixed(1)}`
    );
  }

  /*
  ========================================================
  5. RSI AREA 40 / 60
  ========================================================
  */

  if (
    rsi14[index] >= 40 &&
    rsi14[index] < 60
  ) {
    if (
      rsi14[index] >
      rsi14[previousIndex]
    ) {
      bullishScore++;

      bullishReasons.push(
        `RSI BUY area ${rsi14[index].toFixed(1)}`
      );
    }

    if (
      rsi14[index] <
      rsi14[previousIndex]
    ) {
      bearishScore++;

      bearishReasons.push(
        `RSI SELL area ${rsi14[index].toFixed(1)}`
      );
    }
  }

  if (
    rsi14[index] >= 60 &&
    rsi14[index] >
      rsi14[previousIndex]
  ) {
    bullishScore++;

    bullishReasons.push(
      `RSI momentum ${rsi14[index].toFixed(1)}`
    );
  }

  if (
    rsi14[index] <= 40 &&
    rsi14[index] <
      rsi14[previousIndex]
  ) {
    bearishScore++;

    bearishReasons.push(
      `RSI momentum ${rsi14[index].toFixed(1)}`
    );
  }

  /*
  ========================================================
  6. BOLLINGER BAND
  ========================================================
  */

  if (
    current.close <= lowerBand ||
    current.low <= lowerBand
  ) {
    bullishScore++;

    bullishReasons.push(
      "BB lower"
    );
  }

  if (
    current.close >= upperBand ||
    current.high >= upperBand
  ) {
    bearishScore++;

    bearishReasons.push(
      "BB upper"
    );
  }

  /*
  ========================================================
  7. SUPPORT
  ========================================================
  */

  if (
    Math.abs(
      current.close -
        support
    ) <= tolerance ||
    current.low <=
      support + tolerance
  ) {
    bullishScore++;

    bullishReasons.push(
      "Support"
    );
  }

  /*
  ========================================================
  8. RESISTANCE
  ========================================================
  */

  if (
    Math.abs(
      current.close -
        resistance
    ) <= tolerance ||
    current.high >=
      resistance - tolerance
  ) {
    bearishScore++;

    bearishReasons.push(
      "Resistance"
    );
  }

  /*
  ========================================================
  9. PRICE ACTION
  ========================================================
  */

  const bullishPA =
    bullishPin(current) ||
    bullishEngulf(
      previous,
      current
    );

  const bearishPA =
    bearishPin(current) ||
    bearishEngulf(
      previous,
      current
    );

  if (bullishPA) {
    bullishScore++;

    bullishReasons.push(
      "Bullish PA"
    );
  }

  if (bearishPA) {
    bearishScore++;

    bearishReasons.push(
      "Bearish PA"
    );
  }

  /*
  ========================================================
  10. CANDLE CONFIRMATION
  ========================================================
  */

  if (
    current.close >
    current.open
  ) {
    bullishScore++;

    bullishReasons.push(
      "Candle bullish"
    );
  }

  if (
    current.close <
    current.open
  ) {
    bearishScore++;

    bearishReasons.push(
      "Candle bearish"
    );
  }

  /*
  ========================================================
  FINAL SIGNAL
  ========================================================
  */

  if (
    bullishScore >= minScore &&
    bullishScore >
      bearishScore
  ) {
    return makeSignal(
      asset,
      "CALL",
      bullishScore,
      current,
      bullishReasons
    );
  }

  if (
    bearishScore >= minScore &&
    bearishScore >
      bullishScore
  ) {
    return makeSignal(
      asset,
      "PUT",
      bearishScore,
      current,
      bearishReasons
    );
  }

  return null;
}

/*
=========================================================
CREATE M5 SIGNAL
=========================================================

Candle closed:
07:50

Entry:
07:55

Expiration:
08:00
=========================================================
*/

function makeSignal(
  asset,
  direction,
  score,
  candle,
  reasons
) {
  const entryTime =
    new Date(
      candle.time.getTime() +
        5 * 60 * 1000
    );

  const expiryTime =
    new Date(
      entryTime.getTime() +
        5 * 60 * 1000
    );

  return {
    asset,

    direction,

    score,

    timeframe: "M5",

    signalTime:
      new Date().toISOString(),

    sourceCandleTime:
      candle.time.toISOString(),

    entryTime:
      entryTime.toISOString(),

    expiryTime:
      expiryTime.toISOString(),

    entryPrice:
      candle.close,

    expirationMinutes: 5,

    reasons
  };
}

export function candleKey(
  iso
) {
  return new Date(iso)
    .toISOString()
    .slice(0, 16);
}

/*
=========================================================
FORMAT TELEGRAM
UTC+6
=========================================================
*/

export function formatSignal(
  sig
) {
  const timeZone =
    "Etc/GMT-6";

  const formatter =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    );

  const entry =
    formatter.format(
      new Date(sig.entryTime)
    );

  const mg1 =
    new Date(
      new Date(sig.entryTime)
        .getTime() +
        5 * 60 * 1000
    );

  const mg2 =
    new Date(
      new Date(sig.entryTime)
        .getTime() +
        10 * 60 * 1000
    );

  const mg3 =
    new Date(
      new Date(sig.entryTime)
        .getTime() +
        15 * 60 * 1000
    );

  const mg1Text =
    formatter.format(mg1);

  const mg2Text =
    formatter.format(mg2);

  const mg3Text =
    formatter.format(mg3);

  const directionEmoji =
    sig.direction === "CALL"
      ? "🟩"
      : "🟥";

  const direction =
    sig.direction === "CALL"
      ? "BUY"
      : "SELL";

  return `⚡ SIGNAL

🌐 ${escapeHtml(sig.asset)} 🇺🇸 OTC
Timeframe: M5
⏱ Expiration: 5 minutes
⏰ Entry: ${entry} UTC+6
${directionEmoji} Direction: ${direction}

📊 Martingale:
1⃣ ${mg1Text}
2⃣ ${mg2Text}
3⃣ ${mg3Text}

📊 Confirmation: ${sig.score}/10

${sig.reasons
  .slice(0, 6)
  .map(
    reason =>
      "🔎 " +
      escapeHtml(reason)
  )
  .join("\n")}

⚠️ Enter exactly at the Entry time.`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    );
}
