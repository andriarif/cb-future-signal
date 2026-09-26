// api/settle.js
// CB Future Signal - M1 Settlement
// Entry Price = OPEN candle entry
// Result Price = CLOSE candle expiry

import { createClient } from "@supabase/supabase-js";
import { normalizeCandles } from "../signal-engine.js";

const TIMEZONE = "Asia/Jakarta";
const TIMEFRAME = "M1";
const EXPIRATION_MINUTES = 1;

// OTCharts timestamp sebelumnya terbukti +2 jam
const OTCHARTS_CORRECTION_MS = -2 * 60 * 60 * 1000;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

function symbolFor(asset) {
    return asset.replace("/", "") + "_otc";
}

function correctCandleTimes(candles) {
    return candles.map(c => ({
        ...c,
        time: new Date(c.time.getTime() + OTCHARTS_CORRECTION_MS)
    }));
}

async function getCandles(asset) {
    const symbol = symbolFor(asset);

    const url =
        `https://otcharts.com/v1/candles` +
        `?venue=otc` +
        `&symbol=${encodeURIComponent(symbol)}` +
        `&tf=60` +
        `&limit=120`;

    const response = await fetch(url, {
        headers: {
            "X-API-Key": process.env.OTCHARTS_API_KEY
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `OTCharts ${response.status}: ${body.slice(0, 300)}`
        );
    }

    const raw = await response.json();
    const candles = normalizeCandles(raw);

    return correctCandleTimes(candles);
}

function findCandle(candles, targetTime) {
    const target = targetTime.getTime();

    // Exact match
    let exact = candles.find(
        c => c.time.getTime() === target
    );

    if (exact) return exact;

    // Fallback maksimum 30 detik
    let nearest = null;
    let nearestDiff = Infinity;

    for (const candle of candles) {
        const diff = Math.abs(candle.time.getTime() - target);

        if (diff < nearestDiff) {
            nearestDiff = diff;
            nearest = candle;
        }
    }

    if (nearest && nearestDiff <= 30000) {
        return nearest;
    }

    return null;
}

function formatWIB(iso) {
    return new Intl.DateTimeFormat("id-ID", {
        timeZone: TIMEZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    })
        .format(new Date(iso))
        .replace(/\./g, ":");
}

function formatPrice(price) {
    if (!Number.isFinite(Number(price))) return "-";

    const n = Number(price);

    if (n >= 100) return n.toFixed(3);
    if (n >= 10) return n.toFixed(3);
    if (n >= 1) return n.toFixed(5);

    return n.toFixed(5);
}

function resultMessage(signal) {
    const direction =
        signal.direction === "CALL" ? "BUY" : "SELL";

    const resultEmoji =
        signal.result === "WIN" ? "🟢" :
        signal.result === "LOSS" ? "🔴" :
        "⚪";

    return (
`━━━━━━━━━━━━━━━━━━
${resultEmoji} RESULT
━━━━━━━━━━━━━━━━━━

🌐 ${signal.asset} OTC
Timeframe: ${signal.timeframe || TIMEFRAME}

📌 Direction: ${direction}
💰 Entry Price: ${formatPrice(signal.entry_price)}
🏁 Expiry Price: ${formatPrice(signal.result_price)}

⏰ Entry: ${formatWIB(signal.entry_time)} WIB

⏰ Expiration: ${formatWIB(signal.expiry_time)} WIB

📊 Result: ${signal.result}

⚠️ Result dihitung setelah expiration.`
    );
}

async function sendTelegram(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        throw new Error("Telegram environment variables belum lengkap.");
    }

    const url =
        `https://api.telegram.org/bot${token}/sendMessage`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            chat_id: chatId,
            text
        })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(
            `Telegram ${response.status}: ${body.slice(0, 300)}`
        );
    }

    return true;
}

export default async function handler(req, res) {
    try {
        const now = new Date();

        // Ambil signal PENDING yang sudah melewati expiry
        const { data: signals, error: selectError } =
            await supabase
                .from("signals")
                .select("*")
                .eq("result", "PENDING")
                .eq("timeframe", TIMEFRAME)
                .lte("expiry_time", now.toISOString())
                .order("expiry_time", {
                    ascending: true
                })
                .limit(20);

        if (selectError) {
            throw selectError;
        }

        if (!signals || signals.length === 0) {
            return res.status(200).json({
                ok: true,
                checked: 0,
                results: [],
                message: "Tidak ada signal PENDING yang perlu settlement."
            });
        }

        const results = [];

        for (const signal of signals) {
            try {
                const entryTime = new Date(signal.entry_time);
                const expiryTime = new Date(signal.expiry_time);

                // Pastikan expiry benar-benar sudah lewat
                if (now.getTime() < expiryTime.getTime()) {
                    results.push({
                        id: signal.id,
                        status: "WAITING_EXPIRY"
                    });
                    continue;
                }

                const candles = await getCandles(signal.asset);

                if (!candles.length) {
                    results.push({
                        id: signal.id,
                        status: "NO_CANDLES"
                    });
                    continue;
                }

                /*
                 * Candle ENTRY
                 *
                 * Contoh:
                 * Entry 22:46
                 *
                 * candle 22:46:
                 * open  = harga OPEN sebenarnya
                 * close = harga penutupan candle entry
                 */
                const entryCandle = findCandle(
                    candles,
                    entryTime
                );

                if (!entryCandle) {
                    results.push({
                        id: signal.id,
                        status: "ENTRY_CANDLE_NOT_FOUND",
                        entryTime: signal.entry_time
                    });
                    continue;
                }

                /*
                 * Candle EXPIRY
                 *
                 * Contoh:
                 * Expiry 22:47
                 *
                 * candle 22:46 adalah candle
                 * yang berakhir pada 22:47.
                 *
                 * Jadi expiry price = CLOSE candle entry.
                 */
                const expiryCandle = findCandle(
                    candles,
                    expiryTime
                );

                /*
                 * Karena data candle menggunakan waktu OPEN,
                 * candle expiry adalah candle yang dibuka
                 * pada expiryTime.
                 *
                 * Untuk binary 22:46 -> 22:47,
                 * harga expiry adalah CLOSE candle 22:46.
                 */
                let finalCandle = entryCandle;

                const entryCandleCloseTime =
                    new Date(
                        entryCandle.time.getTime() +
                        60 * 1000
                    );

                if (
                    entryCandleCloseTime.getTime() >
                    now.getTime()
                ) {
                    results.push({
                        id: signal.id,
                        status: "ENTRY_CANDLE_NOT_CLOSED",
                        entryTime: signal.entry_time
                    });
                    continue;
                }

                /*
                 * HARGA ENTRY YANG BARU
                 *
                 * Gunakan OPEN candle entry.
                 */
                const actualEntryPrice =
                    Number(entryCandle.open);

                /*
                 * HARGA EXPIRY
                 *
                 * Gunakan CLOSE candle entry.
                 */
                const actualExpiryPrice =
                    Number(entryCandle.close);

                if (
                    !Number.isFinite(actualEntryPrice) ||
                    !Number.isFinite(actualExpiryPrice)
                ) {
                    results.push({
                        id: signal.id,
                        status: "INVALID_PRICE"
                    });
                    continue;
                }

                let result = "DRAW";

                if (signal.direction === "CALL") {
                    if (actualExpiryPrice > actualEntryPrice) {
                        result = "WIN";
                    } else if (
                        actualExpiryPrice < actualEntryPrice
                    ) {
                        result = "LOSS";
                    }
                } else if (signal.direction === "PUT") {
                    if (actualExpiryPrice < actualEntryPrice) {
                        result = "WIN";
                    } else if (
                        actualExpiryPrice > actualEntryPrice
                    ) {
                        result = "LOSS";
                    }
                }

                /*
                 * UPDATE DATABASE
                 *
                 * Penting:
                 * entry_price sekarang diganti menjadi
                 * OPEN candle entry yang sebenarnya.
                 */
                const { data: updated, error: updateError } =
                    await supabase
                        .from("signals")
                        .update({
                            entry_price: actualEntryPrice,
                            result_price: actualExpiryPrice,
                            result,
                            result_time: expiryTime.toISOString(),
                            settled_at: new Date().toISOString()
                        })
                        .eq("id", signal.id)
                        .eq("result", "PENDING")
                        .select()
                        .single();

                if (updateError) {
                    throw updateError;
                }

                /*
                 * Telegram menggunakan data yang
                 * sudah diperbaiki.
                 */
                await sendTelegram(
                    resultMessage(updated)
                );

                results.push({
                    id: signal.id,
                    asset: signal.asset,
                    direction: signal.direction,
                    status: "SETTLED",
                    entryPrice: actualEntryPrice,
                    expiryPrice: actualExpiryPrice,
                    result
                });

            } catch (error) {
                results.push({
                    id: signal.id,
                    status: "ERROR",
                    error: error.message
                });
            }
        }

        return res.status(200).json({
            ok: true,
            timeframe: TIMEFRAME,
            expirationMinutes: EXPIRATION_MINUTES,
            checked: signals.length,
            results
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            ok: false,
            error: error.message
        });
    }
}
