import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OTCHARTS_API_KEY = process.env.OTCHARTS_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function symbolFor(asset) {
  return `${asset.replace("/", "")}_otc`;
}

async function getCandles(asset, limit = 30) {
  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbolFor(asset))}` +
    `&tf=60` +
    `&limit=${limit}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OTCHARTS_API_KEY}`
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

function normalizeCandle(c) {
  return {
    time: Number(c.time ?? c.timestamp ?? c.t),
    open: Number(c.open ?? c.o),
    high: Number(c.high ?? c.h),
    low: Number(c.low ?? c.l),
    close: Number(c.close ?? c.c)
  };
}

async function sendTelegram(text) {
  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

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

export default async function handler(req, res) {
  try {
    /*
     * Ambil semua signal yang masih PENDING.
     */
    const { data: signals, error } = await supabase
      .from("signals")
      .select("*")
      .eq("result", "PENDING")
      .order("entry_time", { ascending: true })
      .limit(20);

    if (error) {
      return res.status(500).json({
        ok: false,
        step: "SUPABASE_QUERY",
        error: error.message
      });
    }

    if (!signals || signals.length === 0) {
      return res.status(200).json({
        ok: true,
        checked: 0,
        message: "Tidak ada signal PENDING."
      });
    }

    const results = [];

    for (const signal of signals) {
      try {
        const entryTime = new Date(
          signal.entry_time
        ).getTime();

        if (!Number.isFinite(entryTime)) {
          results.push({
            asset: signal.asset,
            status: "ERROR",
            error: "ENTRY_TIME_INVALID",
            entryTime: signal.entry_time
          });

          continue;
        }

        /*
         * Ambil candle terbaru dari OTCharts.
         */
        const rawCandles = await getCandles(
          signal.asset,
          30
        );

        const candles = rawCandles
          .map(normalizeCandle)
          .filter(c =>
            Number.isFinite(c.time) &&
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close)
          )
          .sort((a, b) => a.time - b.time);

        if (candles.length === 0) {
          results.push({
            asset: signal.asset,
            status: "NO_CANDLES"
          });

          continue;
        }

        /*
         * Waktu candle dalam milliseconds.
         */
        const candleTimes = candles.map(
          c => c.time * 1000
        );

        /*
         * Cari candle entry.
         *
         * Kita toleransi perbedaan beberapa detik
         * pada timestamp.
         */
        const tolerance = 30_000;

        let entryIndex = -1;

        for (let i = 0; i < candles.length; i++) {
          if (
            Math.abs(
              candleTimes[i] - entryTime
            ) <= tolerance
          ) {
            entryIndex = i;
            break;
          }
        }

        /*
         * Kalau candle dengan timestamp persis tidak ditemukan,
         * cari candle pertama setelah entry.
         */
        if (entryIndex === -1) {
          entryIndex = candles.findIndex(
            c => c.time * 1000 >= entryTime
          );
        }

        if (entryIndex === -1) {
          results.push({
            asset: signal.asset,
            status: "ENTRY_CANDLE_NOT_FOUND",
            entryTime: signal.entry_time,
            latestCandleTime: new Date(
              candles[candles.length - 1].time * 1000
            ).toISOString()
          });

          continue;
        }

        /*
         * Candle hasil adalah candle M1 setelah candle entry.
         */
        const resultIndex = entryIndex + 1;

        if (resultIndex >= candles.length) {
          results.push({
            asset: signal.asset,
            status: "WAITING_RESULT_CANDLE",
            entryTime: signal.entry_time,
            entryCandle: new Date(
              candles[entryIndex].time * 1000
            ).toISOString()
          });

          continue;
        }

        const entryCandle = candles[entryIndex];
        const resultCandle = candles[resultIndex];

        /*
         * Pastikan candle hasil sudah selesai.
         *
         * OTCharts candle berikutnya harus sudah memiliki
         * candle setelahnya agar kita tahu candle tersebut
         * sudah closed.
         */
        if (resultIndex + 1 >= candles.length) {
          results.push({
            asset: signal.asset,
            status: "WAITING_RESULT_CANDLE_CLOSE",
            entryTime: signal.entry_time,
            entryCandle: new Date(
              entryCandle.time * 1000
            ).toISOString(),
            resultCandle: new Date(
              resultCandle.time * 1000
            ).toISOString()
          });

          continue;
        }

        const entryPrice = Number(
          signal.entry_price
        );

        const closePrice = Number(
          resultCandle.close
        );

        const direction = String(
          signal.direction || ""
        ).toUpperCase();

        let result;

        if (closePrice === entryPrice) {
          result = "DRAW";
        } else if (
          direction === "CALL" &&
          closePrice > entryPrice
        ) {
          result = "WIN";
        } else if (
          direction === "PUT" &&
          closePrice < entryPrice
        ) {
          result = "WIN";
        } else {
          result = "LOSS";
        }

        /*
         * Update hasil ke Supabase.
         */
        const { error: updateError } =
          await supabase
            .from("signals")
            .update({
              result
            })
            .eq("id", signal.id);

        if (updateError) {
          throw new Error(
            `SUPABASE_UPDATE: ${updateError.message}`
          );
        }

        /*
         * Kirim hasil ke Telegram.
         */
        const emoji =
          result === "WIN"
            ? "✅"
            : result === "LOSS"
              ? "❌"
              : "⚖️";

        const message =
`📊 CB FUTURE SIGNAL

${signal.asset}
TF: M1
Signal: ${direction}

Entry: ${entryPrice}
Close: ${closePrice}

HASIL: ${emoji} ${result}`;

        await sendTelegram(message);

        results.push({
          asset: signal.asset,
          direction,
          entryPrice,
          closePrice,
          entryCandleTime:
            new Date(
              entryCandle.time * 1000
            ).toISOString(),
          resultCandleTime:
            new Date(
              resultCandle.time * 1000
            ).toISOString(),
          result,
          status: "SETTLED"
        });

        await sleep(200);

      } catch (err) {
        results.push({
          asset: signal.asset,
          status: "ERROR",
          error: err.message
        });
      }
    }

    return res.status(200).json({
      ok: true,
      checked: signals.length,
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
