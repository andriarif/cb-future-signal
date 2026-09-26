import { createClient } from "@supabase/supabase-js";

import {
  normalizeCandles,
  analyze
} from "../signal-engine.js";


const supabase =
createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_ROLE_KEY
);


const ASSETS = [
 "EUR/USD",
 "GBP/USD",
 "USD/JPY",
 "AUD/USD"
];


const TIMEZONE =
"Asia/Jakarta";


const EXPIRATION_MINUTES = 1;


const MIN_SCORE = 2;



// ===============================
// GET CANDLES M1
// ===============================

async function getCandles(asset){

 const symbol =
 asset.replace("/","");


 const url =
 `https://otcharts.com/v1/candles`
 +
 `?venue=otc`
 +
 `&symbol=${symbol}`
 +
 `&tf=60`
 +
 `&limit=250`;


 const r =
 await fetch(
  url,
  {
   headers:{
    Authorization:
    `Bearer ${process.env.OTCHARTS_API_KEY}`
   }
  }
 );


 if(!r.ok){

  throw new Error(
   await r.text()
  );

 }


 return await r.json();

}



// ===============================
// WIB FORMAT
// ===============================

function wib(date){

 return new Intl.DateTimeFormat(
  "id-ID",
  {
   timeZone:TIMEZONE,
   hour:"2-digit",
   minute:"2-digit",
   second:"2-digit",
   hour12:false
  }
 )
 .format(date);

}



// ===============================
// ENTRY TIME BUFFER
// ===============================

function getEntryTime(){


 const now =
 Date.now();



 // tambah buffer 30 detik

 const target =
 now + 30000;



 return new Date(

  Math.ceil(
   target / 60000
  )
  *
  60000

 );

}



// ===============================
// TELEGRAM
// ===============================

async function sendTelegram(text){


 await fetch(

 `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,

 {

  method:"POST",

  headers:{
   "Content-Type":
   "application/json"
  },


  body:JSON.stringify({

   chat_id:
   process.env.TELEGRAM_CHAT_ID,


   text

  })

 }

 );

}



// ===============================
// FORMAT SIGNAL
// ===============================

function formatSignal(sig){


const direction =
sig.direction==="CALL"
?"BUY"
:"SELL";


const icon =
sig.direction==="CALL"
?"🟩"
:"🟥";


return `⚡ SIGNAL


🌐 ${sig.asset} OTC

Timeframe: M1

⏱ Expiration: 1 minute


⏰ Entry:
${wib(new Date(sig.entryTime))} WIB


${icon} Direction:
${direction}


📊 Confirmation:
${sig.score}/10


${sig.reasons
.map(x=>"🔎 "+x)
.join("\n")}


⚠️ Entry sesuai jam signal`;

}



// ===============================
// API
// ===============================

export default async function handler(
 req,
 res
){


 const candidates=[];


 const results=[];



 for(
  const asset of ASSETS
 ){


  try{


   const raw =
   await getCandles(asset);



   const candles =
   normalizeCandles(raw);



   const signal =
   analyze(
    asset,
    candles,
    MIN_SCORE
   );



   if(signal){


    candidates.push({

     ...signal,

     asset

    });


   }
   else{


    results.push({

     asset,

     status:
     "NO_SIGNAL"

    });


   }



  }
  catch(e){


   results.push({

    asset,

    status:
    "ERROR",

    error:
    e.message

   });


  }

 }



 // ==========================
 // PILIH SCORE TERTINGGI
 // ==========================


 if(candidates.length>0){


  candidates.sort(

   (a,b)=>
   b.score-a.score

  );



  const best =
  candidates[0];



  const entry =
  getEntryTime();



  const expiry =
  new Date(
   entry.getTime()
   +
   60000
  );



  best.entryTime =
  entry.toISOString();


  best.expiryTime =
  expiry.toISOString();



  const key =
  `${best.asset}-${best.direction}-${best.entryTime}`;



  const {data:exist}=

  await supabase
  .from("signals")
  .select("id")
  .eq(
   "signal_key",
   key
  )
  .maybeSingle();



  if(!exist){


   await supabase
   .from("signals")
   .insert({

    asset:
    best.asset,


    timeframe:
    "M1",


    direction:
    best.direction,


    score:
    best.score,


    signal_key:
    key,


    entry_time:
    best.entryTime,


    expiry_time:
    best.expiryTime,


    entry_price:
    best.entryPrice,


    expiration_minutes:
    1,


    result:
    "PENDING",


    reasons:
    best.reasons


   });



   await sendTelegram(
    formatSignal(best)
   );



   results.push({

    asset:
    best.asset,


    status:
    "SIGNAL_READY",


    direction:
    best.direction,


    score:
    best.score,


    entryTime:
    wib(entry),


    expiryTime:
    wib(expiry)

   });


  }


 }



 return res.status(200)
 .json({

  ok:true,


  timeframe:
  "M1",


  timezone:
  TIMEZONE,


  expirationMinutes:
  1,


  results

 });

}
