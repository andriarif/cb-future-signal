import { createClient } from "@supabase/supabase-js";

import {
  normalizeCandles,
  analyze
} from "../signal-engine.js";


// =====================================
// SUPABASE
// =====================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// =====================================
// SETTINGS
// =====================================

const ASSETS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD"
];

const TIMEZONE = "Asia/Jakarta";

const TIMEFRAME = "M1";

const EXPIRATION_MINUTES = 1;

const MIN_SCORE = Number(
  process.env.MIN_SIGNAL_SCORE || 2
);


// =====================================
// SYMBOL OTCHARTS
// =====================================

function symbolFor(asset) {

  return (
    asset.replace("/", "") +
    "_otc"
  );

}


// =====================================
// GET CANDLES
// =====================================

async function getCandles(asset) {

  const symbol =
    symbolFor(asset);

  const url =
    "https://otcharts.com/v1/candles" +
    "?venue=otc" +
    "&symbol=" +
    encodeURIComponent(symbol) +
    "&tf=60" +
    "&limit=100";


  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.OTCHARTS_API_KEY}`
        }
      }
    );


  if (!response.ok) {

    throw new Error(
      `OTCharts ${response.status}: ` +
      await response.text()
    );

  }


  return await response.json();

}


// =====================================
// TELEGRAM
// =====================================

async function sendTelegram(text) {

  const url =
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;


  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({

          chat_id:
            process.env.TELEGRAM_CHAT_ID,

          text

        })

      }
    );


  if (!response.ok) {

    throw new Error(
      `Telegram ${response.status}: ` +
      await response.text()
    );

  }

}


// =====================================
// WIB TIME
// =====================================

function formatWIB(date) {

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: TIMEZONE,

      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",

      hour12: false
    }
  ).format(date);

}


// =====================================
// TELEGRAM SIGNAL MESSAGE
// =====================================

function buildSignalMessage(signal) {

  const directionText =
    signal.direction === "CALL"
      ? "BUY"
      : "SELL";


  const directionIcon =
    signal.direction === "CALL"
      ? "🟩"
      : "🟥";


  return `⚡ SIGNAL


🌐 ${signal.asset} OTC

Timeframe: M1

⏱ Expiration: 1 minute

⏰ Entry:
${formatWIB(new Date(signal.entryTime))} WIB

${directionIcon} Direction:
${directionText}


📊 Confirmation:
${signal.score}/10


${signal.reasons
  .map(reason => `🔎 ${reason}`)
  .join("\n")}


⚠️ Entry sesuai waktu signal`;

}


// =====================================
// CHECK ACTIVE SIGNAL
// =====================================

async function getActiveSignal() {

  const {
    data,
    error
  } = await supabase
    .from("signals")
    .select(
      "id,asset,direction,score,entry_time,expiry_time,result"
    )
    .eq(
      "result",
      "PENDING"
    )
    .order(
      "id",
      {
        ascending: false
      }
    )
    .limit(1);


  if (error) {

    throw new Error(
      `Supabase active signal: ${error.message}`
    );

  }


  return data && data.length
    ? data[0]
    : null;

}


// =====================================
// SCAN
// =====================================

export default async function handler(
  req,
  res
) {

  try {

    // =================================
    // JANGAN BUAT SIGNAL BARU
    // JIKA MASIH ADA PENDING
    // =================================

    const activeSignal =
      await getActiveSignal();


    if (activeSignal) {

      return res.status(200).json({

        ok: true,

        timeframe:
          TIMEFRAME,

        timezone:
          TIMEZONE,

        expirationMinutes:
          EXPIRATION_MINUTES,

        newSignals: 0,

        status:
          "WAITING_ACTIVE_SIGNAL",

        activeSignal

      });

    }


    // =================================
    // SCAN SEMUA ASSET
    // =================================

    const candidates = [];

    const results = [];


    for (
      const asset of ASSETS
    ) {

      try {

        const raw =
          await getCandles(asset);


        const candles =
          normalizeCandles(raw);


        if (
          candles.length < 60
        ) {

          results.push({

            asset,

            status:
              "NOT_ENOUGH_CANDLES",

            candles:
              candles.length

          });

          continue;

        }


        // =================================
        // ANALYZE
        // =================================

        const signal =
          analyze(
            asset,
            candles,
            MIN_SCORE
          );


        if (!signal) {

          results.push({

            asset,

            status:
              "NO_SIGNAL"

          });

          continue;

        }


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
            signal.score

        });


      }
      catch (error) {

        results.push({

          asset,

          status:
            "ERROR",

          error:
            error.message

        });

      }

    }


    // =================================
    // TIDAK ADA SIGNAL
    // =================================

    if (
      candidates.length === 0
    ) {

      return res.status(200).json({

        ok: true,

        timeframe:
          TIMEFRAME,

        timezone:
          TIMEZONE,

        expirationMinutes:
          EXPIRATION_MINUTES,

        newSignals: 0,

        results

      });

    }


    // =================================
    // SCORE TERTINGGI
    // =================================

    candidates.sort(
      (a, b) =>
        b.score - a.score
    );


    const best =
      candidates[0];


    // =================================
    // ENTRY TIME
    // =================================

    const now =
      new Date();


    let entryTime =
      new Date(
        best.entryTime
      );


    let expiryTime =
      new Date(
        best.expiryTime
      );


    // =================================
    // CEK SIGNAL BASI
    // =================================

    if (
      entryTime.getTime()
      <= now.getTime()
    ) {

      return res.status(200).json({

        ok: true,

        timeframe:
          TIMEFRAME,

        timezone:
          TIMEZONE,

        newSignals: 0,

        status:
          "SIGNAL_TOO_LATE",

        entryTime:
          entryTime.toISOString(),

        now:
          now.toISOString(),

        results

      });

    }


    // =================================
    // SIGNAL KEY
    // =================================

    const signalKey =
      `${best.asset}|${best.direction}|${entryTime.toISOString()}`;


    // =================================
    // CEK DUPLIKAT
    // =================================

    const {
      data: duplicate,
      error: duplicateError
    } =
      await supabase
        .from("signals")
        .select("id")
        .eq(
          "signal_key",
          signalKey
        )
        .maybeSingle();


    if (duplicateError) {

      throw new Error(
        `Duplicate check: ${duplicateError.message}`
      );

    }


    if (duplicate) {

      return res.status(200).json({

        ok: true,

        timeframe:
          TIMEFRAME,

        timezone:
          TIMEZONE,

        newSignals: 0,

        status:
          "DUPLICATE",

        results

      });

    }


    // =================================
    // INSERT PENDING
    // =================================

    const {
      data: inserted,
      error: insertError
    } =
      await supabase
        .from("signals")
        .insert({

          asset:
            best.asset,

          timeframe:
            TIMEFRAME,

          direction:
            best.direction,

          score:
            best.score,

          signal_key:
            signalKey,

          signal_time:
            now.toISOString(),

          entry_time:
            entryTime.toISOString(),

          expiry_time:
            expiryTime.toISOString(),

          entry_price:
            best.entryPrice,

          expiration_minutes:
            EXPIRATION_MINUTES,

          result:
            "PENDING",

          reasons:
            best.reasons

        })
        .select()
        .single();


    // =================================
    // JIKA INSERT GAGAL
    // =================================

    if (insertError) {

      throw new Error(
        `INSERT SIGNAL ERROR: ${insertError.message}`
      );

    }


    // =================================
    // TELEGRAM
    // =================================

    await sendTelegram(
      buildSignalMessage({
        ...best,
        entryTime:
          entryTime.toISOString()
      })
    );


    // =================================
    // SUCCESS
    // =================================

    return res.status(200).json({

      ok: true,

      timeframe:
        TIMEFRAME,

      timezone:
        TIMEZONE,

      expirationMinutes:
        EXPIRATION_MINUTES,

      newSignals: 1,

      selected: {

        id:
          inserted.id,

        asset:
          best.asset,

        direction:
          best.direction,

        score:
          best.score,

        entryTime:
          entryTime.toISOString(),

        expiryTime:
          expiryTime.toISOString(),

        result:
          "PENDING"

      },

      results

    });


  }
  catch (error) {

    console.error(
      "SCAN ERROR:",
      error
    );


    return res.status(500).json({

      ok: false,

      step:
        "SCAN",

      error:
        error.message,

      stack:
        process.env.NODE_ENV ===
        "development"
          ? error.stack
          : undefined

    });

  }

}
