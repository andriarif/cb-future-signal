// api/scan.js
// CB Future Signal - SIGNAL ONLY
// 1 BEST SIGNAL FROM 4 OTC PAIRS
// Strategy: M1 EMA50 + RSI14 + Candle Confirmation
// No Entry Price
// No Expiration Price
// No WIN / LOSS
// No Tick Price
// Timezone: Asia/Jakarta

import { createClient } from "@supabase/supabase-js";
import {
    normalizeCandles,
    analyze
} from "../signal-engine.js";

const TIMEZONE = "Asia/Jakarta";
const TIMEFRAME = "M1";
const EXPIRATION_MINUTES = 1;

const OTCHARTS_CORRECTION_MS =
    -2 * 60 * 60 * 1000;

const ASSETS = [
    "EUR/USD",
    "GBP/USD",
    "USD/JPY",
    "AUD/USD"
];

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);


// ======================================================
// SYMBOL
// ======================================================

function symbolFor(asset) {
    return asset.replace("/", "") + "_otc";
}


// ======================================================
// CORRECT OTCHARTS TIME
// ======================================================

function correctCandleTimes(candles) {
    return candles.map(c => ({
        ...c,
        time: new Date(
            c.time.getTime() +
            OTCHARTS_CORRECTION_MS
        )
    }));
}


// ======================================================
// GET M1 CANDLES
// ======================================================

async function getCandles(asset) {

    const symbol =
        symbolFor(asset);

    const url =
        `https://otcharts.com/v1/candles` +
        `?venue=otc` +
        `&symbol=${encodeURIComponent(symbol)}` +
        `&tf=60` +
        `&limit=120`;

    const response =
        await fetch(url, {
            headers: {
                Authorization:
                    `Bearer ${process.env.OTCHARTS_API_KEY}`
            }
        });

    if (!response.ok) {

        const body =
            await response.text();

        throw new Error(
            `OTCharts ${response.status}: ${body.slice(0, 300)}`
        );
    }

    const raw =
        await response.json();

    const candles =
        normalizeCandles(raw);

    return correctCandleTimes(
        candles
    );
}


// ======================================================
// FORMAT WIB
// ======================================================

function formatWIB(date) {

    return new Intl.DateTimeFormat(
        "id-ID",
        {
            timeZone: TIMEZONE,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }
    )
        .format(date)
        .replace(/\./g, ":");
}


// ======================================================
// LATEST CLOSED M1 CANDLE
// ======================================================

function getLatestClosedCandle(
    candles
) {

    const now =
        new Date();

    const currentMinute =
        Math.floor(
            now.getTime() / 60000
        ) * 60000;

    const closed =
        candles.filter(
            candle =>
                candle.time.getTime() <
                currentMinute
        );

    if (!closed.length) {
        return null;
    }

    return closed[
        closed.length - 1
    ];
}


// ======================================================
// DUPLICATE CHECK
// ======================================================

async function signalExists(
    signalKey
) {

    const {
        data,
        error
    } = await supabase
        .from("signals")
        .select("id")
        .eq(
            "signal_key",
            signalKey
        )
        .limit(1);

    if (error) {
        throw error;
    }

    return (
        Array.isArray(data) &&
        data.length > 0
    );
}


// ======================================================
// TELEGRAM MESSAGE
// ======================================================

function formatSignal(signal) {

    const direction =
        signal.direction === "CALL"
            ? "BUY"
            : "SELL";

    const emoji =
        direction === "BUY"
            ? "🟢"
            : "🔴";

    const reasons =
        Array.isArray(signal.reasons)
            ? signal.reasons
            : [];

    const reasonText =
        reasons
            .map(reason =>
                `🔎 ${reason}`
            )
            .join("\n");

    return (
`━━━━━━━━━━━━━━━━━━
⚡ SIGNAL
━━━━━━━━━━━━━━━━━━

🌐 ${signal.asset} OTC

Timeframe: M1
⏱️ Expiration: 1 minute

⏰ Entry:
${formatWIB(
    new Date(signal.entryTime)
)} WIB

${emoji} Direction:
${direction}

📊 Confirmation:
${signal.score}/10

${reasonText}

⚠️ Entry sesuai waktu signal
━━━━━━━━━━━━━━━━━━`
    );
}


// ======================================================
// TELEGRAM
// ======================================================

async function sendTelegram(
    text
) {

    const token =
        process.env.TELEGRAM_BOT_TOKEN;

    const chatId =
        process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {

        throw new Error(
            "Telegram environment variables belum lengkap."
        );
    }

    const url =
        `https://api.telegram.org/bot${token}/sendMessage`;

    const response =
        await fetch(url, {

            method: "POST",

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({
                chat_id: chatId,
                text
            })
        });

    if (!response.ok) {

        const body =
            await response.text();

        throw new Error(
            `Telegram ${response.status}: ${body.slice(0, 300)}`
        );
    }
}


// ======================================================
// MAIN
// ======================================================

export default async function handler(
    req,
    res
) {

    try {

        // ==================================================
        // RUN SECRET
        // ==================================================

        const secret =
            process.env.RUN_SECRET;

        if (secret) {

            const provided =
                req.query?.secret ||
                req.headers[
                    "x-run-secret"
                ];

            if (
                provided !== secret
            ) {

                return res
                    .status(401)
                    .json({
                        ok: false,
                        error:
                            "UNAUTHORIZED"
                    });
            }
        }


        // ==================================================
        // CURRENT TIME
        // ==================================================

        const now =
            new Date();


        // ==================================================
        // MINIMUM SCORE
        // ==================================================

        const minScore =
            Number(
                process.env.MIN_SIGNAL_SCORE ||
                2
            );


        // ==================================================
        // COLLECT ALL VALID SIGNALS
        // ==================================================

        const candidates = [];

        const scanResults = [];


        // ==================================================
        // SCAN 4 PAIRS
        // ==================================================

        for (
            const asset of ASSETS
        ) {

            try {

                const candles =
                    await getCandles(
                        asset
                    );


                if (
                    !candles ||
                    candles.length < 60
                ) {

                    scanResults.push({
                        asset,
                        status:
                            "NOT_ENOUGH_CANDLES"
                    });

                    continue;
                }


                // ------------------------------------------
                // CLOSED CANDLE
                // ------------------------------------------

                const latestClosed =
                    getLatestClosedCandle(
                        candles
                    );


                if (!latestClosed) {

                    scanResults.push({
                        asset,
                        status:
                            "NO_CLOSED_CANDLE"
                    });

                    continue;
                }


                // ------------------------------------------
                // ONLY CLOSED CANDLES
                // ------------------------------------------

                const analysisCandles =
                    candles.filter(
                        candle =>
                            candle.time.getTime() <=
                            latestClosed.time.getTime()
                    );


                // ------------------------------------------
                // ANALYZE
                // ------------------------------------------

                const signal =
                    analyze(
                        asset,
                        analysisCandles,
                        minScore
                    );


                if (!signal) {

                    scanResults.push({
                        asset,
                        status:
                            "NO_SIGNAL"
                    });

                    continue;
                }


                // ------------------------------------------
                // ENTRY = SOURCE CANDLE + 2 MINUTES
                // ------------------------------------------

                const sourceTime =
                    latestClosed.time;

                const entryTime =
                    new Date(
                        sourceTime.getTime() +
                        2 * 60 * 1000
                    );

                const expiryTime =
                    new Date(
                        entryTime.getTime() +
                        EXPIRATION_MINUTES *
                        60 *
                        1000
                    );


                // ------------------------------------------
                // ENTRY MUST BE FUTURE
                // ------------------------------------------

                if (
                    entryTime.getTime() <=
                    now.getTime()
                ) {

                    scanResults.push({
                        asset,
                        status:
                            "ENTRY_TIME_PASSED"
                    });

                    continue;
                }


                // ------------------------------------------
                // ADD TO CANDIDATES
                // ------------------------------------------

                candidates.push({

                    ...signal,

                    entryTime:
                        entryTime.toISOString(),

                    expiryTime:
                        expiryTime.toISOString(),

                    sourceTime:
                        sourceTime.toISOString()

                });


                scanResults.push({
                    asset,
                    status:
                        "CANDIDATE",
                    direction:
                        signal.direction,
                    score:
                        signal.score
                });

            }
            catch (error) {

                scanResults.push({
                    asset,
                    status:
                        "ERROR",
                    error:
                        error.message
                });
            }
        }


        // ==================================================
        // NO SIGNAL
        // ==================================================

        if (
            candidates.length === 0
        ) {

            return res
                .status(200)
                .json({

                    ok: true,

                    mode:
                        "SIGNAL_ONLY",

                    selected:
                        null,

                    message:
                        "Tidak ada signal yang memenuhi syarat.",

                    scanResults

                });
        }


        // ==================================================
        // SELECT BEST SIGNAL
        // ==================================================

        candidates.sort(
            (a, b) => {

                // Score tertinggi terlebih dahulu
                if (
                    b.score !==
                    a.score
                ) {

                    return (
                        b.score -
                        a.score
                    );
                }

                // Jika score sama,
                // pilih entry paling dekat
                return (
                    new Date(
                        a.entryTime
                    ).getTime() -
                    new Date(
                        b.entryTime
                    ).getTime()
                );
            }
        );


        const bestSignal =
            candidates[0];


        // ==================================================
        // SIGNAL KEY
        // ==================================================

        const signalKey =
            [
                bestSignal.asset,
                bestSignal.direction,
                bestSignal.entryTime
            ].join("_");


        // ==================================================
        // DUPLICATE CHECK
        // ==================================================

        if (
            await signalExists(
                signalKey
            )
        ) {

            return res
                .status(200)
                .json({

                    ok: true,

                    mode:
                        "SIGNAL_ONLY",

                    selected:
                        bestSignal.asset,

                    status:
                        "DUPLICATE",

                    direction:
                        bestSignal.direction,

                    score:
                        bestSignal.score,

                    entryTime:
                        bestSignal.entryTime,

                    scanResults

                });
        }


        // ==================================================
        // SAVE ONLY SELECTED SIGNAL
        // ==================================================

        const {
            data: inserted,
            error: insertError
        } = await supabase
            .from("signals")
            .insert({

                asset:
                    bestSignal.asset,

                direction:
                    bestSignal.direction,

                score:
                    bestSignal.score,

                signal_key:
                    signalKey,

                signal_time:
                    now.toISOString(),

                entry_time:
                    bestSignal.entryTime,

                entry_price:
                    null,

                result:
                    "PENDING",

                reasons:
                    bestSignal.reasons,

                timeframe:
                    TIMEFRAME,

                expiration_minutes:
                    EXPIRATION_MINUTES,

                expiry_time:
                    bestSignal.expiryTime,

                source_candle_time:
                    bestSignal.sourceTime,

                result_price:
                    null,

                result_time:
                    null,

                settled_at:
                    null

            })
            .select()
            .single();


        if (insertError) {
            throw insertError;
        }


        // ==================================================
        // SEND ONLY ONE TELEGRAM SIGNAL
        // ==================================================

        const telegramText =
            formatSignal(
                bestSignal
            );

        await sendTelegram(
            telegramText
        );


        // ==================================================
        // RESPONSE
        // ==================================================

        return res
            .status(200)
            .json({

                ok: true,

                mode:
                    "SIGNAL_ONLY",

                selected:
                    bestSignal.asset,

                status:
                    "SIGNAL_SENT",

                direction:
                    bestSignal.direction,

                score:
                    bestSignal.score,

                entryTime:
                    bestSignal.entryTime,

                expiration:
                    EXPIRATION_MINUTES,

                signalId:
                    inserted.id,

                scanned:
                    ASSETS,

                candidates:
                    candidates.map(
                        item => ({
                            asset:
                                item.asset,
                            direction:
                                item.direction,
                            score:
                                item.score
                        })
                    )

            });

    }
    catch (error) {

        console.error(error);

        return res
            .status(500)
            .json({

                ok: false,

                error:
                    error.message

            });
    }
}
