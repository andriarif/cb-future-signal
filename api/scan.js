// api/scan.js
// CB Future Signal - M1
// SINGLE BEST SIGNAL
// EMA50 + RSI14
// WIB Asia/Jakarta
// OTC OTCharts

import { createClient } from "@supabase/supabase-js";
import {
  normalizeCandles,
  analyze
} from "../signal-engine.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const OTCHARTS_API_KEY =
  process.env.OTCHARTS_API_KEY;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID;

const MIN_SCORE =
  Number(process.env.MIN_SIGNAL_SCORE || 2);

const TIMEZONE = "Asia/Jakarta";

const TIMEFRAME = "M1";

const EXPIRATION_MINUTES = 1;

const ASSETS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD"
];

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);


// ======================================================
// SYMBOL OTCHARTS
// ======================================================

function symbolFor(asset) {
  return asset
    .replace("/", "")
    .toUpperCase() + "_otc";
}


// ======================================================
// FORMAT WIB
// ======================================================

function formatWIB(date) {
  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }
  ).format(new Date(date));
}


// ======================================================
// FORMAT JAM WIB
// ======================================================

function formatTimeWIB(date) {
  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }
  ).format(new Date(date));
}


// ======================================================
// GET CANDLES
// ======================================================

async function getCandles(asset) {

  const symbol = symbolFor(asset);

  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&tf=60` +
    `&limit=120`;

  const response = await fetch(
    url,
    {
      method: "GET",
      headers: {
        Authorization:
          `Bearer ${OTCHARTS_API_KEY}`
      }
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `OTCharts ${response.status}: ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Response OTCharts bukan JSON"
    );
  }
}


// ======================================================
// TELEGRAM
// ======================================================

async function sendTelegram(text) {

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text
      })
    }
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Telegram ${response.status}: ${responseText}`
    );
  }

  return responseText;
}


// ======================================================
// FORMAT SIGNAL TELEGRAM
// ======================================================

function formatSignal(signal) {

  const direction =
    signal.direction === "CALL"
      ? "BUY"
      : "SELL";

  const arrow =
    signal.direction === "CALL"
      ? "🟢"
      : "🔴";

  let text = "";

  text += "⚡ SIGNAL\n\n";

  text += `🌐 ${signal.asset} OTC\n\n`;

  text += `Timeframe: ${TIMEFRAME}\n`;

  text += `⏱ Expiration: ${EXPIRATION_MINUTES} minute\n\n`;

  text += "⏰ Entry:\n";

  text += `${formatTimeWIB(signal.entryTime)} WIB\n\n`;

  text += `${arrow} Direction:\n`;

  text += `${direction}\n\n`;

  text += `📊 Confirmation:\n`;

  text += `${signal.score}/10\n\n`;

  if (
    Array.isArray(signal.reasons) &&
    signal.reasons.length > 0
  ) {

    for (
      const reason of signal.reasons
    ) {

      text += `🔎 ${reason}\n`;

    }

    text += "\n";
  }

  text += "⚠️ Entry sesuai waktu signal";

  return text;
}


// ======================================================
// CLOSED M1 CANDLE
// ======================================================

function getLatestClosedCandle(candles) {

  if (!candles.length) {
    return null;
  }

  const now = Date.now();

  const currentMinute =
    Math.floor(now / 60000) * 60000;

  const closed =
    candles.filter(
      c =>
        c.time.getTime() <
        currentMinute
    );

  if (!closed.length) {
    return null;
  }

  return closed[closed.length - 1];
}


// ======================================================
// ANALYZE ASSET
// ======================================================

async function analyzeAsset(asset) {

  const raw =
    await getCandles(asset);

  const candles =
    normalizeCandles(raw);

  if (candles.length < 60) {

    return {
      asset,
      signal: null,
      error:
        `Candle kurang: ${candles.length}`
    };
  }

  const closedCandle =
    getLatestClosedCandle(candles);

  if (!closedCandle) {

    return {
      asset,
      signal: null,
      error:
        "Tidak ada candle M1 closed"
    };
  }

  const closedCandles =
    candles.filter(
      c =>
        c.time.getTime() <=
        closedCandle.time.getTime()
    );

  const signal =
    analyze(
      asset,
      closedCandles,
      MIN_SCORE
    );

  if (!signal) {

    return {
      asset,
      signal: null,
      closedCandle
    };
  }

  // ENTRY = candle berikutnya
  const entryTime =
    new Date(
      closedCandle.time.getTime() +
      60 * 1000
    );

  // EXPIRY = 1 menit setelah entry
  const expiryTime =
    new Date(
      entryTime.getTime() +
      EXPIRATION_MINUTES * 60 * 1000
    );

  const now =
    Date.now();

  // Jangan kirim signal kalau entry sudah lewat
  if (
    entryTime.getTime() <= now
  ) {

    return {
      asset,
      signal: null,
      stale: true,
      closedCandle,
      entryTime
    };
  }

  signal.entryTime =
    entryTime.toISOString();

  signal.expiryTime =
    expiryTime.toISOString();

  signal.expirationMinutes =
    EXPIRATION_MINUTES;

  signal.sourceCandleTime =
    closedCandle.time.toISOString();

  signal.entryPrice =
    closedCandle.close;

  return {
    asset,
    signal,
    closedCandle
  };
}


// ======================================================
// MAIN
// ======================================================

export default async function handler(
  req,
  res
) {

  try {

    // ==================================================
    // 1. CEK PENDING
    // ==================================================

    const {
      data: pending,
      error: pendingError
    } =
      await supabase
        .from("signals")
        .select(
          "id,asset,direction,score,entry_time,expiry_time,result"
        )
        .eq(
          "result",
          "PENDING"
        )
        .order(
          "entry_time",
          {
            ascending: true
          }
        )
        .limit(1);

    if (pendingError) {
      throw new Error(
        `Supabase PENDING: ${pendingError.message}`
      );
    }


    // ==================================================
    // MASIH ADA PENDING
    // ==================================================

    if (
      pending &&
      pending.length > 0
    ) {

      const p =
        pending[0];

      return res.status(200).json({

        ok: true,

        status:
          "WAITING_PENDING",

        timeframe:
          TIMEFRAME,

        timezone:
          TIMEZONE,

        expirationMinutes:
          EXPIRATION_MINUTES,

        pending: {

          id:
            p.id,

          asset:
            p.asset,

          direction:
            p.direction,

          score:
            p.score,

          entryTime:
            p.entry_time,

          entryWIB:
            formatWIB(
              p.entry_time
            ),

          expiryTime:
            p.expiry_time,

          expiryWIB:
            formatWIB(
              p.expiry_time
            ),

          result:
            p.result
        }
      });
    }


    // ==================================================
    // 2. SCAN SEMUA ASSET
    // ==================================================

    const results = [];

    const candidates = [];

    for (
      const asset of ASSETS
    ) {

      try {

        const result =
          await analyzeAsset(
            asset
          );

        if (result.error) {

          results.push({

            asset,

            status:
              "ERROR",

            error:
              result.error
          });

          continue;
        }


        if (result.stale) {

          results.push({

            asset,

            status:
              "STALE",

            entryTime:
              result.entryTime,

            entryWIB:
              formatWIB(
                result.entryTime
              )
          });

          continue;
        }


        if (!result.signal) {

          results.push({

            asset,

            status:
              "NO_SIGNAL"
          });

          continue;
        }


        const signal =
          result.signal;

        candidates.push(
          signal
        );

        results.push({

          asset,

          status:
            "CANDIDATE",

          direction:
            signal.direction,

          score:
            signal.score,

          entryTime:
            signal.entryTime,

          entryWIB:
            formatWIB(
              signal.entryTime
            )
        });

      } catch (error) {

        results.push({

          asset,

          status:
            "ERROR",

          error:
            error?.message ||
            String(error)
        });
      }
    }


    // ==================================================
    // 3. TIDAK ADA SIGNAL
    // ==================================================

    if (
      candidates.length === 0
    ) {

      return res.status(200).json({

        ok: true,

        status:
          "NO_SIGNAL",

        timeframe:
          TIMEFRAME,

        timezone:
          TIMEZONE,

        expirationMinutes:
          EXPIRATION_MINUTES,

        newSignals:
          0,

        results
      });
    }


    // ==================================================
    // 4. PILIH SCORE TERTINGGI
    // ==================================================

    candidates.sort(
      (a, b) => {

        if (
          b.score !== a.score
        ) {

          return (
            b.score -
            a.score
          );
        }

        return (
          new Date(a.entryTime).getTime() -
          new Date(b.entryTime).getTime()
        );
      }
    );


    const selected =
      candidates[0];


    // ==================================================
    // 5. SIGNAL KEY
    // ==================================================

    const signalKey =
      `${selected.asset}|` +
      `${selected.direction}|` +
      `${selected.entryTime}`;


    // ==================================================
    // 6. CEK DUPLIKAT
    // ==================================================

    const {
      data: existing,
      error: existingError
    } =
      await supabase
        .from("signals")
        .select("id")
        .eq(
          "signal_key",
          signalKey
        )
        .limit(1);

    if (existingError) {

      throw new Error(
        `Supabase duplicate check: ${existingError.message}`
      );
    }


    if (
      existing &&
      existing.length > 0
    ) {

      return res.status(200).json({

        ok: true,

        status:
          "DUPLICATE",

        existingId:
          existing[0].id,

        results
      });
    }


    // ==================================================
    // 7. SIMPAN PENDING
    // ==================================================

    const {
      data: inserted,
      error: insertError
    } =
      await supabase
        .from("signals")
        .insert({

          asset:
            selected.asset,

          timeframe:
            TIMEFRAME,

          direction:
            selected.direction,

          score:
            selected.score,

          signal_key:
            signalKey,

          signal_time:
            selected.signalTime,

          source_candle_time:
            selected.sourceCandleTime,

          entry_time:
            selected.entryTime,

          expiry_time:
            selected.expiryTime,

          entry_price:
            selected.entryPrice,

          expiration_minutes:
            EXPIRATION_MINUTES,

          result:
            "PENDING",

          reasons:
            selected.reasons
        })
        .select()
        .single();


    if (insertError) {

      throw new Error(
        `Supabase insert: ${insertError.message}`
      );
    }


    // ==================================================
    // 8. TELEGRAM
    // ==================================================

    const telegramText =
      formatSignal(
        selected
      );

    await sendTelegram(
      telegramText
    );


    // ==================================================
    // 9. RESPONSE
    // ==================================================

    return res.status(200).json({

      ok: true,

      status:
        "SIGNAL_CREATED",

      timeframe:
        TIMEFRAME,

      timezone:
        TIMEZONE,

      expirationMinutes:
        EXPIRATION_MINUTES,

      newSignals:
        1,

      selected: {

        id:
          inserted.id,

        asset:
          selected.asset,

        direction:
          selected.direction,

        score:
          selected.score,

        entryTime:
          selected.entryTime,

        entryWIB:
          formatWIB(
            selected.entryTime
          ),

        expiryTime:
          selected.expiryTime,

        expiryWIB:
          formatWIB(
            selected.expiryTime
          ),

        result:
          "PENDING"
      },

      results
    });


  } catch (error) {

    console.error(
      "SCAN ERROR:",
      error
    );

    return res.status(500).json({

      ok: false,

      step:
        "SCAN",

      error:
        error?.message ||
        String(error)
    });
  }
}
