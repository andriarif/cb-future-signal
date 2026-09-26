import { createClient } from "@supabase/supabase-js";

import {
  normalizeCandles,
  analyze
} from "../signal-engine.js";


const supabase = createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_ROLE_KEY
);


const ASSETS = [
 "EUR/USD",
 "GBP/USD",
 "USD/JPY",
 "AUD/USD"
];


const TIMEZONE = "Asia/Jakarta";

const EXPIRATION_MINUTES = 1;

const MIN_SCORE = 2;



// ===============================
// GET OTC CANDLE
// ===============================

async function getCandles(asset){


 const symbol =
 asset.replace("/","") + "_otc";


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



 const response =
 await fetch(
  url,
  {
   headers:{
    Authorization:
    `Bearer ${process.env.OTCHARTS_API_KEY}`
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



// ===============================
// WIB
// ===============================

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



// ===============================
// ENTRY BUFFER
// ===============================

function getEntryTime(){


 const now =
 Date.now();



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
// SIGNAL MESSAGE
// ===============================

function signalMessage(sig){


return `⚡ SIGNAL


🌐 ${sig.asset} OTC

Timeframe: M1

⏱ Expiration: 1 minute


⏰ Entry:
${formatWIB(
 new Date(sig.entryTime)
)} WIB


${sig.direction==="CALL"?"🟩 BUY":"🟥 SELL"}


📊 Confirmation:
${sig.score}/10


${sig.reasons
.map(x=>"🔎 "+x)
.join("\n")}


⚠️ Entry sesuai waktu signal`;

}



// ===============================
// API
// ===============================

export default async function handler(
req,
res
){


const results=[];

const candidates=[];



// ===============================
// CEK SIGNAL AKTIF
// ===============================


const {
 data:activeSignals
}
=
await supabase
.from("signals")
.select(
"id,asset,direction,expiry_time"
)
.eq(
"result",
"PENDING"
);



if(
 activeSignals &&
 activeSignals.length>0
){

 return res.status(200)
.json({

 ok:true,

 message:
 "Masih ada signal aktif, tunggu WIN/LOSS",

 activeSignal:
 activeSignals

 });

}



// ===============================
// SCAN MARKET
// ===============================


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



// ===============================
// PILIH SCORE TERTINGGI
// ===============================


if(
candidates.length>0
){


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



const signalKey =
`${best.asset}_${best.direction}_${entry.toISOString()}`;



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
signalKey,

entry_time:
entry.toISOString(),

expiry_time:
expiry.toISOString(),

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
signalMessage({

...best,

entryTime:
entry.toISOString()

})
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
formatWIB(entry),

expiryTime:
formatWIB(expiry)

});


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

results

});


}
