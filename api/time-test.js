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


// FORMAT WIB
function formatWIB(date) {

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12:false
    }
  ).format(date);

}



// ===============================
// GET CANDLES
// ===============================

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



// ===============================
// TIME PARSER
// ===============================

function parseCandleTime(t){

  let ms;


  if(typeof t === "number"){

    ms =
      t < 10000000000
      ? t * 1000
      : t;

  }
  else {

    // OTCharts UTC
    ms =
      Date.parse(t);

  }


  return new Date(ms);

}



// ===============================
// MAIN
// ===============================

export default async function handler(
  req,
  res
){

try{


  const now =
    new Date();


  const results=[];



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
        rows.length - 1
      ];



    const candleTime =
      parseCandleTime(
        last.time ??
        last.timestamp ??
        last.ts
      );



    const nextEntry =
      new Date(
        candleTime.getTime()
        +
        5 * 60 * 1000
      );



    results.push({

      asset,


      candleUTC:
        candleTime.toISOString(),


      candleWIB:
        formatWIB(candleTime),


      nextEntryUTC:
        nextEntry.toISOString(),


      nextEntryWIB:
        formatWIB(nextEntry),


      close:
        last.close ??
        last.c

    });


  }



  return res.status(200)
  .json({

    ok:true,


    botTimeUTC:
      now.toISOString(),


    botTimeWIB:
      formatWIB(now),


    timezone:
      "Asia/Jakarta",


    timeframe:
      "M5",


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
