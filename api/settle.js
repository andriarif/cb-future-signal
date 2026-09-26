// api/settle.js

import { createClient } from "@supabase/supabase-js";

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

const EXPIRATION_MINUTES =
  Number(
    process.env.EXPIRATION_MINUTES || 5
  );

const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );


// =========================================================
// SYMBOL
// =========================================================

function symbolFor(asset) {
  return `${asset.replace("/", "")}_otc`;
}


// =========================================================
// OTCHARTS M5 CANDLES
// =========================================================

async function getCandles(asset) {

  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbolFor(asset))}` +
    `&tf=300` +
    `&limit=30`;

  const response =
    await fetch(url, {
      headers: {
        Authorization:
          `Bearer ${OTCHARTS_API_KEY}`
      }
    });

  if (!response.ok) {
    throw new Error(
      `OTCharts ${response.status}: ${await response.text()}`
    );
  }

  return await response.json();
}


// =========================================================
// NORMALIZE CANDLES
// =========================================================

function normalizeCandles(raw) {

  let rows = raw;

  if (
    raw &&
    !Array.isArray(raw)
  ) {

    for (
      const key of [
        "candles",
        "data",
        "result",
        "items"
      ]
    ) {

      if (
        Array.isArray(raw[key])
      ) {
        rows = raw[key];
        break;
      }

    }

  }

  if (!Array.isArray(rows)) {
    throw new Error(
      "Response candle bukan array."
    );
  }

  return rows
    .map(row => {

      const x = {
        ...row
      };

      if (
        x.time === undefined
      ) {
        x.time =
          x.timestamp ??
          x.ts ??
          x.datetime ??
          x.date;
      }

      if (
        x.open === undefined
      ) {
        x.open = x.o;
      }

      if (
        x.high === undefined
      ) {
        x.high = x.h;
      }

      if (
        x.low === undefined
      ) {
        x.low = x.l;
      }

      if (
        x.close === undefined
      ) {
        x.close = x.c;
      }

      const timestamp =
        typeof x.time === "number"
          ? (
              x.time >
              10000000000
                ? x.time
                : x.time * 1000
            )
          : Date.parse(
              x.time
            );

      return {
        time:
          new Date(timestamp),

        open:
          Number(x.open),

        high:
          Number(x.high),

        low:
          Number(x.low),

        close:
          Number(x.close)
      };

    })
    .filter(
      candle =>
        Number.isFinite(
          candle.time.getTime()
        ) &&
        Number.isFinite(
          candle.open
        ) &&
        Number.isFinite(
          candle.high
        ) &&
        Number.isFinite(
          candle.low
        ) &&
        Number.isFinite(
          candle.close
        )
    )
    .sort(
      (a, b) =>
        a.time - b.time
    );
}


// =========================================================
// TELEGRAM
// =========================================================

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
      `Telegram ${response.status}: ${await response.text()}`
    );

  }
}


// =========================================================
// UTC+6 FORMAT
// =========================================================

function formatUTC6(
  timestamp
) {

  const date =
    new Date(
      timestamp +
      6 * 60 * 60 * 1000
    );

  const hh =
    String(
      date.getUTCHours()
    ).padStart(2, "0");

  const mm =
    String(
      date.getUTCMinutes()
    ).padStart(2, "0");

  return `${hh}:${mm}`;
}


// =========================================================
// FIND EXPIRY CANDLE
// =========================================================

function findExpiryCandle(
  candles,
  expiryTime
) {

  const target =
    new Date(
      expiryTime
    ).getTime();

  /*
   * Cari candle M5 yang waktunya
   * sama dengan expiry_time.
   */

  let best =
    null;

  let smallest =
    Infinity;

  for (
    const candle of candles
  ) {

    const difference =
      Math.abs(
        candle.time.getTime() -
        target
      );

    /*
     * Toleransi maksimal 30 detik.
     */

    if (
      difference <= 30000 &&
      difference < smallest
    ) {

      best =
        candle;

      smallest =
        difference;

    }

  }

  return best;
}


// =========================================================
// FIND FOLLOWING CANDLE
// =========================================================

function findFollowingCandle(
  candles,
  expiryCandle
) {

  if (!expiryCandle) {
    return null;
  }

  const target =
    expiryCandle.time.getTime();

  return (
    candles.find(
      candle =>
        candle.time.getTime() >
        target
    ) || null
  );
}


// =========================================================
// MAIN
// =========================================================

export default async function handler(
  req,
  res
) {

  const now =
    Date.now();

  const checked = [];

  try {

    // =====================================================
    // GET PENDING SIGNALS
    // =====================================================

    const {
      data: signals,
      error
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
        .limit(50);


    if (error) {

      throw new Error(
        `SUPABASE_SELECT: ${error.message}`
      );

    }


    if (
      !signals ||
      signals.length === 0
    ) {

      return res
        .status(200)
        .json({

          ok: true,

          timeframe: "M5",

          expirationMinutes:
            EXPIRATION_MINUTES,

          checked: 0,

          results: []

        });

    }


    // =====================================================
    // PROCESS EACH SIGNAL
    // =====================================================

    for (
      const signal of signals
    ) {

      try {

        const entryTime =
          new Date(
            signal.entry_time
          ).getTime();


        let expiryTime =
          signal.expiry_time
            ? new Date(
                signal.expiry_time
              ).getTime()
            : (
                entryTime +
                EXPIRATION_MINUTES *
                  60 *
                  1000
              );


        // =================================================
        // BELUM WAKTU EXPIRY
        // =================================================

        if (
          now <
          expiryTime
        ) {

          checked.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "WAITING_EXPIRY",

            entryTime:
              signal.entry_time,

            expiryTime:
              new Date(
                expiryTime
              ).toISOString()

          });

          continue;

        }


        // =================================================
        // GET M5 DATA
        // =================================================

        const raw =
          await getCandles(
            signal.asset
          );


        const candles =
          normalizeCandles(
            raw
          );


        if (
          candles.length < 3
        ) {

          checked.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "CANDLES_NOT_ENOUGH"

          });

          continue;

        }


        // =================================================
        // FIND EXPIRY CANDLE
        // =================================================

        const expiryCandle =
          findExpiryCandle(
            candles,
            expiryTime
          );


        if (!expiryCandle) {

          checked.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "EXPIRY_CANDLE_NOT_FOUND",

            expiryTime:
              new Date(
                expiryTime
              ).toISOString(),

            latestCandle:
              candles[
                candles.length - 1
              ].time.toISOString()

          });

          continue;

        }


        // =================================================
        // MAKE SURE EXPIRY CANDLE IS CLOSED
        // =================================================

        const followingCandle =
          findFollowingCandle(
            candles,
            expiryCandle
          );


        if (!followingCandle) {

          checked.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "EXPIRY_CANDLE_NOT_CLOSED",

            expiryCandle:
              expiryCandle.time
                .toISOString()

          });

          continue;

        }


        // =================================================
        // RESULT
        // =================================================

        const entryPrice =
          Number(
            signal.entry_price
          );

        const closePrice =
          Number(
            expiryCandle.close
          );


        if (
          !Number.isFinite(
            entryPrice
          ) ||
          !Number.isFinite(
            closePrice
          )
        ) {

          checked.push({

            id:
              signal.id,

            asset:
              signal.asset,

            status:
              "INVALID_PRICE"

          });

          continue;

        }


        let result =
          "DRAW";


        if (
          signal.direction ===
          "CALL"
        ) {

          if (
            closePrice >
            entryPrice
          ) {

            result =
              "WIN";

          } else if (
            closePrice <
            entryPrice
          ) {

            result =
              "LOSS";

          }

        }
        else if (
          signal.direction ===
          "PUT"
        ) {

          if (
            closePrice <
            entryPrice
          ) {

            result =
              "WIN";

          } else if (
            closePrice >
            entryPrice
          ) {

            result =
              "LOSS";

          }

        }


        // =================================================
        // UPDATE SUPABASE
        // =================================================

        const {
          error:
            updateError
        } =
          await supabase
            .from("signals")
            .update({

              result,

              result_price:
                closePrice,

              result_time:
                new Date(
                  expiryCandle.time
                ).toISOString(),

              settled_at:
                new Date()
                  .toISOString()

            })
            .eq(
              "id",
              signal.id
            );


        if (
          updateError
        ) {

          throw new Error(
            `SUPABASE_UPDATE: ${updateError.message}`
          );

        }


        // =================================================
        // TELEGRAM RESULT
        // =================================================

        const emoji =
          result === "WIN"
            ? "✅"
            : result === "LOSS"
              ? "❌"
              : "➖";


        const direction =
          signal.direction ===
          "CALL"
            ? "BUY"
            : "SELL";


        const resultMessage =
`📊 RESULT

🌐 ${signal.asset} OTC
Timeframe: M5

⏰ Entry: ${formatUTC6(
  entryTime
)} UTC+6

${signal.direction === "CALL" ? "🟩" : "🟥"} Direction: ${direction}

⏱ Expiration: 5 minutes
⏰ Result: ${formatUTC6(
  expiryTime
)} UTC+6

💰 Entry Price: ${entryPrice}
💰 Result Price: ${closePrice}

${emoji} ${result}`;


        await sendTelegram(
          resultMessage
        );


        // =================================================
        // RESPONSE
        // =================================================

        checked.push({

          id:
            signal.id,

          asset:
            signal.asset,

          direction:
            signal.direction,

          entryPrice,

          closePrice,

          entryTime:
            new Date(
              entryTime
            ).toISOString(),

          expiryTime:
            new Date(
              expiryTime
            ).toISOString(),

          result,

          status:
            "SETTLED"

        });


      }
      catch(error) {

        checked.push({

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


    return res
      .status(200)
      .json({

        ok: true,

        timeframe: "M5",

        expirationMinutes:
          EXPIRATION_MINUTES,

        checked:
          checked.length,

        results:
          checked

      });


  }
  catch(error) {

    return res
      .status(500)
      .json({

        ok: false,

        step: "SETTLE",

        error:
          error.message

      });

  }

}
