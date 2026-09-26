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
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

async function getCandles(asset) {
  const key = process.env.OTCHARTS_API_KEY;

  if (!key) {
    throw new Error("OTCHARTS_API_KEY belum diatur.");
  }

  const symbol = asset.replace("/", "") + "_otc";

  const url = new URL("https://otcharts.com/v1/candles");

  url.searchParams.set("venue", "otc");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("tf", "60");
  url.searchParams.set("limit", "250");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${key}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `OTCharts ${asset}: HTTP ${response.status} ${body}`
    );
  }

  const data = await response.json();

  if (!Array.isArray(data.candles)) {
    throw new Error(
      `OTCharts ${asset}: format candles tidak valid.`
    );
  }

  return data.candles;
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum diatur."
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
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
    const body = await response.text();

    throw new Error(
      `Telegram HTTP ${response.status}: ${body}`
    );
  }

  return response.json();
}

async function processAsset(asset) {
  const raw = await getCandles(asset);
  const candles = normalizeCandles(raw);

  if (candles.length < 220) {
    return {
      asset,
      status: "SKIP",
      reason: `Candle M1 hanya ${candles.length}, minimal 220`
    };
  }

  const signal = analyze(
    asset,
    candles,
    Number(process.env.MIN_SCORE || 4)
  );

  if (!signal) {
    return {
      asset,
      status: "NO_SIGNAL"
    };
  }

  const signalKey =
    `${asset}:${candleKey(signal.signalTime)}:${signal.direction}`;

  const { data: existing, error: checkError } =
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

  const row = {
    asset,
    timeframe: "M1",
    direction: signal.direction,
    score: signal.score,
    signal_key: signalKey,
    signal_time: signal.signalTime,
    entry_time: signal.entryTime,
    entry_price: signal.entryPrice,
    result: "PENDING",
    reasons: signal.reasons
  };

  const { error: insertError } =
    await supabase
      .from("signals")
      .insert(row);

  if (insertError) {
    throw insertError;
  }

  await sendTelegram(
    formatSignal(
      signal,
      process.env.TELEGRAM_TIMEZONE || "Asia/Jakarta"
    )
  );

  return {
    asset,
    status: "SIGNAL_SENT",
    direction: signal.direction,
    score: signal.score,
    entryTime: signal.entryTime
  };
}

export async function GET(request) {
  try {
    const url = new URL(request.url);

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

    for (const asset of ASSETS) {
      try {
        results.push(
          await processAsset(asset)
        );
      } catch (error) {
        results.push({
          asset,
          status: "ERROR",
          error: error.message
        });
      }
    }

    return json({
      ok: true,
      scannedAt: new Date().toISOString(),
      assets: ASSETS,
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
