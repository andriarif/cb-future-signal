// signal-engine.js
// M1 EMA50 + RSI14 LOOSE SCALPING

const M1_MS = 60 * 1000;


// =====================================
// NORMALIZE
// =====================================

export function normalizeCandles(raw){

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


    return rows.map(c=>{

        const t =
        c.time ??
        c.timestamp ??
        c.ts;


        const ms =
        typeof t==="number"
        ?
        (
          t < 10000000000
          ?
          t*1000
          :
          t
        )
        :
        Date.parse(t);



        return {

            time:new Date(ms),

            open:Number(c.open ?? c.o),

            high:Number(c.high ?? c.h),

            low:Number(c.low ?? c.l),

            close:Number(c.close ?? c.c)

        };


    })
    .filter(c=>

        Number.isFinite(
            c.time.getTime()
        )
        &&
        Number.isFinite(c.open)
        &&
        Number.isFinite(c.high)
        &&
        Number.isFinite(c.low)
        &&
        Number.isFinite(c.close)

    )
    .sort(
        (a,b)=>
        a.time-b.time
    );

}



// =====================================
// EMA
// =====================================

function ema(values,period){

    if(values.length < period)
        return null;


    const k =
    2/(period+1);


    let result =
    values
    .slice(0,period)
    .reduce(
        (a,b)=>a+b,
        0
    ) / period;



    for(
        let i=period;
        i<values.length;
        i++
    ){

        result =
        values[i]*k
        +
        result*(1-k);

    }


    return result;

}



// =====================================
// RSI
// =====================================

function rsi(values,period=14){

    if(values.length<=period)
        return null;


    let gain=0;
    let loss=0;



    for(
        let i=1;
        i<=period;
        i++
    ){

        const diff =
        values[i]-values[i-1];


        if(diff>=0)
            gain+=diff;
        else
            loss+=Math.abs(diff);

    }



    let avgGain =
    gain/period;


    let avgLoss =
    loss/period;



    for(
        let i=period+1;
        i<values.length;
        i++
    ){

        const diff =
        values[i]-values[i-1];


        const g =
        Math.max(diff,0);


        const l =
        Math.max(-diff,0);



        avgGain =
        (
          avgGain*(period-1)+g
        )
        /
        period;



        avgLoss =
        (
          avgLoss*(period-1)+l
        )
        /
        period;

    }



    if(avgLoss===0)
        return 100;


    const rs =
    avgGain/avgLoss;


    return 100-(100/(1+rs));

}



// =====================================
// ANALYZE
// =====================================

export function analyze(
    asset,
    candles,
    minScore=2
){


    if(candles.length < 60)
        return null;



    const closes =
    candles.map(
        c=>c.close
    );


    const i =
    candles.length-1;



    const candle =
    candles[i];



    const ema50 =
    ema(
        closes,
        50
    );


    const rsi14 =
    rsi(
        closes,
        14
    );



    const prevRSI =
    rsi(
        closes.slice(0,-1),
        14
    );



    if(!ema50 || !rsi14)
        return null;



    let buy=0;
    let sell=0;


    let buyReasons=[];
    let sellReasons=[];



    // =========================
    // EMA50
    // =========================


    if(candle.close > ema50){

        buy++;

        buyReasons.push(
            "Harga di atas EMA50"
        );

    }


    if(candle.close < ema50){

        sell++;

        sellReasons.push(
            "Harga di bawah EMA50"
        );

    }



    // =========================
    // RSI14
    // =========================


    if(prevRSI){

        if(rsi14 > prevRSI){

            buy++;

            buyReasons.push(
                `RSI naik ${rsi14.toFixed(1)}`
            );

        }


        if(rsi14 < prevRSI){

            sell++;

            sellReasons.push(
                `RSI turun ${rsi14.toFixed(1)}`
            );

        }

    }



    // =========================
    // CANDLE CONFIRM
    // =========================


    if(candle.close > candle.open){

        buy++;

        buyReasons.push(
            "Candle bullish"
        );

    }



    if(candle.close < candle.open){

        sell++;

        sellReasons.push(
            "Candle bearish"
        );

    }




    // =========================
    // SIGNAL
    // =========================


    if(
        buy>=2 &&
        buy>sell
    ){

        return makeSignal(
            asset,
            "CALL",
            buy,
            candle,
            buyReasons
        );

    }



    if(
        sell>=2 &&
        sell>buy
    ){

        return makeSignal(
            asset,
            "PUT",
            sell,
            candle,
            sellReasons
        );

    }



    return null;

}



// =====================================
// CREATE SIGNAL
// =====================================

function makeSignal(
    asset,
    direction,
    score,
    candle,
    reasons
){


    const entry =
    new Date(
        candle.time.getTime()
        +
        M1_MS
    );



    const expiry =
    new Date(
        entry.getTime()
        +
        M1_MS
    );



    return {

        asset,

        direction,

        score,


        signalTime:
        new Date()
        .toISOString(),


        entryTime:
        entry.toISOString(),


        expiryTime:
        expiry.toISOString(),


        entryPrice:
        candle.close,


        expirationMinutes:
        1,


        reasons

    };

}
