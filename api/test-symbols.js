const OTCHARTS_API_KEY = process.env.OTCHARTS_API_KEY;

const TARGETS = [
  "EURUSD_otc",
  "GBPUSD_otc",
  "USDJPY_otc",
  "AUDUSD_otc",
  "EURJPY_otc"
];

export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://otcharts.com/v1/symbols?venue=otc",
      {
        headers: {
          Authorization:
            `Bearer ${OTCHARTS_API_KEY}`
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: await response.text()
      });
    }

    const data = await response.json();

    const symbols = Array.isArray(data.symbols)
      ? data.symbols
      : [];

    const available = TARGETS.map(symbol => {
      const found = symbols.find(
        x => x.symbol === symbol
      );

      return {
        symbol,
        available: Boolean(found),
        name: found?.name || null,
        payout: found?.payout ?? null
      };
    });

    return res.status(200).json({
      ok: true,
      venue: "otc",
      available
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
