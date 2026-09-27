// api/telegram.js
// CB Future Signal
// TELEGRAM START / STOP / STATUS / HELP

import { createClient } from "@supabase/supabase-js";


// ======================================================
// SUPABASE
// ======================================================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);


// ======================================================
// TELEGRAM
// ======================================================

async function sendTelegram(chatId, text) {

    const token =
        process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {

        throw new Error(
            "TELEGRAM_BOT_TOKEN belum tersedia"
        );

    }

    const url =
        `https://api.telegram.org/bot${token}/sendMessage`;

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

                        text:
                            text

                    })
            }
        );

    if (!response.ok) {

        const errorText =
            await response.text();

        throw new Error(
            `Telegram Error: ${errorText}`
        );

    }

}


// ======================================================
// GET BOT STATUS
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

    return data?.is_active === true;

}


// ======================================================
// SET BOT STATUS
// ======================================================

async function setBotStatus(active) {

    const {
        error
    } = await supabase
        .from("bot_control")
        .upsert(
            {
                id: 1,

                is_active:
                    active,

                updated_at:
                    new Date().toISOString()
            },
            {
                onConflict: "id"
            }
        );

    if (error) {

        throw error;

    }

}


// ======================================================
// MAIN HANDLER
// ======================================================

export default async function handler(req, res) {

    try {

        // ==================================================
        // ONLY POST
        // ==================================================

        if (req.method !== "POST") {

            return res
                .status(200)
                .json({

                    ok: true,

                    message:
                        "CB Future Signal Telegram Webhook Aktif"

                });

        }


        // ==================================================
        // GET TELEGRAM MESSAGE
        // ==================================================

        const message =
            req.body?.message;

        if (!message) {

            return res
                .status(200)
                .json({

                    ok: true,

                    message:
                        "No message"

                });

        }


        const chatId =
            String(
                message.chat?.id || ""
            );


        const text =
            String(
                message.text || ""
            )
            .trim()
            .toLowerCase();


        if (!chatId) {

            return res
                .status(200)
                .json({

                    ok: true,

                    message:
                        "No chat ID"

                });

        }


        // ==================================================
        // /START
        // ==================================================

        if (
            text === "/start" ||
            text.startsWith("/start@")
        ) {

            await setBotStatus(true);


            await sendTelegram(
                chatId,

`🟢 CB FUTURE SIGNAL AKTIF

Robot sekarang sudah START.

📊 STRATEGI

EMA9 > EMA21 + MACD+ = BUY

EMA9 < EMA21 + MACD- = SELL

⏱ Timeframe: M1
⌛ Expiry: 1 Minute

🤖 Robot siap memberikan sinyal.

Gunakan /stop untuk menghentikan.
Gunakan /status untuk cek status.`
            );


            return res
                .status(200)
                .json({

                    ok: true,

                    status:
                        "STARTED"

                });

        }


        // ==================================================
        // /STOP
        // ==================================================

        if (
            text === "/stop" ||
            text.startsWith("/stop@")
        ) {

            await setBotStatus(false);


            await sendTelegram(
                chatId,

`🔴 CB FUTURE SIGNAL STOP

Robot sekarang dihentikan.

❌ Tidak akan mengirim sinyal baru.

Gunakan /start untuk mengaktifkan kembali.`
            );


            return res
                .status(200)
                .json({

                    ok: true,

                    status:
                        "STOPPED"

                });

        }


        // ==================================================
        // /STATUS
        // ==================================================

        if (
            text === "/status" ||
            text.startsWith("/status@")
        ) {

            const active =
                await getBotStatus();


            if (active) {

                await sendTelegram(
                    chatId,

`🟢 STATUS BOT

CB Future Signal: AKTIF

📊 Strategi:
EMA9 > EMA21 + MACD+ = BUY
EMA9 < EMA21 + MACD- = SELL

⏱ M1
⌛ Expiry 1 Minute

🤖 Menunggu sinyal berikutnya.`
                );

            }
            else {

                await sendTelegram(
                    chatId,

`🔴 STATUS BOT

CB Future Signal: STOP

Robot tidak mengirim sinyal.

Kirim /start untuk mengaktifkan.`
                );

            }


            return res
                .status(200)
                .json({

                    ok: true,

                    status:
                        active
                            ? "ACTIVE"
                            : "STOPPED"

                });

        }


        // ==================================================
        // /HELP
        // ==================================================

        if (
            text === "/help"
        ) {

            await sendTelegram(
                chatId,

`🤖 CB FUTURE SIGNAL

PERINTAH BOT

/start
▶️ Aktifkan robot

/stop
⏹ Hentikan robot

/status
📊 Cek status robot

/help
ℹ️ Bantuan

📊 STRATEGI

EMA9 > EMA21 + MACD+ = BUY

EMA9 < EMA21 + MACD- = SELL

⏱ Timeframe M1
⌛ Expiry 1 Minute`
            );


            return res
                .status(200)
                .json({

                    ok: true,

                    status:
                        "HELP"

                });

        }


        // ==================================================
        // UNKNOWN COMMAND
        // ==================================================

        await sendTelegram(
            chatId,

`🤖 CB FUTURE SIGNAL

Perintah tidak dikenal.

Gunakan:

/start
/stop
/status
/help`
        );


        return res
            .status(200)
            .json({

                ok: true,

                status:
                    "UNKNOWN_COMMAND"

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
