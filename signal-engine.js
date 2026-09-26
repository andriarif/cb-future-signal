// signal-engine.js
// M1 EMA9 + EMA21 + MACD
// BUY  = EMA9 > EMA21 + MACD POSITIVE
// SELL = EMA9 < EMA21 + MACD NEGATIVE

const M1_MS = 60 * 1000;


// =====================================
// NORMALIZE
// =====================================

export function normalizeCandles(raw){

    let rows = [];

    if(Array.isArray(raw)){
        rows = raw;
    }
    else if(Array.isArray(raw?.candles)){
        rows = raw.candles;
    }
    else if(Array.isArray(raw?.data)){
        rows = raw.data;
    }

    return rows.map(c => {

        const t =
            c.time ??
            c.timestamp ??
            c.ts;

        const ms =
            typeof t === "number"
            ?
            (
                t < 10000000000
                ?
                t * 1000
                :
                t
            )
            :
            Date.parse(t);

        return {

            time: new Date(ms),

            open: Number(c.open ?? c.o),

            high: Number(c.high ?? c.h),

            low: Number(c.low ?? c.l),

            close: Number(c.close ?? c.c)

        };

    })
    .filter(c =>

        Number.isFinite(c.time.getTime()) &&

        Number.isFinite(c.open) &&

        Number.isFinite(c.high) &&

        Number.isFinite(c.low) &&

        Number.isFinite(c.close)

    )
    .sort(
        (a,b) => a.time - b.time
    );

}



// =====================================
// EMA
// =====================================

function ema(values, period){

    if(values.length < period)
        return null;

    const k =
        2 / (period + 1);

    let result =
        values
            .slice(0, period)
            .reduce(
                (a,b) => a + b,
                0
            ) / period;

    for(
        let i = period;
        i < values.length;
        i++
    ){

        result =
            values[i] * k
            +
            result * (1 - k);

    }

    return result;

}



// =====================================
// EMA SERIES
// =====================================

function emaSeries(values, period){

    if(values.length < period)
        return [];

    const k =
        2 / (period + 1);

    const result = [];

    let current =
        values
            .slice(0, period)
            .reduce(
                (a,b) => a + b,
                0
            ) / period;

    result.push(current);

    for(
        let i = period;
        i < values.length;
        i++
    ){

        current =
            values[i] * k
            +
            current * (1 - k);

        result.push(current);

    }

    return result;

}



// =====================================
// MACD
// =====================================
//
// MACD = EMA12 - EMA26
//
// Signal line = EMA9 of MACD
//
// Untuk aturan utama:
// MACD > 0  = bullish
// MACD < 0  = bearish
//
// =====================================

function macd(values){

    if(values.length < 35)
        return null;

    const fastEMA =
        emaSeries(
            values,
            12
        );

    const slowEMA =
        emaSeries(
            values,
            26
        );

    if(
        fastEMA.length === 0 ||
        slowEMA.length === 0
    ){
        return null;
    }


    // =================================
    // Samakan posisi EMA12 dan EMA26
    // =================================

    const offset =
        fastEMA.length -
        slowEMA.length;

    const macdValues = [];

    for(
        let i = 0;
        i < slowEMA.length;
        i++
    ){

        const fast =
            fastEMA[i + offset];

        const slow =
            slowEMA[i];

        macdValues.push(
            fast - slow
        );

    }


    if(macdValues.length === 0)
        return null;


    const currentMACD =
        macdValues[
            macdValues.length - 1
        ];


    // =================================
    // Signal Line
    // =================================

    const signalSeries =
        emaSeries(
            macdValues,
            9
        );

    let signalLine = null;

    if(signalSeries.length > 0){

        signalLine =
            signalSeries[
                signalSeries.length - 1
            ];

    }


    return {

        macd: currentMACD,

        signal: signalLine,

        histogram:
            signalLine !== null
            ?
            currentMACD - signalLine
            :
            null

    };

}



// =====================================
// ANALYZE
// =====================================

export function analyze(
    asset,
    candles,
    minScore = 2
){

    // Minimal data untuk EMA26 + MACD
    if(candles.length < 60)
        return null;


    const closes =
        candles.map(
            c => c.close
        );


    const i =
        candles.length - 1;


    const candle =
        candles[i];


    // =================================
    // EMA9
    // =================================

    const ema9 =
        ema(
            closes,
            9
        );


    // =================================
    // EMA21
    // =================================

    const ema21 =
        ema(
            closes,
            21
        );


    // =================================
    // MACD
    // =================================

    const macdData =
        macd(
            closes
        );


    if(
        ema9 === null ||
        ema21 === null ||
        macdData === null
    ){

        return null;

    }


    const macdValue =
        macdData.macd;


    // =================================
    // BUY
    // =================================
    //
    // EMA9 > EMA21
    // MACD > 0
    //
    // =================================

    if(
        ema9 > ema21 &&
        macdValue > 0
    ){

        const reasons = [

            `EMA9 > EMA21`,

            `MACD +${macdValue.toFixed(6)}`

        ];


        return makeSignal(

            asset,

            "CALL",

            2,

            candle,

            reasons

        );

    }



    // =================================
    // SELL
    // =================================
    //
    // EMA9 < EMA21
    // MACD < 0
    //
    // =================================

    if(
        ema9 < ema21 &&
        macdValue < 0
    ){

        const reasons = [

            `EMA9 < EMA21`,

            `MACD ${macdValue.toFixed(6)}`

        ];


        return makeSignal(

            asset,

            "PUT",

            2,

            candle,

            reasons

        );

    }



    // =================================
    // NO SIGNAL
    // =================================

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
