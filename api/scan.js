// api/scan.js

import { createClient } from "@supabase/supabase-js";
import {
  normalizeCandles,
  analyze,
  formatSignal
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
    process.env.MIN_SIGNAL_SCORE || 3
  );


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


// =====================================
// OTCHARTS M5
// =====================================

function symbolFor(asset) {
  return `${asset.replace("/", "")}_otc`;
}


async function getCandles(asset) {

  const url =
    `https://otcharts.com/v1/candles` +
    `?venue=otc` +
    `&symbol=${encodeURIComponent(symbolFor(asset))}` +
    `&tf=300` +
    `&limit=250`;


  const response =
    await fetch(url, {
      headers:{
        Authorization:
          `Bearer ${OTCHARTS_API_KEY}`
      }
    });


  if(!response.ok){

    throw new Error(
      `OTCharts ${response.status}: ${await response.text()}`
    );

  }


  return await response.json();

}



// =====================================
// TELEGRAM
// =====================================

async function sendTelegram(text){

  const url =
    `https://api.telegram.org/bot` +
    `${TELEGRAM_BOT_TOKEN}/sendMessage`;


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
      `Telegram ${response.status}: ${await response.text()}`
    );

  }

}



// =====================================
// ANALYZE
// =====================================

async function analyzeAsset(asset){

  const raw =
    await getCandles(asset);


  const candles =
    normalizeCandles(raw);


  if(candles.length < 220){

    return {
      asset,
      signal:null,
      error:
      `Candle kurang ${candles.length}`
    };

  }


  const signal =
    analyze(
      asset,
      candles,
      MIN_SCORE
    );


  return {
    asset,
    signal
  };

}



// =====================================
// MAIN
// =====================================

export default async function handler(
  req,
  res
){

  const scannedAt =
    new Date()
    .toISOString();


  const results=[];
  const newSignals=[];


  try{


    for(const asset of ASSETS){


      try{


        const result =
          await analyzeAsset(asset);



        if(result.error){

          results.push({
            asset,
            status:"ERROR",
            error:result.error
          });

          continue;

        }



        if(!result.signal){

          results.push({
            asset,
            status:"NO_SIGNAL"
          });

          continue;

        }



        const signal =
          result.signal;



        const direction =
          signal.direction;



        const signalKey =
          `${asset}|${direction}|${signal.entryTime}`;



        // ==============================
        // DUPLICATE CHECK
        // ==============================


        const {
          data:existing,
          error:checkError

        } =
        await supabase
        .from("signals")
        .select("id")
        .eq(
          "signal_key",
          signalKey
        )
        .maybeSingle();



        if(checkError){

          throw new Error(
            checkError.message
          );

        }



        if(existing){

          results.push({
            asset,
            status:"DUPLICATE"
          });

          continue;

        }



        // ==============================
        // INSERT
        // ==============================


        const {
          data:inserted,
          error:insertError

        } =
        await supabase
        .from("signals")
        .insert({

          asset,

          timeframe:
            "M5",

          direction,

          score:
            signal.score,


          signal_key:
            signalKey,


          signal_time:
            signal.signalTime,


          source_candle_time:
            signal.sourceCandleTime,


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



        if(insertError){

          throw new Error(
            insertError.message
          );

        }



        newSignals.push({

          id:
            inserted.id,

          ...signal

        });



        results.push({

          asset,

          status:
            "SIGNAL_READY",

          direction,

          score:
            signal.score,

          entryTime:
            signal.entryTime,

          expiryTime:
            signal.expiryTime,

          entryPrice:
            signal.entryPrice

        });



      }
      catch(error){


        results.push({

          asset,

          status:"ERROR",

          error:
            error.message

        });


      }


    }



    // ==============================
    // SEND TELEGRAM
    // ==============================


    if(newSignals.length > 0){


      newSignals.sort(
        (a,b)=>
        new Date(a.entryTime)
        -
        new Date(b.entryTime)
      );



      const text =
        newSignals
        .map(
          s =>
          formatSignal(s)
        )
        .join(
          "\n\n================\n\n"
        );



      await sendTelegram(text);


    }



    return res.status(200)
    .json({

      ok:true,

      scannedAt,

      timeframe:"M5",

      timezone:"UTC+6",

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

      step:"SCAN",

      error:
        error.message

    });


  }

}
