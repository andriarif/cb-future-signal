// api/time-test.js

export const runtime = "edge";

const TIMEZONE = "Asia/Jakarta";
const TIMEFRAME = 5; // M5
const EXPIRATION = 5; // 5 menit


function formatWIB(date) {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}


// hitung candle M5 berikutnya
function nextCandle(time) {

  const d = new Date(time);

  const minute = d.getMinutes();

  const next =
    Math.ceil((minute + 1) / TIMEFRAME) * TIMEFRAME;

  d.setMinutes(next);
  d.setSeconds(0);
  d.setMilliseconds(0);

  return d;
}


function addMinutes(date, min) {

  return new Date(
    date.getTime() + min * 60000
  );

}


export async function GET() {

  const now = new Date();

  const entry = nextCandle(now);

  const expiry = addMinutes(
    entry,
    EXPIRATION
  );


  return Response.json({

    ok: true,

    timezone: TIMEZONE,

    timeframe: "M5",

    expirationMinutes: EXPIRATION,


    botTimeUTC:
      now.toISOString(),


    botTimeWIB:
      formatWIB(now),


    nextEntryUTC:
      entry.toISOString(),


    nextEntryWIB:
      formatWIB(entry),


    expiryUTC:
      expiry.toISOString(),


    expiryWIB:
      formatWIB(expiry),


    rule:
      "Signal keluar sebelum Entry. Entry pada candle M5 berikutnya. Expiry +5 menit."

  });

}
