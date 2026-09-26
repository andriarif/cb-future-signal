// api/scan.js
// CB Future Signal - SIGNAL ONLY + IMAGE
// M1 EMA50 + RSI14 + Candle Confirmation
//
// FINAL:
// - Scan 4 OTC pairs
// - Select 1 best signal
// - Cooldown 5 minutes
// - Telegram: IMAGE + CLEAN CAPTION
// - No entry price
// - No expiry price
// - No tick
// - No WIN / LOSS
// - No settlement
// - Timezone Asia/Jakarta

import { createClient } from "@supabase/supabase-js";

import {
    normalizeCandles,
    analyze
} from "../signal-engine.js";


// ======================================================
// SETTINGS
// ======================================================

const TIMEZONE = "Asia/Jakarta";

const TIMEFRAME = "M1";

const EXPIRATION_MINUTES = 1;

const COOLDOWN_MINUTES = 5;

const OTCHARTS_CORRECTION_MS =
    -2 * 60 * 60 * 1000;


// ======================================================
// OTC ASSETS
// ======================================================

const ASSETS = [
    "EUR/USD",
    "GBP/USD",
    "USD/JPY",
    "AUD/USD"
];


// ======================================================
// TELEGRAM IMAGE
// ======================================================

const BUY_IMAGE_URL =
    "https://raw.githubusercontent.com/andriarif/cb-future-signal/main/api/signal-buy.jpg";

const SELL_IMAGE_URL =
    "https://raw.githubusercontent.com/andriarif/cb-future-signal/main/api/signal-sell.jpg";


// ======================================================
// SUPABASE
// ======================================================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);


// ======================================================
// SYMBOL
// ======================================================

function symbolFor(asset) {

    return (
        asset.replace("/", "") +
        "_otc"
    );
}


// ======================================================
// CORRECT OTCHARTS TIME
// ======================================================

function correctCandleTimes(candles) {

    return candles.map(candle => ({

        ...candle,

        time: new Date(
            candle.time.getTime() +
            OTCHARTS_CORRECTION_MS
        )

    }));
}


// ======================================================
// GET CANDLES
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
// LATEST CLOSED CANDLE
// ======================================================

function getLatestClosedCandle(
    candles
) {

    const now =
        new Date();


    const currentMinute =
        Math.floor(
            now.getTime() /
            60000
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
// COOLDOWN CHECK
// ======================================================

async function getCooldownStatus() {

    const {
        data,
        error
    } = await supabase

        .from("signals")

        .select(
            "id, asset, direction, score, signal_time, entry_time"
        )

        .order(
            "signal_time",
            {
                ascending: false
            }
        )

        .limit(1);


    if (error) {

        throw error;
    }


    if (
        !data ||
        data.length === 0
    ) {

        return {
            cooldown: false
        };
    }


    const lastSignal =
        data[0];


    const lastSignalTime =
        new Date(
            lastSignal.signal_time
        ).getTime();


    const elapsed =
        Date.now() -
        lastSignalTime;


    const cooldownMs =
        COOLDOWN_MINUTES *
        60 *
        1000;


    if (
        elapsed <
        cooldownMs
    ) {

        const remainingMinutes =
            Math.ceil(
                (
                    cooldownMs -
                    elapsed
                ) / 60000
            );


        return {

            cooldown: true,

            remainingMinutes,

            lastSignal

        };
    }


    return {
        cooldown: false
    };
}


// ======================================================
// CLEAN TELEGRAM CAPTION
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
        Array.isArray(
            signal.reasons
        )
            ? signal.reasons
            : [];


    let reasonLines = [];


    for (
        const reason of reasons
    ) {

        let cleanReason =
            String(reason);


        // ----------------------------------------------
        // Bahasa Indonesia → English / clean
        // ----------------------------------------------

        cleanReason =
            cleanReason
                .replace(
                    "Harga di atas EMA50",
                    "Above EMA50"
                )
                .replace(
                    "Harga di bawah EMA50",
                    "Below EMA50"
                )
                .replace(
                    "Candle bullish",
                    "Bullish candle"
                )
                .replace(
                    "Candle bearish",
                    "Bearish candle"
                );


        // RSI naik 52.1
        cleanReason =
            cleanReason.replace(
                /^RSI naik\s*/i,
                "RSI ↑ "
            );


        // RSI turun 52.1
        cleanReason =
            cleanReason.replace(
                /^RSI turun\s*/i,
                "RSI ↓ "
            );


        reasonLines.push(
            `• ${cleanReason}`
        );
    }


    const reasonText =
        reasonLines.join("\n");


    return (
`⚡ SIGNAL

🌐 ${signal.asset} OTC
⏱ M1 • 1 Minute

🕐 Entry: ${formatWIB(
    new Date(
        signal.entryTime
    )
)} WIB

${emoji} ${direction}

📊 Confirmation: ${signal.score}/10
${reasonText}

⚠️ Enter at signal time`
    );
}


// ======================================================
// SEND TELEGRAM IMAGE
// ======================================================

async function sendTelegramSignal(
    signal
) {

    const token =
        process.env.TELEGRAM_BOT_TOKEN;


    const chatId =
        process.env.TELEGRAM_CHAT_ID;


    if (
        !token ||
        !chatId
    ) {

        throw new Error(
            "Telegram environment variables belum lengkap."
        );
    }


    const direction =
        signal.direction === "CALL"
            ? "BUY"
            : "SELL";


    const imageUrl =
        direction === "BUY"
            ? BUY_IMAGE_URL
            : SELL_IMAGE_URL;


    const caption =
        formatSignal(signal);


    const url =
        `https://api.telegram.org/bot${token}/sendPhoto`;


    const response =
        await fetch(
            url,
            {

                method: "POST",

                headers: {

                    "Content-Type":
                        "application/json"

                },

                body: JSON.stringify({

                    chat_id:
                        chatId,

                    photo:
                        imageUrl,

                    caption:
                        caption

                })

            }
        );


    if (!response.ok) {

        const body =
            await response.text();


        throw new Error(
            `Telegram ${response.status}: ${body.slice(0, 300)}`
        );
    }


    return response.json();
}


// ======================================================
// MAIN HANDLER
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
                req.headers[
                    "x-run-secret"
                ] ||
                req.query?.secret ||
                "";


            if (
                provided !==
                secret
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
        // COOLDOWN
        // ==================================================

        const cooldown =
            await getCooldownStatus();


        if (
            cooldown.cooldown
        ) {

            return res
                .status(200)
                .json({

                    ok: true,

                    mode:
                        "SIGNAL_ONLY",

                    status:
                        "COOLDOWN",

                    cooldownMinutes:
                        COOLDOWN_MINUTES,

                    remainingMinutes:
                        cooldown.remainingMinutes,

                    message:
                        "Cooldown aktif. Menunggu signal berikutnya."

                });
        }


        // ==================================================
        // MINIMUM SCORE
        // ==================================================

        const minScore =
            Number(
                process.env.MIN_SIGNAL_SCORE ||
                2
            );


        // ==================================================
        // CANDIDATES
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


                const latestClosed =
                    getLatestClosedCandle(
                        candles
                    );


                if (
                    !latestClosed
                ) {

                    scanResults.push({

                        asset,

                        status:
                            "NO_CLOSED_CANDLE"

                    });

                    continue;
                }


                const analysisCandles =
                    candles.filter(
                        candle =>
                            candle.time.getTime() <=
                            latestClosed.time.getTime()
                    );


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


                // ==========================================
                // ENTRY +2 MINUTES
                // ==========================================

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

                    status:
                        "NO_SIGNAL",

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

                if (
                    b.score !==
                    a.score
                ) {

                    return (
                        b.score -
                        a.score
                    );
                }


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

                    status:
                        "DUPLICATE",

                    selected:
                        bestSignal.asset,

                    direction:
                        bestSignal.direction,

                    score:
                        bestSignal.score

                });
        }


        // ==================================================
        // SAVE SIGNAL
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
        // SEND IMAGE + CAPTION
        // ==================================================

        await sendTelegramSignal(
            bestSignal
        );


        // ==================================================
        // SUCCESS
        // ==================================================

        return res
            .status(200)
            .json({

                ok: true,

                mode:
                    "SIGNAL_ONLY",

                status:
                    "SIGNAL_SENT",

                selected:
                    bestSignal.asset,

                direction:
                    bestSignal.direction,

                score:
                    bestSignal.score,

                entryTime:
                    bestSignal.entryTime,

                expiration:
                    EXPIRATION_MINUTES,

                cooldownMinutes:
                    COOLDOWN_MINUTES,

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
