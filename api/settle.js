// api/settle.js
// CB Future Signal - M1 Settlement
// WIN / LOSS ONLY AFTER EXPIRATION
// OTCharts -2 Hours Correction

import { createClient } from "@supabase/supabase-js";
import {
  normalizeCandles
} from "../signal-engine.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const OTCHARTS_API_KEY =
  process.env.OTCHARTS_API_KEY;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID;

const TIMEZONE =
  "Asia/Jakarta";

const TIMEFRAME =
  "M1";

const EXPIRATION_MINUTES =
  1;

// OTCharts timestamp terbukti +2 jam
const OTCHARTS_CORRECTION_MS =
  -2 * 60 * 60 * 1000;

const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );


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
  ).format(
    new Date(date)
  );
}


// ======================================================
// SYMBOL
// ======================================================

function symbolFor(asset) {

  return (
    asset
      .replace("/", "")
      .toUpperCase() +
    "_otc"
  );
}


// ======================================================
// GET CANDLES
// ======================================================

async function getCandles(asset) {

  const symbol =
    symbolFor(asset);

  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&tf=60` +
    `&limit=20`;

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${OTCHARTS_API_KEY}`
        }
      }
    );

  const text =
    await response.text();

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
// KOREKSI WAKTU OTCHARTS
// ======================================================

function correctCandleTimes(candles) {

  return candles.map(
    candle => ({
      ...candle,

      time:
        new Date(
          candle.time.getTime() +
          OTCHARTS_CORRECTION_MS
        )
    })
  );
}


// ======================================================
// TELEGRAM
// ======================================================

async function sendTelegram(text) {

  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

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
            TELEGRAM_CHAT_ID,

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
// FIND ENTRY CANDLE
// ======================================================

function findEntryCandle(
  candles,
  entryTime
) {

  const target =
    new Date(
      entryTime
    ).getTime();

  if (
    !Number.isFinite(target)
  ) {
    return null;
  }

  // ----------------------------------------------------
  // 1. Cari exact
  // ----------------------------------------------------

  const exact =
    candles.find(
      candle =>
        candle.time.getTime() ===
        target
    );

  if (exact) {
    return exact;
  }

  // ----------------------------------------------------
  // 2. Cari candle terdekat
  //    toleransi maksimal 30 detik
  // ----------------------------------------------------

  let nearest = null;

  let nearestDiff =
    Infinity;

  for (
    const candle of candles
  ) {

    const diff =
      Math.abs(
        candle.time.getTime() -
        target
      );

    if (
      diff < nearestDiff
    ) {

      nearestDiff =
        diff;

      nearest =
        candle;
    }
  }

  if (
    nearest &&
    nearestDiff <=
      30 * 1000
  ) {

    return nearest;
  }

  return null;
}


// ======================================================
// SETTLE
// ======================================================

export default async function handler(
  req,
  res
) {

  try {

    // ==================================================
    // 1. AMBIL PENDING
    // ==================================================

    const {
      data: pending,
      error: pendingError
    } =
      await supabase
        .from("signals")
        .select("*")
        .eq(
          "result",
          "PENDING"
        )
        .order(
          "expiry_time",
          {
            ascending: true
          }
        )
        .limit(20);

    if (pendingError) {

      throw new Error(
        pendingError.message
      );
    }

    if (
      !pending ||
      pending.length === 0
    ) {

      return res.status(200).json({

        ok: true,

        timeframe:
          TIMEFRAME,

        expirationMinutes:
          EXPIRATION_MINUTES,

        checked:
          0,

        results: []

      });
    }


    const now =
      new Date();

    const results = [];


    // ==================================================
    // 2. PROSES PENDING
    // ==================================================

    for (
      const signal of pending
    ) {

      try {

        const expiryTime =
          new Date(
            signal.expiry_time
          );

        // ------------------------------------------------
        // BELUM EXPIRY
        // ------------------------------------------------

        if (
          now.getTime() <
          expiryTime.getTime()
        ) {

          results.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "WAITING_EXPIRY",

            entryTime:
              signal.entry_time,

            entryWIB:
              formatWIB(
                signal.entry_time
              ),

            expiryTime:
              signal.expiry_time,

            expiryWIB:
              formatWIB(
                signal.expiry_time
              )

          });

          continue;
        }


        // =================================================
        // 3. AMBIL CANDLE M1
        // =================================================

        const raw =
          await getCandles(
            signal.asset
          );

        let candles =
          normalizeCandles(
            raw
          );

        if (
          candles.length === 0
        ) {

          results.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "NO_CANDLES"

          });

          continue;
        }


        // =================================================
        // 4. KOREKSI -2 JAM
        // =================================================

        candles =
          correctCandleTimes(
            candles
          );

        candles.sort(
          (a, b) =>
            a.time.getTime() -
            b.time.getTime()
        );


        // =================================================
        // 5. CARI ENTRY CANDLE
        // =================================================

        const entryCandle =
          findEntryCandle(
            candles,
            signal.entry_time
          );


        if (!entryCandle) {

          results.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "ENTRY_CANDLE_NOT_FOUND",

            entryTime:
              signal.entry_time,

            entryWIB:
              formatWIB(
                signal.entry_time
              ),

            expiryTime:
              signal.expiry_time,

            expiryWIB:
              formatWIB(
                signal.expiry_time
              ),

            latestCandle:
              candles.length
                ? candles[
                    candles.length - 1
                  ].time.toISOString()
                : null,

            latestCandleWIB:
              candles.length
                ? formatWIB(
                    candles[
                      candles.length - 1
                    ].time
                  )
                : null

          });

          continue;
        }


        // =================================================
        // 6. PASTIKAN ENTRY CANDLE SUDAH CLOSED
        // =================================================

        const candleCloseTime =
          new Date(
            entryCandle.time.getTime() +
            60 * 1000
          );

        if (
          now.getTime() <
          candleCloseTime.getTime()
        ) {

          results.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "EXPIRY_CANDLE_NOT_CLOSED",

            candleTime:
              entryCandle.time
                .toISOString(),

            candleWIB:
              formatWIB(
                entryCandle.time
              ),

            expectedClose:
              candleCloseTime
                .toISOString(),

            expectedCloseWIB:
              formatWIB(
                candleCloseTime
              )

          });

          continue;
        }


        // =================================================
        // 7. HARGA
        // =================================================

        const entryPrice =
          Number(
            signal.entry_price
          );

        const resultPrice =
          Number(
            entryCandle.close
          );

        if (
          !Number.isFinite(
            entryPrice
          ) ||
          !Number.isFinite(
            resultPrice
          )
        ) {

          results.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "INVALID_PRICE"

          });

          continue;
        }


        // =================================================
        // 8. HITUNG RESULT
        // =================================================

        let result;

        if (
          signal.direction ===
          "CALL"
        ) {

          if (
            resultPrice >
            entryPrice
          ) {

            result =
              "WIN";

          } else if (
            resultPrice <
            entryPrice
          ) {

            result =
              "LOSS";

          } else {

            result =
              "DRAW";
          }

        } else {

          if (
            resultPrice <
            entryPrice
          ) {

            result =
              "WIN";

          } else if (
            resultPrice >
            entryPrice
          ) {

            result =
              "LOSS";

          } else {

            result =
              "DRAW";
          }
        }


        // =================================================
        // 9. UPDATE DATABASE
        // =================================================

        const {
          error: updateError
        } =
          await supabase
            .from("signals")
            .update({

              result,

              result_price:
                resultPrice,

              result_time:
                candleCloseTime
                  .toISOString(),

              settled_at:
                new Date()
                  .toISOString()

            })
            .eq(
              "id",
              signal.id
            )
            .eq(
              "result",
              "PENDING"
            );

        if (updateError) {

          throw new Error(
            updateError.message
          );
        }


        // =================================================
        // 10. TELEGRAM RESULT
        // =================================================

        const emoji =
          result === "WIN"
            ? "✅"
            : result === "LOSS"
              ? "❌"
              : "➖";

        const directionText =
          signal.direction ===
          "CALL"
            ? "BUY"
            : "SELL";

        const telegramText =
`${emoji} RESULT

🌐 ${signal.asset} OTC
Timeframe: M1

📌 Direction: ${directionText}
💰 Entry Price: ${entryPrice}
🏁 Expiry Price: ${resultPrice}

⏰ Entry: ${formatWIB(
  signal.entry_time
)} WIB

⏰ Expiration: ${formatWIB(
  signal.expiry_time
)} WIB

📊 Result: ${result}

⚠️ Result dihitung setelah expiration.`;

        await sendTelegram(
          telegramText
        );


        // =================================================
        // 11. RESPONSE
        // =================================================

        results.push({

          id:
            signal.id,

          asset:
            signal.asset,

          status:
            "SETTLED",

          result,

          entryPrice,

          resultPrice,

          entryTime:
            signal.entry_time,

          entryWIB:
            formatWIB(
              signal.entry_time
            ),

          expiryTime:
            signal.expiry_time,

          expiryWIB:
            formatWIB(
              signal.expiry_time
            ),

          resultTime:
            candleCloseTime
              .toISOString(),

          resultTimeWIB:
            formatWIB(
              candleCloseTime
            )

        });


      } catch (error) {

        results.push({

          id:
            signal.id,

          asset:
            signal.asset,

          status:
            "ERROR",

          error:
            error?.message ||
            String(error)

        });
      }
    }


    // ==================================================
    // RESPONSE
    // ==================================================

    return res.status(200).json({

      ok: true,

      timeframe:
        TIMEFRAME,

      timezone:
        TIMEZONE,

      correction:
        "-2 hours OTCharts",

      expirationMinutes:
        EXPIRATION_MINUTES,

      checked:
        pending.length,

      results

    });


  } catch (error) {

    return res.status(500).json({

      ok: false,

      step:
        "SETTLE",

      error:
        error?.message ||
        String(error)

    });
  }
}
