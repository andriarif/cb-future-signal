import { createClient } from "@supabase/supabase-js";
import { normalizeCandles } from "../signal-engine.js";

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

const DISPLAY_TIMEZONE =
  "Asia/Jakarta";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

function symbolFor(asset) {
  return `${asset.replace("/", "")}_otc`;
}

function formatWIB(iso) {
  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: DISPLAY_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }
  ).format(new Date(iso));
}

async function getCandles(asset) {
  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(
      symbolFor(asset)
    )}` +
    `&tf=300` +
    `&limit=30`;

  const response = await fetch(url, {
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

async function sendTelegram(text) {
  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
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
  });

  if (!response.ok) {
    throw new Error(
      `Telegram ${response.status}: ${await response.text()}`
    );
  }
}

function findEntryCandle(
  candles,
  entryTime
) {
  const target =
    new Date(entryTime).getTime();

  return candles.find((candle) => {
    return (
      Math.abs(
        candle.time.getTime() -
          target
      ) <= 30000
    );
  });
}

export default async function handler(
  req,
  res
) {
  const now =
    new Date();

  try {
    const {
      data: pendingSignals,
      error
    } = await supabase
      .from("signals")
      .select("*")
      .eq("result", "PENDING")
      .order("entry_time", {
        ascending: true
      })
      .limit(50);

    if (error) {
      throw new Error(error.message);
    }

    if (
      !pendingSignals ||
      pendingSignals.length === 0
    ) {
      return res.status(200).json({
        ok: true,
        message:
          "Tidak ada signal PENDING",
        settled: 0,
        waiting: 0,
        timezone:
          DISPLAY_TIMEZONE
      });
    }

    const results = [];
    const messages = [];

    for (const signal of pendingSignals) {
      try {
        const entryTime =
          new Date(
            signal.entry_time
          );

        const expiryTime =
          signal.expiry_time
            ? new Date(
                signal.expiry_time
              )
            : new Date(
                entryTime.getTime() +
                  EXPIRATION_MINUTES *
                    60 *
                    1000
              );

        if (
          now.getTime() <
          expiryTime.getTime()
        ) {
          results.push({
            id: signal.id,
            asset: signal.asset,
            status:
              "WAITING_EXPIRY",
            entryTime:
              formatWIB(
                signal.entry_time
              ),
            expiryTime:
              formatWIB(
                expiryTime.toISOString()
              )
          });

          continue;
        }

        const raw =
          await getCandles(
            signal.asset
          );

        const candles =
          normalizeCandles(raw);

        const entryCandle =
          findEntryCandle(
            candles,
            signal.entry_time
          );

        if (!entryCandle) {
          results.push({
            id: signal.id,
            asset: signal.asset,
            status:
              "ENTRY_CANDLE_NOT_FOUND"
          });

          continue;
        }

        const candleCloseTime =
          new Date(
            entryCandle.time.getTime() +
              EXPIRATION_MINUTES *
                60 *
                1000
          );

        if (
          now.getTime() <
          candleCloseTime.getTime()
        ) {
          results.push({
            id: signal.id,
            asset: signal.asset,
            status:
              "CANDLE_NOT_CLOSED"
          });

          continue;
        }

        const entryPrice =
          Number(
            signal.entry_price
          );

        const resultPrice =
          Number(
            entryCandle.close
          );

        let result = "DRAW";

        if (
          signal.direction ===
          "CALL"
        ) {
          if (
            resultPrice >
            entryPrice
          ) {
            result = "WIN";
          } else if (
            resultPrice <
            entryPrice
          ) {
            result = "LOSS";
          }
        }

        if (
          signal.direction ===
          "PUT"
        ) {
          if (
            resultPrice <
            entryPrice
          ) {
            result = "WIN";
          } else if (
            resultPrice >
            entryPrice
          ) {
            result = "LOSS";
          }
        }

        const {
          error: updateError
        } = await supabase
          .from("signals")
          .update({
            result,
            result_price:
              resultPrice,
            result_time:
              candleCloseTime.toISOString(),
            settled_at:
              now.toISOString()
          })
          .eq(
            "id",
            signal.id
          );

        if (updateError) {
          throw new Error(
            updateError.message
          );
        }

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

        messages.push(
`📊 RESULT

🌐 ${signal.asset} OTC
Timeframe: M5

⏰ Entry: ${formatWIB(
  signal.entry_time
)} WIB

${direction === "BUY" ? "🟩" : "🟥"} Direction: ${direction}

💵 Entry Price: ${entryPrice}
💵 Result Price: ${resultPrice}

${emoji} Result: ${result}

⏱ Expiry: ${formatWIB(
  candleCloseTime.toISOString()
)} WIB`
        );

        results.push({
          id: signal.id,
          asset: signal.asset,
          status: "SETTLED",
          result,
          direction,
          entryPrice,
          resultPrice,
          entryTime:
            formatWIB(
              signal.entry_time
            ),
          expiryTime:
            formatWIB(
              candleCloseTime.toISOString()
            )
        });

      } catch (error) {
        results.push({
          id: signal.id,
          asset: signal.asset,
          status: "ERROR",
          error: error.message
        });
      }
    }

    if (messages.length > 0) {
      await sendTelegram(
        messages.join(
          "\n\n================\n\n"
        )
      );
    }

    return res.status(200).json({
      ok: true,
      settled:
        results.filter(
          (x) =>
            x.status ===
            "SETTLED"
        ).length,
      waiting:
        results.filter(
          (x) =>
            x.status ===
              "WAITING_EXPIRY" ||
            x.status ===
              "CANDLE_NOT_CLOSED"
        ).length,
      checked:
        results.length,
      timezone:
        DISPLAY_TIMEZONE,
      timeframe: "M5",
      results
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      step: "SETTLE",
      error: error.message
    });
  }
}
