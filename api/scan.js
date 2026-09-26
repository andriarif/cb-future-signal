import { createClient } from "@supabase/supabase-js";

import {
  normalizeCandles,
  analyze,
  candleKey,
  formatSignal
} from "../signal-engine.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ASSETS = (
  process.env.ASSETS ||
  "EUR/USD,GBP/USD,USD/JPY"
)
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorInfo(error) {
  return {
    name: error?.name || null,
    message: error?.message || null,
    cause: error?.cause
      ? {
          name: error.cause.name || null,
          code: error.cause.code || null,
          message: error.cause.message || null
        }
      : null
  };
}


// ============================================================
// OTCHARTS CANDLES
// ============================================================

async function getCandles(asset) {

  const key = process.env.OTCHARTS_API_KEY;

  if (!key) {
    throw new Error(
      "OTCHARTS_API_KEY belum diatur."
    );
  }

  const symbol =
    asset.replace("/", "") + "_otc";

  const url =
    new URL(
      "https://otcharts.com/v1/candles"
    );

  url.searchParams.set(
    "venue",
    "otc"
  );

  url.searchParams.set(
    "symbol",
    symbol
  );

  url.searchParams.set(
    "tf",
    "60"
  );

  url.searchParams.set(
    "limit",
    "250"
  );


  let lastError = null;


  // ==========================================================
  // RETRY 3X
  // ==========================================================

  for (let attempt = 1; attempt <= 3; attempt++) {

    try {

      const response = await fetch(
        url,
        {
          method: "GET",

          headers: {
            "accept": "application/json",
            "authorization": `Bearer ${key}`,
            "user-agent": "CB-Future-Signal/1.0"
          },

          cache: "no-store"
        }
      );


      // ------------------------------------------------------
      // HTTP ERROR
      // ------------------------------------------------------

      if (!response.ok) {

        const body =
          await response.text();

        throw new Error(
          `OTCharts HTTP ${response.status} ` +
          `${response.statusText} ` +
          `${body}`
        );
      }


      // ------------------------------------------------------
      // JSON
      // ------------------------------------------------------

      const data =
        await response.json();


      if (!data) {
        throw new Error(
          "OTCharts response kosong."
        );
      }


      if (!Array.isArray(data.candles)) {
        throw new Error(
          "OTCharts format candles tidak valid."
        );
      }


      if (data.candles.length === 0) {
        throw new Error(
          "OTCharts candles kosong."
        );
      }


      return data.candles;


    } catch (error) {

      lastError = error;


      // Kalau masih ada retry
      if (attempt < 3) {

        await sleep(
          700 * attempt
        );

      }

    }

  }


  // ==========================================================
  // SEMUA RETRY GAGAL
  // ==========================================================

  const info =
    getErrorInfo(lastError);

  throw new Error(
    `OTCharts FETCH FAILED | ` +
    `asset=${asset} | ` +
    `symbol=${symbol} | ` +
    `attempts=3 | ` +
    `name=${info.name} | ` +
    `message=${info.message} | ` +
    `cause=${JSON.stringify(info.cause)}`
  );
}


// ============================================================
// TELEGRAM
// ============================================================

async function sendTelegram(message) {

  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  const chatId =
    process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN atau " +
      "TELEGRAM_CHAT_ID belum diatur."
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true
        })
      }
    );


  if (!response.ok) {

    const body =
      await response.text();

    throw new Error(
      `Telegram HTTP ${response.status}: ${body}`
    );
  }

  return response.json();
}


// ============================================================
// PROCESS ASSET
// ============================================================

async function processAsset(asset) {

  const raw =
    await getCandles(asset);


  const candles =
    normalizeCandles(raw);


  if (candles.length < 220) {

    return {
      asset,
      status: "SKIP",
      candleCount: candles.length,
      reason:
        "Candle M1 kurang dari 220."
    };
  }


  // ==========================================================
  // MIN SCORE = 2
  // ==========================================================

  const signal =
    analyze(
      asset,
      candles,
      Number(
        process.env.MIN_SCORE || 2
      )
    );


  if (!signal) {

    return {
      asset,
      status: "NO_SIGNAL",
      candleCount: candles.length
    };
  }


  const signalKey =
    `${asset}:` +
    `${candleKey(signal.signalTime)}:` +
    `${signal.direction}`;


  // ==========================================================
  // DUPLICATE CHECK
  // ==========================================================

  const {
    data: existing,
    error: checkError
  } =
    await supabase
      .from("signals")
      .select("id")
      .eq("asset", asset)
      .eq("signal_key", signalKey)
      .maybeSingle();


  if (checkError) {
    throw checkError;
  }


  if (existing) {

    return {
      asset,
      status: "DUPLICATE",
      signalKey
    };
  }


  // ==========================================================
  // SAVE SIGNAL
  // ==========================================================

  const row = {

    asset,

    timeframe:
      "M1",

    direction:
      signal.direction,

    score:
      signal.score,

    signal_key:
      signalKey,

    signal_time:
      signal.signalTime,

    entry_time:
      signal.entryTime,

    entry_price:
      signal.entryPrice,

    result:
      "PENDING",

    reasons:
      signal.reasons
  };


  const {
    error: insertError
  } =
    await supabase
      .from("signals")
      .insert(row);


  if (insertError) {
    throw insertError;
  }


  // ==========================================================
  // SEND TELEGRAM
  // ==========================================================

  await sendTelegram(
    formatSignal(
      signal,
      process.env.TELEGRAM_TIMEZONE ||
      "Asia/Jakarta"
    )
  );


  return {

    asset,

    status:
      "SIGNAL_SENT",

    direction:
      signal.direction,

    score:
      signal.score,

    entryTime:
      signal.entryTime,

    entryPrice:
      signal.entryPrice,

    reasons:
      signal.reasons
  };
}


// ============================================================
// GET /api/scan
// ============================================================

export async function GET(request) {

  try {

    const url =
      new URL(request.url);


    const secret =
      url.searchParams.get("secret") ||
      request.headers.get("x-cron-secret");


    if (
      process.env.CRON_SECRET &&
      secret !== process.env.CRON_SECRET
    ) {

      return json(
        {
          ok: false,
          error: "Unauthorized"
        },
        401
      );
    }


    const results = [];


    // ========================================================
    // SCAN SATU PER SATU
    // ========================================================

    for (
      const asset of ASSETS
    ) {

      try {

        results.push(
          await processAsset(asset)
        );

      } catch (error) {

        results.push({

          asset,

          status:
            "ERROR",

          error:
            error.message,

          detail:
            getErrorInfo(error)
        });
      }


      // jeda kecil antar pair
      await sleep(300);
    }


    return json({

      ok: true,

      scannedAt:
        new Date().toISOString(),

      assets:
        ASSETS,

      minScore:
        Number(
          process.env.MIN_SCORE || 2
        ),

      results

    });


  } catch (error) {

    return json(
      {
        ok: false,

        error:
          error.message,

        detail:
          getErrorInfo(error)
      },
      500
    );
  }
}
