import { createClient } from "@supabase/supabase-js";
import {
  normalizeCandles,
  analyze
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


const MIN_SCORE =
  Number(process.env.MIN_SIGNAL_SCORE || 3);


const TIMEZONE =
  "Asia/Jakarta";


const EXPIRATION_MINUTES = 5;


const ASSETS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD"
];


const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);


// =================================
// SYMBOL
// =================================

function symbolFor(asset){

  return `${asset.replace("/", "")}_otc`;

}


// =================================
// GET CANDLES
// =================================

async function getCandles(asset){

  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbolFor(asset))}` +
    `&tf=300` +
    `&limit=250`;


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


// =================================
// TIME FIX OTCHARTS
// =================================

function fixBrokerTime(date){

  return new Date(
    date.getTime()
    -
    (2 * 60 * 60 * 1000)
  );

}



// =================================
// NEXT M5 ENTRY
// =================================

function getNextEntry(){

  const now =
    new Date();


  const entry =
    new Date(
      Math.ceil(
        now.getTime()
        /
        (5*60*1000)
      )
      *
      (5*60*1000)
    );


  return entry;

}



function formatWIB(date){

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: TIMEZONE,
      hour:"2-digit",
      minute:"2-digit",
      hour12:false
    }
  ).format(date);

}



// =================================
// TELEGRAM
// =================================

async function sendTelegram(text){

 const url =
 `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;


 const response =
 await fetch(
   url,
   {
    method:"POST",
    headers:{
      "Content-Type":
      "application/json"
    },
    body:JSON.stringify({

      chat_id:
      TELEGRAM_CHAT_ID,

      text

    })
   }
 );


 if(!response.ok){

  throw new Error(
    await response.text()
  );

 }

}



// =================================
// FORMAT SIGNAL
// =================================

function telegramSignal(signal){


 const direction =
 signal.direction === "CALL"
 ? "BUY"
 : "SELL";


 const icon =
 signal.direction === "CALL"
 ? "🟩"
 : "🟥";


 const entry =
 new Date(signal.entryTime);


 const mg1 =
 new Date(
  entry.getTime()
  +
  5*60000
 );


 const mg2 =
 new Date(
  mg1.getTime()
  +
  5*60000
 );


 const mg3 =
 new Date(
  mg2.getTime()
  +
  5*60000
 );



 return `⚡ SIGNAL

🌐 ${signal.asset} OTC

Timeframe: M5
⏱ Expiration: 5 minutes

⏰ Entry: ${formatWIB(entry)} WIB

${icon} Direction: ${direction}


📊 Martingale:
1⃣ ${formatWIB(mg1)}
2⃣ ${formatWIB(mg2)}
3⃣ ${formatWIB(mg3)}


📊 Confirmation:
${signal.score}/10


${signal.reasons
.map(x=>"🔎 "+x)
.join("\n")}


⚠️ ENTRY SESUAI JAM DI ATAS`;

}



// =================================
// MAIN
// =================================

export default async function handler(
req,
res
){

 const scannedAt =
 new Date().toISOString();


 const results=[];
 const newSignals=[];



 try{


 for(
 const asset of ASSETS
 ){


  try{


   const raw =
   await getCandles(asset);



   const candles =
   normalizeCandles(raw);



   if(candles.length < 220){

    results.push({

     asset,

     status:
     "NOT_ENOUGH_DATA"

    });

    continue;

   }



   const signal =
   analyze(
    asset,
    candles,
    MIN_SCORE
   );



   if(!signal){

    results.push({

     asset,

     status:
     "NO_SIGNAL"

    });

    continue;

   }



   // ENTRY WIB BROKER

   const entryTime =
   getNextEntry();



   const expiryTime =
   new Date(
    entryTime.getTime()
    +
    EXPIRATION_MINUTES*60000
   );



   signal.entryTime =
   entryTime.toISOString();


   signal.expiryTime =
   expiryTime.toISOString();



   const signalKey =
   `${asset}|${signal.direction}|${signal.entryTime}`;



   const {
    data:exist
   } =
   await supabase
   .from("signals")
   .select("id")
   .eq(
    "signal_key",
    signalKey
   )
   .maybeSingle();



   if(exist){

    results.push({

     asset,

     status:
     "DUPLICATE"

    });

    continue;

   }



   const {
    data:inserted,
    error
   } =
   await supabase
   .from("signals")
   .insert({

    asset,

    timeframe:
    "M5",

    direction:
    signal.direction,

    score:
    signal.score,


    signal_key:
    signalKey,


    signal_time:
    new Date()
    .toISOString(),


    entry_time:
    signal.entryTime,


    expiry_time:
    signal.expiryTime,


    entry_price:
    signal.entryPrice,


    expiration_minutes:
    5,


    result:
    "PENDING",


    reasons:
    signal.reasons


   })
   .select()
   .single();



   if(error)
   throw error;



   newSignals.push({

    ...signal,

    id:
    inserted.id

   });



   results.push({

    asset,

    status:
    "SIGNAL_READY",

    direction:
    signal.direction,


    score:
    signal.score,


    entryTime:
    formatWIB(entryTime),


    expiryTime:
    formatWIB(expiryTime),


    entryPrice:
    signal.entryPrice

   });



  }
  catch(error){


   results.push({

    asset,

    status:
    "ERROR",

    error:
    error.message

   });


  }


 }



 // SEND TELEGRAM

 if(newSignals.length > 0){


  const message =
  newSignals
  .map(telegramSignal)
  .join(
   "\n\n================\n\n"
  );


  await sendTelegram(message);

 }



 return res.status(200)
 .json({

  ok:true,

  scannedAt,

  timeframe:
  "M5",

  timezone:
  TIMEZONE,


  expirationMinutes:
  EXPIRATION_MINUTES,


  newSignals:
  newSignals.length,


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
