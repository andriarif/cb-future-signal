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
          ? (x.time > 10000000000 ? x.time : x.time * 1000)
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
        [x.open, x.high, x.low, x.close].every(Number.isFinite)
    )
    .sort((a, b) => a.time - b.time);
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = Array(values.length).fill(NaN);
  let prev = NaN;

  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) continue;

    prev = Number.isFinite(prev)
      ? values[i] * k + prev * (1 - k)
      : values[i];

    out[i] = prev;
  }

  return out;
}

function sma(values, period, i) {
  if (i < period - 1) return NaN;

  let s = 0;

  for (let j = i - period + 1; j <= i; j++) {
    s += values[j];
  }

  return s / period;
}

function std(values, period, i, mean) {
  if (i < period - 1) return NaN;

  let s = 0;

  for (let j = i - period + 1; j <= i; j++) {
    s += (values[j] - mean) ** 2;
  }

  return Math.sqrt(s / period);
}

function rsi(values, period = 14) {
  const out = Array(values.length).fill(NaN);

  let gain = 0;
  let loss = 0;

  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];

    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);

    if (i <= period) {
      gain += g;
      loss += l;

      if (i === period) {
        out[i] =
          loss === 0
            ? 100
            : 100 - 100 / (1 + gain / loss);
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;

      out[i] =
        loss === 0
          ? 100
          : 100 - 100 / (1 + gain / loss);
    }
  }

  return out;
}

function body(r) {
  return Math.abs(r.close - r.open);
}

function upper(r) {
  return r.high - Math.max(r.open, r.close);
}

function lower(r) {
  return Math.min(r.open, r.close) - r.low;
}

function bullishPin(r) {
  const b = Math.max(body(r), 1e-12);

  return (
    r.close > r.open &&
    lower(r) >= 1.5 * b &&
    upper(r) <= 1.5 * b
  );
}

function bearishPin(r) {
  const b = Math.max(body(r), 1e-12);

  return (
    r.close < r.open &&
    upper(r) >= 1.5 * b &&
    lower(r) <= 1.5 * b
  );
}

function bullishEngulf(p, r) {
  return (
    p.close < p.open &&
    r.close > r.open &&
    r.open <= p.close &&
    r.close >= p.open
  );
}

function bearishEngulf(p, r) {
  return (
    p.close > p.open &&
    r.close < r.open &&
    r.open >= p.close &&
    r.close <= p.open
  );
}

export function analyze(asset, candles, minScore = 2) {
  if (candles.length < 220) return null;

  const closes = candles.map(x => x.close);

  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const rs = rsi(closes, 14);

  const i = candles.length - 1;
  const p = i - 1;
  const p2 = i - 2;

  const mid = sma(closes, 20, i);
  const sd = std(closes, 20, i, mid);

  const upperBB = mid + 2 * sd;
  const lowerBB = mid - 2 * sd;

  let support = Infinity;
  let resistance = -Infinity;

  for (let j = Math.max(0, i - 20); j < i; j++) {
    support = Math.min(support, candles[j].low);
    resistance = Math.max(resistance, candles[j].high);
  }

  const r = candles[i];
  const prev = candles[p];

  const range = Math.max(r.high - r.low, 1e-12);

  // Area toleransi dibuat lebih longgar
  const tol = Math.max(
    range * 1.0,
    r.close * 0.0005
  );

  let bull = 0;
  let bear = 0;

  const br = [];
  const sr = [];

  // =========================================================
  // 1. EMA TREND
  // =========================================================

  if (e50[i] > e200[i]) {
    bull++;
    br.push("EMA bullish");
  }

  if (e50[i] < e200[i]) {
    bear++;
    sr.push("EMA bearish");
  }

  // EMA slope tambahan
  if (e50[i] > e50[p]) {
    bull++;
    br.push("EMA50 naik");
  }

  if (e50[i] < e50[p]) {
    bear++;
    sr.push("EMA50 turun");
  }

  // =========================================================
  // 2. RSI 14 - LEBIH LONGGAR
  // =========================================================

  // BUY
  if (rs[i] > rs[p]) {
    bull++;
    br.push(`RSI naik ${rs[i].toFixed(1)}`);
  }

  // SELL
  if (rs[i] < rs[p]) {
    bear++;
    sr.push(`RSI turun ${rs[i].toFixed(1)}`);
  }

  // RSI area
  if (rs[i] >= 45 && rs[i] <= 65) {
    if (rs[i] >= 50) {
      bull++;
      br.push(`RSI area BUY ${rs[i].toFixed(1)}`);
    } else {
      bear++;
      sr.push(`RSI area SELL ${rs[i].toFixed(1)}`);
    }
  }

  // =========================================================
  // 3. BOLLINGER BAND
  // =========================================================

  // BUY jika harga dekat / menyentuh BB bawah
  if (
    r.close <= lowerBB ||
    r.low <= lowerBB ||
    (r.close < mid && r.close > prev.close)
  ) {
    bull++;
    br.push("BB BUY");
  }

  // SELL jika harga dekat / menyentuh BB atas
  if (
    r.close >= upperBB ||
    r.high >= upperBB ||
    (r.close > mid && r.close < prev.close)
  ) {
    bear++;
    sr.push("BB SELL");
  }

  // =========================================================
  // 4. SUPPORT / RESISTANCE
  // =========================================================

  if (
    Math.abs(r.close - support) <= tol ||
    r.low <= support + tol
  ) {
    bull++;
    br.push("Support");
  }

  if (
    Math.abs(r.close - resistance) <= tol ||
    r.high >= resistance - tol
  ) {
    bear++;
    sr.push("Resistance");
  }

  // =========================================================
  // 5. PRICE ACTION
  // =========================================================

  const bp =
    bullishPin(r) ||
    bullishEngulf(prev, r);

  const sp =
    bearishPin(r) ||
    bearishEngulf(prev, r);

  if (bp) {
    bull++;
    br.push("Bullish PA");
  }

  if (sp) {
    bear++;
    sr.push("Bearish PA");
  }

  // =========================================================
  // 6. CANDLE DIRECTION
  // =========================================================

  if (r.close > r.open) {
    bull++;
    br.push("Candle bullish");
  }

  if (r.close < r.open) {
    bear++;
    sr.push("Candle bearish");
  }

  // =========================================================
  // FINAL SIGNAL
  // =========================================================

  if (bull >= minScore && bull > bear) {
    return makeSignal(
      asset,
      "CALL",
      bull,
      r,
      br
    );
  }

  if (bear >= minScore && bear > bull) {
    return makeSignal(
      asset,
      "PUT",
      bear,
      r,
      sr
    );
  }

  return null;
}

function makeSignal(
  asset,
  direction,
  score,
  r,
  reasons
) {
  const entry =
    new Date(r.time.getTime() + 60000);

  return {
    asset,
    direction,
    score,
    signalTime: r.time.toISOString(),
    entryTime: entry.toISOString(),
    entryPrice: r.close,
    reasons
  };
}

export function candleKey(iso) {
  return new Date(iso)
    .toISOString()
    .slice(0, 16);
}

export function formatSignal(
  sig,
  tz = "Asia/Jakarta"
) {
  const fmt =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });

  const d =
    sig.direction === "CALL"
      ? "🟢"
      : "🔴";

  return `${d} <b>NEW FUTURE SIGNAL</b>

🌐 Asset: <b>${escapeHtml(sig.asset)}</b>
🕐 TF: M1
⏰ Entry: <b>${fmt.format(new Date(sig.entryTime))}</b>
📌 Direction: <b>${sig.direction}</b>
📊 Confirmation: <b>${sig.score}/10</b>
💰 Reference close: ${sig.entryPrice}

${sig.reasons
  .slice(0, 6)
  .map(x => "🔎 " + escapeHtml(x))
  .join("\n")}

🔒 Candle: CLOSED
⚠️ Rule-based signal, not a guarantee.`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
