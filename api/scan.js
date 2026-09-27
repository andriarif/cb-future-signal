// api/scan.js
// CB Future Signal
// SIGNAL ONLY + START/STOP + ACTIVE SIGNAL LOCK
// M1 EMA9 + EMA21 + MACD
//
// /start  = BOT ON
// /stop   = BOT OFF
// /status = CHECK STATUS

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

const ENTRY_DELAY_MINUTES = 2;

const OTCHARTS_CORRECTION_MS =
    -2 * 60 * 60 * 1000;


// ======================================================
// ASSETS
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
        .format(new Date(date))
        .replace(/\./g, ":");

}


// ======================================================
// GET CANDLES
// ======================================================

async function getCandles(asset) {

    const url =
        `https://otcharts.com/v1/candles` +
        `?venue=otc` +
        `&symbol=${encodeURIComponent(symbolFor(asset))}` +
        `&tf=60` +
        `&limit=120`;

    const response =
        await fetch(
            url,
            {
                headers: {
                    Authorization:
                        `Bearer ${process.env.OTCHARTS_API_KEY}`
                }
            }
        );

    if (!response.ok) {

        const text =
            await response.text();

        throw new Error(
            `OTCharts ${response.status}: ${text}`
        );

    }

    const raw =
        await response.json();

    const candles =
        normalizeCandles(raw);

    return candles.map(
        candle => ({

            ...candle,

            time:
                new Date(
                    candle.time.getTime() +
                    OTCHARTS_CORRECTION_MS
                )

        })
    );

}


// ======================================================
// LAST CLOSED CANDLE
// ======================================================

function getLatestClosedCandle(candles) {

    const currentMinute =
        Math.floor(
            Date.now() / 60000
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
// BOT STATUS
// ======================================================

async function getBotStatus() {

    const {
        data,
        error
    } = await supabase
        .from("bot_control")
        .select("is_active")
        .eq("id", 1)
        .maybeSingle();

    if (error) {

        throw error;

    }

    if (!data) {

        return false;

    }

    return data.is_active === true;

}


// ======================================================
// ACTIVE SIGNAL LOCK
// ======================================================

async function getActiveSignal() {

    const {
        data,
        error
    } = await supabase
        .from("signals")
        .select(
            "id,asset,direction,entry_time,expiry_time,result"
        )
        .eq(
            "result",
            "PENDING"
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

        return null;

    }

    const signal =
        data[0];

    const expiry =
        new Date(
            signal.expiry_time
        ).getTime();

    if (
        Date.now() < expiry
    ) {

        return signal;

    }

    return null;

}


// ======================================================
// DUPLICATE CHECK
// ======================================================

async function signalExists(key) {

    const {
        data,
        error
    } = await supabase
        .from("signals")
        .select("id")
        .eq(
            "signal_key",
            key
        )
        .limit(1);

    if (error) {

        throw error;

    }

    return (
        data &&
        data.length > 0
    );

}


// ======================================================
// TELEGRAM CAPTION
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

    let reasons = [];

    if (
        Array.isArray(signal.reasons)
    ) {

        reasons =
            signal.reasons.map(
                item => {

                    const text =
                        String(item);

                    return "• " + text;

                }
            );

    }

    return (
`⚡ SIGNAL

🌐 ${signal.asset} OTC
⏱ M1 • 1 Minute

🕐 Entry:
${formatWIB(signal.entryTime)} WIB

${emoji} ${direction}

📊 Confirmation:
${signal.score}/10

${reasons.join("\n")}

⚠️ Enter at signal time`
    );

}


// ======================================================
// SEND TELEGRAM SIGNAL
// ======================================================

async function sendTelegramSignal(signal) {

    const token =
        process.env.TELEGRAM_BOT_TOKEN;

    const chatId =
        process.env.TELEGRAM_CHAT_ID;

    const direction =
        signal.direction === "CALL"
            ? "BUY"
            : "SELL";

    const photo =
        direction === "BUY"
            ? BUY_IMAGE_URL
            : SELL_IMAGE_URL;

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

                body:
                    JSON.stringify({

                        chat_id:
                            chatId,

                        photo,

                        caption:
                            formatSignal(signal)

                    })
            }
        );

    if (!response.ok) {

        const text =
            await response.text();

        throw new Error(
            `Telegram ${text}`
        );

    }

}


// ======================================================
// CREATE ENTRY & EXPIRY
// ======================================================

function createTimes(candle) {

    const entry =
        new Date(
            candle.time.getTime() +
            ENTRY_DELAY_MINUTES *
            60 *
            1000
        );

    const expiry =
        new Date(
            entry.getTime() +
            EXPIRATION_MINUTES *
            60 *
            1000
        );

    return {

        entryTime:
            entry.toISOString(),

        expiryTime:
            expiry.toISOString()

    };

}


// ======================================================
// ANALYZE ASSET
// ======================================================

async function analyzeAsset(asset) {

    const candles =
        await getCandles(asset);

    if (
        !candles ||
        candles.length < 60
    ) {

        return null;

    }

    const closed =
        getLatestClosedCandle(
            candles
        );

    if (!closed) {

        return null;

    }

    const usable =
        candles.filter(
            candle =>
                candle.time.getTime() <=
                closed.time.getTime()
        );

    const signal =
        analyze(
            asset,
            usable,
            2
        );

    if (!signal) {

        return null;

    }

    const times =
        createTimes(
            closed
        );

    return {

        ...signal,

        entryTime:
            times.entryTime,

        expiryTime:
            times.expiryTime,

        sourceTime:
            closed.time.toISOString()

    };

}


// ======================================================
// SELECT BEST SCORE
// ======================================================

function selectBestSignal(list) {

    list.sort(
        (a, b) => {

            return (
                b.score -
                a.score
            );

        }
    );

    return list[0];

}


// ======================================================
// MAIN HANDLER
// ======================================================

export default async function handler(req, res) {

    try {

        // ==================================================
        // RUN SECRET
        // ==================================================

        const secret =
            process.env.RUN_SECRET;

        if (secret) {

            const supplied =
                req.headers["x-run-secret"] ||
                req.query?.secret ||
                "";

            if (
                supplied !== secret
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
        // CHECK BOT STATUS
        // ==================================================

        const botActive =
            await getBotStatus();

        if (!botActive) {

            return res
                .status(200)
                .json({

                    ok: true,

                    mode:
                        "SIGNAL_ONLY",

                    status:
                        "BOT_STOPPED",

                    message:
                        "Bot belum diaktifkan. Gunakan /start."

                });

        }


        // ==================================================
        // ACTIVE SIGNAL CHECK
        // ==================================================

        const active =
            await getActiveSignal();

        if (active) {

            return res
                .status(200)
                .json({

                    ok: true,

                    mode:
                        "SIGNAL_ONLY",

                    status:
                        "ACTIVE_SIGNAL",

                    message:
                        "Masih ada signal aktif",

                    activeSignal:
                        active

                });

        }


        // ==================================================
        // SCAN ALL ASSETS
        // ==================================================

        const candidates = [];

        const scanResults = [];


        for (
            const asset of ASSETS
        ) {

            try {

                const signal =
                    await analyzeAsset(
                        asset
                    );

                if (signal) {

                    candidates.push(
                        signal
                    );

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
                else {

                    scanResults.push({

                        asset,

                        status:
                            "NO_SIGNAL"

                    });

                }

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

                    scanResults

                });

        }


        // ==================================================
        // SELECT BEST
        // ==================================================

        const selected =
            selectBestSignal(
                candidates
            );


        // ==================================================
        // SIGNAL KEY
        // ==================================================

        const signalKey =
            `${selected.asset}_${selected.direction}_${selected.entryTime}`;


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

                    status:
                        "DUPLICATE",

                    selected:
                        selected.asset

                });

        }


        // ==================================================
        // SAVE DATABASE
        // ==================================================

        const {
            data: inserted,
            error: insertError

        } = await supabase
            .from("signals")
            .insert({

                asset:
                    selected.asset,

                timeframe:
                    TIMEFRAME,

                direction:
                    selected.direction,

                score:
                    selected.score,

                signal_key:
                    signalKey,

                signal_time:
                    new Date()
                        .toISOString(),

                source_candle_time:
                    selected.sourceTime,

                entry_time:
                    selected.entryTime,

                expiry_time:
                    selected.expiryTime,

                expiration_minutes:
                    EXPIRATION_MINUTES,

                entry_price:
                    0,

                result:
                    "PENDING",

                reasons:
                    selected.reasons

            })
            .select()
            .single();


        if (insertError) {

            throw insertError;

        }


        // ==================================================
        // SEND TELEGRAM
        // ==================================================

        await sendTelegramSignal(
            selected
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
                    selected.asset,

                direction:
                    selected.direction,

                score:
                    selected.score,

                entryTime:
                    selected.entryTime,

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

        return res
            .status(500)
            .json({

                ok: false,

                error:
                    error.message

            });

    }

}
