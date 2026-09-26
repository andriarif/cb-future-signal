// api/time-test.js

const OTCHARTS_API_KEY =
  process.env.OTCHARTS_API_KEY;


const ASSETS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD"
];


const TIMEZONE =
  "Asia/Jakarta";

const OFFSET_FIX =
  2 * 60 * 60 * 1000; // koreksi -2 jam


function symbolFor(asset) {

  return `${asset.replace("/", "")}_otc`;

}


function formatWIB(date) {

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: TIMEZONE,
      day:"2-digit",
      month:"2-digit",
      year:"numeric",
      hour:"2-digit",
      minute:"2-digit",
      second:"2-digit",
      hour12:false
    }
  ).format(date);

}


// ================================
// AMBIL CANDLE OTCHARTS
// ================================

async function getCandles(asset){

  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbolFor(asset))}` +
    `&tf=300` +
    `&limit=5`;


  const response =
    await fetch(
      url,
      {
        headers:{
          Authorization:
            `Bearer ${OTCHARTS_API_KEY}`
        }
      }
    );


  if(!response.ok){

    throw new Error(
      `OTCharts ${response.status}`
    );

  }


  return await response.json();

}


// ================================
// TIME PARSER
// ================================

function parseBrokerTime(value){

  let ms;


  if(typeof value === "number"){

    ms =
      value < 10000000000
        ? value * 1000
        : value;

  }
  else {

    ms =
      Date.parse(value);

  }


  /*
    OTCharts terbaca +2 jam
    terhadap WIB broker.
    Koreksi ke WIB.
  */

  return new Date(
    ms - OFFSET_FIX
  );

}


// ================================
// MAIN
// ================================

export default async function handler(
  req,
  res
){

  try {


    const now =
      new Date();


    const results = [];


    for(
      const asset of ASSETS
    ){

      const raw =
        await getCandles(asset);



      let rows=[];


      if(Array.isArray(raw)){

        rows=raw;

      }
      else if(Array.isArray(raw.candles)){

        rows=raw.candles;

      }
      else if(Array.isArray(raw.data)){

        rows=raw.data;

      }



      const last =
        rows[
          rows.length-1
        ];



      const candleTime =
        parseBrokerTime(
          last.time ??
          last.timestamp ??
          last.ts
        );



      const nextEntry =
        new Date(
          candleTime.getTime()
          +
          5*60*1000
        );



      const expiry =
        new Date(
          nextEntry.getTime()
          +
          5*60*1000
        );



      results.push({

        asset,


        candleWIB:
          formatWIB(candleTime),


        nextEntryWIB:
          formatWIB(nextEntry),


        expiryWIB:
          formatWIB(expiry),


        candleUTC:
          candleTime.toISOString(),


        nextEntryUTC:
          nextEntry.toISOString(),


        close:
          last.close ??
          last.c

      });


    }



    return res.status(200)
    .json({

      ok:true,


      botTimeWIB:
        formatWIB(now),


      botTimeUTC:
        now.toISOString(),


      timezone:
        TIMEZONE,


      timeframe:
        "M5",


      correction:
        "-2 hours OTCharts",


      results

    });


  }
  catch(error){

    return res.status(500)
    .json({

      ok:false,

      error:
        error.message

    });

  }

}
