// api/time-test-m1.js
// Diagnostic OTCharts M1

import {
  normalizeCandles
} from "../signal-engine.js";

const OTCHARTS_API_KEY =
  process.env.OTCHARTS_API_KEY;

const TIMEZONE =
  "Asia/Jakarta";

const CORRECTION_MS =
  -2 * 60 * 60 * 1000;

const ASSETS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD"
];

function symbolFor(asset) {
  return (
    asset
      .replace("/", "")
      .toUpperCase() +
    "_otc"
  );
}

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

async function getCandles(asset) {

  const symbol =
    symbolFor(asset);

  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbol)}` +
    `&tf=60` +
    `&limit=10`;

  const response =
    await fetch(
      url,
      {
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

export default async function handler(
  req,
  res
) {

  try {

    const now =
      new Date();

    const results = [];

    for (
      const asset of ASSETS
    ) {

      try {

        const raw =
          await getCandles(
            asset
          );

        let candles =
          normalizeCandles(
            raw
          );

        candles =
          candles.map(
            candle => ({
              ...candle,
              time:
                new Date(
                  candle.time.getTime() +
                  CORRECTION_MS
                )
            })
          );

        candles.sort(
          (a, b) =>
            a.time.getTime() -
            b.time.getTime()
        );

        const latest =
          candles[
            candles.length - 1
          ];

        const previous =
          candles[
            candles.length - 2
          ];

        results.push({

          asset,

          latestCandleWIB:
            latest
              ? formatWIB(
                  latest.time
                )
              : null,

          latestCandleUTC:
            latest
              ? latest.time.toISOString()
              : null,

          previousCandleWIB:
            previous
              ? formatWIB(
                  previous.time
                )
              : null,

          close:
            latest
              ? latest.close
              : null,

          candleCount:
            candles.length

        });

      } catch (error) {

        results.push({

          asset,

          error:
            error?.message ||
            String(error)

        });
      }
    }

    return res.status(200).json({

      ok: true,

      botTimeWIB:
        formatWIB(now),

      botTimeUTC:
        now.toISOString(),

      timezone:
        TIMEZONE,

      timeframe:
        "M1",

      correction:
        "-2 hours OTCharts",

      results

    });

  } catch (error) {

    return res.status(500).json({

      ok: false,

      error:
        error?.message ||
        String(error)

    });
  }
}
