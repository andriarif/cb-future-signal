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
Number(
 process.env.MIN_SIGNAL_SCORE || 2
);


const TIMEZONE =
"Asia/Jakarta";


const EXPIRATION_MINUTES = 1;



const ASSETS = [
 "EUR/USD",
 "GBP/USD",
 "USD/JPY",
 "AUD/USD"
];



const supabase =
createClient(
 SUPABASE_URL,
 SUPABASE_SERVICE_ROLE_KEY
);



// ======================================
// SYMBOL
// ======================================

function symbolFor(asset){

 return `${asset.replace("/", "")}_otc`;

}



// ======================================
// GET M1 CANDLES
// ======================================

async function getCandles(asset){


 const url =
 `https://otcharts.com/v1/candles`+
 `?venue=otc`+
 `&symbol=${encodeURIComponent(symbolFor(asset))}`+
 `&tf=60`+
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
   await response.text()
  );

 }


 return await response.json();

}



// ======================================
// WIB FORMAT
// ======================================

function formatWIB(date){

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



// ======================================
// NEXT M1 ENTRY
// ======================================

function nextEntryTime(){


 const now =
 new Date();


 return new Date(

  Math.ceil(
   now.getTime()
   /
   60000
  )
  *
  60000

 );

}



// ======================================
// TELEGRAM
// ======================================

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



// ======================================
// TELEGRAM FORMAT
// ======================================

function formatSignal(sig){


 const direction =
 sig.direction==="CALL"
 ? "BUY"
 : "SELL";


 const icon =
 sig.direction==="CALL"
 ?"🟩"
 :"🟥";


 const entry =
 new Date(
  sig.entryTime
 );


 const mg1 =
 new Date(
  entry.getTime()
  +
  60000
 );


 const mg2 =
 new Date(
  mg1.getTime()
  +
  60000
 );


 const mg3 =
 new Date(
  mg2.getTime()
  +
  60000
 );



 return `⚡ SIGNAL


🌐 ${sig.asset} OTC

Timeframe: M1

⏱ Expiration: 1 minute


⏰ Entry:
${formatWIB(entry)} WIB


${icon} Direction:
${direction}


📊 Martingale:

1⃣ ${formatWIB(mg1)}
2⃣ ${formatWIB(mg2)}
3⃣ ${formatWIB(mg3)}


📊 Confirmation:
${sig.score}/10


${sig.reasons
.map(x=>"🔎 "+x)
.join("\n")}


⚠️ ENTRY SESUAI JAM DI ATAS`;

}



// ======================================
// MAIN
// ======================================

export default async function handler(
 req,
 res
){


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



   const entryTime =
   nextEntryTime();



   const now =
   new Date();



   const seconds =
   (
    entryTime.getTime()
    -
    now.getTime()
   )
   /
   1000;



   // jangan kirim kalau terlalu dekat

   if(seconds < 20){


    results.push({

     asset,

     status:
     "TOO_LATE"

    });


    continue;

   }



   signal.entryTime =
   entryTime.toISOString();



   signal.expiryTime =
   new Date(
    entryTime.getTime()
    +
    60000
   )
   .toISOString();



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
    "M1",


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
    1,


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
    formatWIB(
     new Date(
      signal.expiryTime
     )
    )

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



 if(newSignals.length>0){


  await sendTelegram(

   newSignals
   .map(formatSignal)
   .join(
    "\n\n==========\n\n"
   )

  );

 }



 return res.status(200)
 .json({

  ok:true,

  timeframe:
  "M1",

  timezone:
  TIMEZONE,

  expirationMinutes:
  EXPIRATION_MINUTES,


  minScore:
  MIN_SCORE,


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
