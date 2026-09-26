import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const OTCHARTS_API_KEY = process.env.OTCHARTS_API_KEY;
const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID;

const MIN_SCORE = Number(
  process.env.MIN_SIGNAL_SCORE || 2
);

// Tampilan waktu Telegram.
// Sesuai contoh gambar: UTC +6
const DISPLAY_UTC_OFFSET = Number(
  process.env.DISPLAY_UTC_OFFSET || 6
);

const ASSETS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY"
];

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// =====================================================
// OTCHARTS
// =====================================================

function symbolFor(asset) {
  return `${asset.replace("/", "")}_otc`;
}

async function getCandles(asset) {
  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbolFor(asset))}` +
    `&tf=60` +
    `&limit=250`;

  const response = await fetch(url, {
    headers: {
      Authorization:
        `Bearer ${OTCHARTS_API_KEY}`
    }
  });

  if (!response.ok) {
    throw new Error(
      `OTCharts HTTP ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  return Array.isArray(data)
    ? data
    : (data.candles || data.data || []);
}

// =====================================================
// NORMALIZE CANDLE
// =====================================================

function normalizeCandle(c) {
  return {
    time: Number(
      c.time ??
      c.timestamp ??
      c.t
    ),
    open: Number(
      c.open ??
      c.o
    ),
    high: Number(
      c.high ??
      c.h
    ),
    low: Number(
      c.low ??
      c.l
    ),
    close: Number(
      c.close ??
      c.c
    )
  };
}

// =====================================================
// TELEGRAM
// =====================================================

async function sendTelegram(text) {
  const url =
    `https://api.telegram.org/bot` +
    `${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text
    })
  });

  if (!response.ok) {
    throw new Error(
      `Telegram HTTP ${response.status}: ${await response.text()}`
    );
  }
}

// =====================================================
// TIME FORMAT
// =====================================================

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDisplayDate(timestamp) {
  const date = new Date(
    timestamp + DISPLAY_UTC_OFFSET * 60 * 60 * 1000
  );

  return (
    `${date.getUTCFullYear()}.` +
    `${pad2(date.getUTCMonth() + 1)}.` +
    `${pad2(date.getUTCDate())}`
  );
}

function formatDisplayTime(timestamp) {
  const date = new Date(
    timestamp + DISPLAY_UTC_OFFSET * 60 * 60 * 1000
  );

  return (
    `${pad2(date.getUTCHours())}:` +
    `${pad2(date.getUTCMinutes())}`
  );
}

// =====================================================
// SIGNAL ENGINE
// =====================================================

async function analyzeAsset(asset) {
  const rawCandles =
    await getCandles(asset);

  const candles = rawCandles
    .map(normalizeCandle)
    .filter(c =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    )
    .sort(
      (a, b) => a.time - b.time
    );

  if (candles.length < 60) {
    return {
      asset,
      signal: null,
      error:
        `Candle tidak cukup: ${candles.length}`
    };
  }

  /*
   * signal-engine.js adalah engine utama
   * yang sudah kita buat sebelumnya.
   */
  const engine =
    await import("../signal-engine.js");

  const analysis =
    engine.analyze(
      asset,
      candles,
      MIN_SCORE
    );

  if (!analysis) {
    return {
      asset,
      signal: null
    };
  }

  return {
    asset,
    signal: analysis
  };
}

// =====================================================
// MAIN
// =====================================================

export default async function handler(req, res) {
  const scannedAt =
    new Date().toISOString();

  const results = [];
  const newSignals = [];

  try {
    for (const asset of ASSETS) {
      try {
        const result =
          await analyzeAsset(asset);

        if (result.error) {
          results.push({
            asset,
            status: "ERROR",
            error: result.error
          });

          continue;
        }

        if (!result.signal) {
          results.push({
            asset,
            status: "NO_SIGNAL"
          });

          continue;
        }

        const signal =
          result.signal;

        const direction =
          String(
            signal.direction || ""
          ).toUpperCase();

        const entryTime =
          Number(
            signal.entryTime
          );

        const entryPrice =
          Number(
            signal.entryPrice
          );

        const score =
          Number(
            signal.score || 0
          );

        const reasons =
          Array.isArray(signal.reasons)
            ? signal.reasons
            : [];

        if (
          !direction ||
          !Number.isFinite(entryTime) ||
          !Number.isFinite(entryPrice)
        ) {
          results.push({
            asset,
            status: "ERROR",
            error:
              "Signal engine menghasilkan data tidak lengkap."
          });

          continue;
        }

        /*
         * Kunci unik signal.
         * Mencegah signal yang sama dikirim
         * berkali-kali saat scanner dipanggil.
         */
        const signalKey =
          `${asset}|${direction}|${entryTime}`;

        // -------------------------------------------------
        // CHECK DUPLICATE
        // -------------------------------------------------

        const {
          data: existing,
          error: checkError
        } = await supabase
          .from("signals")
          .select("id")
          .eq(
            "asset",
            asset
          )
          .eq(
            "signal_key",
            signalKey
          )
          .maybeSingle();

        if (checkError) {
          throw new Error(
            `SUPABASE_CHECK: ${checkError.message}`
          );
        }

        if (existing) {
          results.push({
            asset,
            status: "DUPLICATE",
            direction,
            score
          });

          continue;
        }

        // -------------------------------------------------
        // INSERT PENDING
        // -------------------------------------------------

        const {
          data: inserted,
          error: insertError
        } = await supabase
          .from("signals")
          .insert({
            asset,
            timeframe: "M1",
            direction,
            score,
            signal_key: signalKey,
            signal_time:
              new Date().toISOString(),
            entry_time:
              new Date(
                entryTime
              ).toISOString(),
            entry_price:
              entryPrice,
            result: "PENDING",
            reasons
          })
          .select()
          .single();

        if (insertError) {
          throw new Error(
            `SUPABASE_INSERT: ${insertError.message}`
          );
        }

        // -------------------------------------------------
        // ADD TO FUTURE LIST
        // -------------------------------------------------

        newSignals.push({
          id: inserted?.id,
          asset,
          direction,
          score,
          entryTime,
          entryPrice,
          reasons
        });

        results.push({
          asset,
          status: "SIGNAL_READY",
          direction,
          score,
          entryTime:
            new Date(
              entryTime
            ).toISOString(),
          entryPrice,
          reasons
        });

      } catch (error) {
        results.push({
          asset,
          status: "ERROR",
          error: error.message
        });
      }
    }

    // ===================================================
    // SEND FUTURE SIGNAL LIST
    // ===================================================

    if (newSignals.length > 0) {
      /*
       * Urutkan berdasarkan waktu entry.
       */
      newSignals.sort(
        (a, b) =>
          a.entryTime - b.entryTime
      );

      const first =
        newSignals[0];

      const displayDate =
        formatDisplayDate(
          first.entryTime
        );

      const lines =
        newSignals.map(signal => {
          const emoji =
            signal.direction === "CALL"
              ? "🟢"
              : "🔴";

          const displayTime =
            formatDisplayTime(
              signal.entryTime
            );

          return (
            `M1 ${signal.asset} (OTC) ` +
            `${displayTime} ` +
            `${emoji} ${signal.direction}`
          );
        });

      const signalCount =
        newSignals.length;

      const message =
`🌐 FUTURE SIGNAL LIST 👑

⏱️ TF: M1 | 🌐 UTC: +${DISPLAY_UTC_OFFSET} | OTC
📅 Date: ${displayDate}
📊 Strategy: Forensic Analysis (FREE)
• Momentum Flow

····························

${lines.join("\n")}

····························

🔺 ${signalCount} signal${signalCount > 1 ? "s" : ""} locked
Enter exactly at the time shown above.

⚠️ This signal is only for Pocket Option

💗 CB SIGNALS PRO 💗`;

      await sendTelegram(message);
    }

    return res.status(200).json({
      ok: true,
      scannedAt,
      minScore: MIN_SCORE,
      timezone:
        `UTC+${DISPLAY_UTC_OFFSET}`,
      newSignals:
        newSignals.length,
      results
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      step: "SCAN",
      error: error.message
    });
  }
}
