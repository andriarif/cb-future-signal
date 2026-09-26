import { createClient } from "@supabase/supabase-js";

import {
  normalizeCandles,
  analyze,
  candleKey,
  formatSignal
} from "../signal-engine.js";


// ============================================================
// SUPABASE
// ============================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


// ============================================================
// ASSETS
// ============================================================

const ASSETS = (
  process.env.ASSETS ||
  "EUR/USD,GBP/USD,USD/JPY"
)
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);


// ============================================================
// JSON RESPONSE
// ============================================================

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


// ============================================================
// ERROR DETAIL
// ============================================================

function errorDetail(error) {
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
// OTCHARTS - GET M1 CANDLES
// ============================================================

async function getCandles(asset) {

  const key = process.env.OTCHARTS_API_KEY;

  if (!key) {
    throw new Error(
      "OTCHARTS_API_KEY belum diatur."
    );
  }


  // EUR/USD -> EURUSD_otc
  // GBP/USD -> GBPUSD_otc
  // USD/JPY -> USDJPY_otc

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

  // 60 detik = M1
  url.searchParams.set(
    "tf",
    "60"
  );

  // 250 candle M1
  url.searchParams.set(
    "limit",
    "250"
  );


  let response;

  try {

    response = await fetch(
      url,
      {
        method: "GET",

        headers: {
          "accept": "application/json",
          "authorization": `Bearer ${key}`
        },

        cache: "no-store"
      }
    );

  } catch (error) {

    const detail =
      errorDetail(error);

    throw new Error(
      `OTCharts FETCH FAILED ${asset} | ` +
      `symbol=${symbol} | ` +
      `name=${detail.name} | ` +
      `message=${detail.message} | ` +
      `cause=${JSON.stringify(detail.cause)}`
    );
  }


  // ==========================================================
  // HTTP ERROR
  // ==========================================================

  if (!response.ok) {

    let body = "";

    try {
      body = await response.text();
    } catch {
      body = "Tidak bisa membaca response body.";
    }

    throw new Error(
      `OTCharts ${asset}: ` +
      `HTTP ${response.status} ` +
      `${response.statusText} ` +
      `${body}`
    );
  }


  // ==========================================================
  // JSON
  // ==========================================================

  let data;

  try {

    data = await response.json();

  } catch (error) {

    throw new Error(
      `OTCharts ${asset}: ` +
      `response bukan JSON. ` +
      `${error.message}`
    );
  }


  // ==========================================================
  // VALIDASI CANDLE
  // ==========================================================

  if (!data) {

    throw new Error(
      `OTCharts ${asset}: response kosong.`
    );
  }


  if (!Array.isArray(data.candles)) {

    throw new Error(
      `OTCharts ${asset}: ` +
      `format candles tidak valid.`
    );
  }


  if (data.candles.length === 0) {

    throw new Error(
      `OTCharts ${asset}: ` +
      `candles kosong.`
    );
  }


  return data.candles;
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
      `Telegram HTTP ` +
      `${response.status}: ${body}`
    );
  }


  return response.json();
}


// ============================================================
// PROCESS ONE ASSET
// ============================================================

async function processAsset(asset) {

  // ----------------------------------------------------------
  // GET CANDLES
  // ----------------------------------------------------------

  const raw =
    await getCandles(asset);


  // ----------------------------------------------------------
  // NORMALIZE
  // ----------------------------------------------------------

  const candles =
    normalizeCandles(raw);


  // ----------------------------------------------------------
  // CHECK MINIMUM CANDLE
  // ----------------------------------------------------------

  if (candles.length < 220) {

    return {
      asset,
      status: "SKIP",
      candleCount: candles.length,
      reason:
        "Candle M1 kurang dari 220."
    };
  }


  // ----------------------------------------------------------
  // ANALYZE
  // ----------------------------------------------------------

  const signal =
    analyze(
      asset,
      candles,

      // ======================================================
      // SIGNAL LONGGAR
      // minimum score = 2
      // ======================================================

      Number(
        process.env.MIN_SCORE || 2
      )
    );


  // ----------------------------------------------------------
  // NO SIGNAL
  // ----------------------------------------------------------

  if (!signal) {

    return {
      asset,
      status: "NO_SIGNAL",
      candleCount: candles.length
    };
  }


  // ----------------------------------------------------------
  // SIGNAL KEY
  // ----------------------------------------------------------

  const signalKey =
    `${asset}:` +
    `${candleKey(signal.signalTime)}:` +
    `${signal.direction}`;


  // ----------------------------------------------------------
  // CHECK DUPLICATE
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // DUPLICATE
  // ----------------------------------------------------------

  if (existing) {

    return {
      asset,
      status: "DUPLICATE",
      signalKey
    };
  }


  // ----------------------------------------------------------
  // DATABASE ROW
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // INSERT SUPABASE
  // ----------------------------------------------------------

  const {
    error: insertError
  } =
    await supabase
      .from("signals")
      .insert(row);


  if (insertError) {
    throw insertError;
  }


  // ----------------------------------------------------------
  // TELEGRAM
  // ----------------------------------------------------------

  await sendTelegram(
    formatSignal(
      signal,
      process.env.TELEGRAM_TIMEZONE ||
      "Asia/Jakarta"
    )
  );


  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

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


    // --------------------------------------------------------
    // CRON SECRET
    // --------------------------------------------------------

    const secret =
      url.searchParams.get(
        "secret"
      ) ||
      request.headers.get(
        "x-cron-secret"
      );


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


    // --------------------------------------------------------
    // PROCESS ALL ASSETS
    // --------------------------------------------------------

    const results = [];


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
            errorDetail(error)
        });
      }
    }


    // --------------------------------------------------------
    // FINAL RESPONSE
    // --------------------------------------------------------

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
          errorDetail(error)
      },

      500

    );
  }
}
