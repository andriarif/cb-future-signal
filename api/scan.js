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


// ============================================================
// OTCHARTS
// ============================================================

async function getCandles(asset) {

  const key =
    process.env.OTCHARTS_API_KEY;

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

  url.searchParams.set("venue", "otc");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("tf", "60");
  url.searchParams.set("limit", "250");

  try {

    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          "accept": "application/json",
          "authorization":
            `Bearer ${key}`
        },
        cache: "no-store"
      });

    if (!response.ok) {

      const body =
        await response.text();

      throw new Error(
        `OTCharts HTTP ${response.status}: ${body}`
      );
    }

    const data =
      await response.json();

    if (!Array.isArray(data.candles)) {
      throw new Error(
        "OTCharts candles tidak valid."
      );
    }

    return data.candles;

  } catch (error) {

    throw new Error(
      `STEP=OTCHARTS | ` +
      `asset=${asset} | ` +
      `${error.message}`
    );
  }
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
      "STEP=TELEGRAM_CONFIG | " +
      "Token atau Chat ID belum diatur."
    );
  }

  try {

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

  } catch (error) {

    throw new Error(
      `STEP=TELEGRAM | ${error.message}`
    );
  }
}


// ============================================================
// PROCESS ASSET
// ============================================================

async function processAsset(asset) {

  // ----------------------------------------------------------
  // 1. OTCHARTS
  // ----------------------------------------------------------

  const raw =
    await getCandles(asset);


  // ----------------------------------------------------------
  // 2. NORMALIZE
  // ----------------------------------------------------------

  let candles;

  try {

    candles =
      normalizeCandles(raw);

  } catch (error) {

    throw new Error(
      `STEP=NORMALIZE | ${error.message}`
    );
  }


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
  // 3. ANALYZE
  // ----------------------------------------------------------

  let signal;

  try {

    signal =
      analyze(
        asset,
        candles,
        Number(
          process.env.MIN_SCORE || 2
        )
      );

  } catch (error) {

    throw new Error(
      `STEP=ANALYZE | ${error.message}`
    );
  }


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
  // 4. SIGNAL KEY
  // ----------------------------------------------------------

  const signalKey =
    `${asset}:` +
    `${candleKey(signal.signalTime)}:` +
    `${signal.direction}`;


  // ----------------------------------------------------------
  // 5. SUPABASE CHECK
  // ----------------------------------------------------------

  let existing;

  try {

    const result =
      await supabase
        .from("signals")
        .select("id")
        .eq("asset", asset)
        .eq("signal_key", signalKey)
        .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    existing =
      result.data;

  } catch (error) {

    throw new Error(
      `STEP=SUPABASE_CHECK | ` +
      `${error.message}`
    );
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
  // 6. INSERT SUPABASE
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


  try {

    const result =
      await supabase
        .from("signals")
        .insert(row);

    if (result.error) {
      throw result.error;
    }

  } catch (error) {

    throw new Error(
      `STEP=SUPABASE_INSERT | ` +
      `${error.message}`
    );
  }


  // ----------------------------------------------------------
  // 7. TELEGRAM
  // ----------------------------------------------------------

  try {

    await sendTelegram(
      formatSignal(
        signal,
        process.env.TELEGRAM_TIMEZONE ||
        "Asia/Jakarta"
      )
    );

  } catch (error) {

    throw new Error(
      `STEP=TELEGRAM_SEND | ` +
      `${error.message}`
    );
  }


  // ----------------------------------------------------------
  // SUCCESS
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

    const secret =
      url.searchParams.get("secret") ||
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
            error.message
        });
      }
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
        error: error.message
      },
      500
    );
  }
}
