import { createClient } from "@supabase/supabase-js";
import { normalizeCandles } from "../signal-engine.js";


const supabase =
createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_ROLE_KEY
);


const OTCHARTS_API_KEY =
process.env.OTCHARTS_API_KEY;


const EXPIRATION_MINUTES = 1;



const ASSETS = [
 "EUR/USD",
 "GBP/USD",
 "USD/JPY",
 "AUD/USD"
];



// ==================================
// SYMBOL
// ==================================

function symbolFor(asset){

 return (
  asset.replace("/","")
  +
  "_otc"
 );

}



// ==================================
// GET CANDLES M1
// ==================================

async function getCandles(asset){


 const url =
 `https://otcharts.com/v1/candles`
 +
 `?venue=otc`
 +
 `&symbol=${symbolFor(asset)}`
 +
 `&tf=60`
 +
 `&limit=10`;



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



// ==================================
// SETTLE
// ==================================

export default async function handler(
 req,
 res
){


 const results=[];


 try{


  const {
   data:signals,
   error
  } =
  await supabase
  .from("signals")
  .select("*")
  .eq(
   "result",
   "PENDING"
  )
  .order(
   "entry_time",
   {
    ascending:true
   }
  );



  if(error)
  throw error;



  if(!signals || signals.length===0){

   return res.status(200)
   .json({

    ok:true,

    checked:0,

    results:[]

   });

  }



  for(
   const signal of signals
  ){


   try{


    const now =
    new Date();



    const expiryTime =
    new Date(
     signal.expiry_time
    );



    // ==========================
    // BELUM EXPIRY
    // ==========================

    if(
     now < expiryTime
    ){


     results.push({

      id:
      signal.id,


      asset:
      signal.asset,


      status:
      "WAITING_EXPIRY",


      expiryTime:
      expiryTime.toISOString()

     });


     continue;

    }



    // ==========================
    // AMBIL CANDLE HASIL
    // ==========================


    const raw =
    await getCandles(
     signal.asset
    );


    const candles =
    normalizeCandles(raw);



    if(candles.length===0){

     results.push({

      id:
      signal.id,

      status:
      "NO_CANDLE"

     });

     continue;

    }



    const last =
    candles[
     candles.length-1
    ];



    const closePrice =
    last.close;



    let result;



    if(
     signal.direction==="CALL"
    ){

     result =
     closePrice >
     Number(signal.entry_price)
     ?
     "WIN"
     :
     "LOSS";

    }
    else{


     result =
     closePrice <
     Number(signal.entry_price)
     ?
     "WIN"
     :
     "LOSS";


    }



    await supabase
    .from("signals")
    .update({

     result,


     result_price:
     closePrice,


     result_time:
     last.time.toISOString(),


     settled_at:
     new Date()
     .toISOString()

    })
    .eq(
     "id",
     signal.id
    );



    results.push({

     id:
     signal.id,


     asset:
     signal.asset,


     direction:
     signal.direction,


     entryPrice:
     signal.entry_price,


     closePrice,


     result,


     status:
     "SETTLED"

    });



   }
   catch(err){


    results.push({

     asset:
     signal.asset,


     status:
     "ERROR",


     error:
     err.message

    });


   }


  }



  return res.status(200)
  .json({

   ok:true,


   timeframe:
   "M1",


   expirationMinutes:
   EXPIRATION_MINUTES,


   checked:
   signals.length,


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
