import { createClient } from "@supabase/supabase-js";
import { generateSignal } from "../signal-engine.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);


export default async function handler(req, res) {

  try {

    const timeframe = "M1";
    const expirationMinutes = 1;

    const timezone = "Asia/Jakarta";


    // daftar market OTC free tier
    const assets = [
      "EUR/USD",
      "GBP/USD",
      "USD/JPY",
      "AUD/USD"
    ];


    let candidates = [];


    // scan semua pair
    for (const asset of assets) {

      const signal = await generateSignal(
        asset,
        timeframe
      );


      if(signal && signal.score >= 2){

        candidates.push({

          asset,
          direction: signal.direction,
          score: signal.score,
          reasons: signal.reasons || []

        });

      }

    }



    // tidak ada signal
    if(candidates.length === 0){

      return res.json({

        ok:true,
        timeframe,
        timezone,
        expirationMinutes,
        newSignals:0,
        results:[]

      });

    }



    // ambil hanya score tertinggi
    candidates.sort(
      (a,b)=> b.score - a.score
    );


    const best = candidates[0];



    // waktu WIB
    const now = new Date();


    // bulatkan ke menit berikutnya
    const entryTime = new Date(
      Math.ceil(now.getTime()/60000)*60000
    );


    const expiryTime = new Date(
      entryTime.getTime()
      +
      expirationMinutes*60000
    );



    const signalKey =
      `${best.asset}-${entryTime.toISOString()}`;



    // simpan PENDING
    const {data,error} = await supabase
    .from("signals")
    .insert({

      asset: best.asset,

      direction: best.direction,

      score: best.score,

      signal_key: signalKey,

      signal_time: now.toISOString(),

      entry_time: entryTime.toISOString(),

      expiry_time: expiryTime.toISOString(),

      expiration_minutes: expirationMinutes,

      result:"PENDING",

      reasons: best.reasons

    })
    .select();



    if(error){
      throw error;
    }



    return res.json({

      ok:true,

      timeframe,

      timezone,

      expirationMinutes,

      newSignals:1,

      signal:data[0]

    });



  } catch(err){

    return res.status(500).json({

      ok:false,

      error:err.message

    });

  }

}
