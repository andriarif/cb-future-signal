// api/time-test.js

const OTCHARTS_API_KEY =
  process.env.OTCHARTS_API_KEY;


const ASSETS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD"
];


function symbolFor(asset) {
  return `${asset.replace("/", "")}_otc`;
}


function formatWIB(date) {
  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: "Asia/Jakarta",
      dateStyle: "short",
      timeStyle: "medium",
      hour12: false
    }
  ).format(date);
}


async function getCandles(asset) {

  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbolFor(asset))}` +
    `&tf=300` +
    `&limit=5`;


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


  const raw =
    await response.json();


  let rows = [];


  if (Array.isArray(raw)) {
    rows = raw;
  }
  else if (Array.isArray(raw.candles)) {
    rows = raw.candles;
  }
  else if (Array.isArray(raw.data)) {
    rows = raw.data;
  }


  return rows.map(c => {

    const t =
      c.time ??
      c.timestamp ??
      c.ts;


    const ms =
      typeof t === "number"
        ? (
            t < 10000000000
              ? t * 1000
              : t
          )
        : Date.parse(t);


    return {
      timeUTC:
        new Date(ms).toISOString(),

      timeWIB:
        formatWIB(new Date(ms)),

      open:
        c.open ?? c.o,

      close:
        c.close ?? c.c
    };

  });

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

      const candles =
        await getCandles(asset);


      const last =
        candles[
          candles.length - 1
        ];


      const nextEntry =
        new Date(
          new Date(last.timeUTC)
            .getTime()
            +
            5 * 60 * 1000
        );


      results.push({

        asset,


        latestCandleUTC:
          last.timeUTC,


        latestCandleWIB:
          last.timeWIB,


        nextEntryUTC:
          nextEntry.toISOString(),


        nextEntryWIB:
          formatWIB(nextEntry),


        lastClose:
          last.close

      });

    }


    return res.status(200).json({

      ok:true,


      botCurrentTimeUTC:
        now.toISOString(),


      botCurrentTimeWIB:
        formatWIB(now),


      timezone:
        "Asia/Jakarta",


      timeframe:
        "M5",


      results

    });


  }
  catch(error) {

    return res.status(500).json({

      ok:false,

      error:
        error.message

    });

  }

}
