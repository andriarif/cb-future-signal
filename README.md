# CB Future Signal — Vercel + Supabase

Architecture:

Vercel Cron (every minute) -> candle M1 -> signal engine ->
Supabase -> Telegram.

## Important Vercel plan note

Vercel's current documentation indicates per-minute Cron precision is available on Pro/Enterprise; Hobby has once-per-day scheduling with hourly precision. Therefore this project is designed for Vercel Pro/Enterprise if you need true M1 scanning every minute.

## Signal logic

M1:
- EMA 50 / EMA 200 trend
- RSI 14 recovery/rejection
- Bollinger Bands 20 / 2
- nearest recent Support / Resistance
- bullish/bearish Pin Bar
- bullish/bearish Engulfing
- 3-candle momentum flow
- minimum score 4/5 by default

Only the latest closed candle is evaluated. Entry time is the next M1 minute.

## Deploy from phone

1. Create a GitHub repository.
2. Upload this project.
3. Create a Supabase project.
4. Open Supabase SQL Editor and run `supabase/schema.sql`.
5. Copy Supabase Project URL and Service Role key.
6. Import the GitHub repository into Vercel.
7. Add Environment Variables from `.env.example`.
8. Deploy.
9. Vercel registers `/api/scan` as the Cron endpoint.
10. Test manually with:
   `https://YOUR-DOMAIN.vercel.app/api/scan?secret=YOUR_CRON_SECRET`

Never publish Telegram token, Supabase service-role key, or API credentials in GitHub.

## API adapter

The default adapter expects:
GET /api/pocketoption/candles?pair=...&timeframe=1m&limit=250

and a JSON array or `{ "candles": [...] }` with:
time, open, high, low, close.

If your CB Traders BD endpoint uses different parameter names/response fields, only `api/scan.js` and `signal-engine.js` need adjustment.

## Telegram

The bot sends a new message only when a new asset/candle produces a signal and the same signal key is not already in Supabase.

## Win-rate settlement

V1/V2 intentionally stores PENDING. A separate settlement job should fetch the result after the requested expiry and update PENDING -> WIN/LOSS. Do not label a signal WIN merely because the signal was generated.

## Safety

This is a rule-based signal generator, not a guarantee. Test on demo data and collect a meaningful sample before considering live use.
