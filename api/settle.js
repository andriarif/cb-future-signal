// api/settle.js
// CB Future Signal - M1 Settlement
// WIN / LOSS ONLY AFTER EXPIRATION

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
  ).format(new Date(date));

}


// ======================================================
// SYMBOL
// ======================================================

function symbolFor(asset) {

  return asset
    .replace("/", "")
    .toUpperCase() +
    "_otc";

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

  return JSON.parse(text);

}


// ======================================================
// TELEGRAM
// ======================================================

async function sendTelegram(text) {

  const url =
    `https://api.telegram.org/bot` +
    `${TELEGRAM_BOT_TOKEN}/sendMessage`;

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

  if (!response.ok) {

    throw new Error(
      `Telegram ${response.status}: ` +
      await response.text()
    );

  }

}


// ======================================================
// FIND ENTRY CANDLE
// ======================================================

function findEntryCandle(
  candles,
  entryTime
) {

  const target =
    new Date(entryTime)
      .getTime();

  return (
    candles.find(
      candle =>
        candle.time.getTime()
        === target
    )
    ||
    null
  );

}


// ======================================================
// SETTLE
// ======================================================

export default async function handler(
  req,
  res
) {

  try {

    /*
      ==================================================
      1. AMBIL PENDING
      ==================================================
    */

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


    if (pendingError)
      throw new Error(
        pendingError.message
      );


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


    /*
      ==================================================
      2. PROSES SATU PER SATU
      ==================================================
    */

    for (
      const signal of pending
    ) {

      try {

        const expiryTime =
          new Date(
            signal.expiry_time
          );

        /*
          BELUM EXPIRATION
        */

        if (
          now.getTime()
          <
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

            expiryTime:
              signal.expiry_time,

            expiryWIB:
              formatWIB(
                signal.expiry_time
              )

          });

          continue;

        }


        /*
          ==================================================
          3. AMBIL DATA CANDLE
          ==================================================
        */

        const raw =
          await getCandles(
            signal.asset
          );

        const candles =
          normalizeCandles(raw);


        /*
          ENTRY CANDLE =
          candle yang dimulai tepat
          pada entry_time.

          Contoh:

          Entry 21:38
          Candle 21:38 - 21:39
          Close 21:39

          Itulah candle yang menentukan
          WIN / LOSS.
        */

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

            expiryTime:
              signal.expiry_time

          });

          continue;

        }


        /*
          ==================================================
          4. PASTIKAN CANDLE SUDAH CLOSED
          ==================================================
        */

        const candleCloseTime =
          new Date(
            entryCandle.time.getTime()
            +
            60 * 1000
          );


        /*
          Kalau candle belum selesai,
          JANGAN settlement.
        */

        if (
          now.getTime()
          <
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

            expectedClose:
              candleCloseTime
                .toISOString()

          });

          continue;

        }


        /*
          ==================================================
          5. HARGA ENTRY & CLOSE
          ==================================================
        */

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
          )
          ||
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


        /*
          ==================================================
          6. HITUNG WIN / LOSS
          ==================================================
        */

        let result;

        if (
          signal.direction ===
          "CALL"
        ) {

          if (
            resultPrice >
            entryPrice
          ) {

            result = "WIN";

          }
          else if (
            resultPrice <
            entryPrice
          ) {

            result = "LOSS";

          }
          else {

            result = "DRAW";

          }

        }
        else {

          if (
            resultPrice <
            entryPrice
          ) {

            result = "WIN";

          }
          else if (
            resultPrice >
            entryPrice
          ) {

            result = "LOSS";

          }
          else {

            result = "DRAW";

          }

        }


        /*
          ==================================================
          7. UPDATE DATABASE
          ==================================================
        */

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
            );


        if (updateError)
          throw new Error(
            updateError.message
          );


        /*
          ==================================================
          8. TELEGRAM RESULT
          ==================================================
        */

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

          expiryTime:
            signal.expiry_time,

          resultTime:
            candleCloseTime
              .toISOString()

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
            error.message

        });

      }

    }


    return res.status(200).json({

      ok: true,

      timeframe:
        TIMEFRAME,

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
        error.message

    });

  }

}
