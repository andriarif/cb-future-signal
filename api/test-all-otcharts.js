function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json"
      }
    }
  );
}

async function testSymbol(key, symbol) {

  const url = new URL(
    "https://otcharts.com/v1/candles"
  );

  url.searchParams.set(
    "venue",
    "otc"
  );

  url.searchParams.set(
    "symbol",
    symbol
  );

  url.searchParams.set(
    "tf",
    "60"
  );

  url.searchParams.set(
    "limit",
    "5"
  );

  try {

    const response = await fetch(
      url,
      {
        method: "GET",

        headers: {
          "accept": "application/json",
          "authorization": `Bearer ${key}`
        },

        cache: "no-store"
      }
    );

    const text =
      await response.text();

    return {
      symbol,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      response: text
    };

  } catch (error) {

    return {
      symbol,
      ok: false,
      status: null,
      error: {
        name: error?.name || null,
        message: error?.message || null,
        cause: error?.cause
          ? {
              name: error.cause.name || null,
              code: error.cause.code || null,
              message: error.cause.message || null
            }
          : null
      }
    };
  }
}

export async function GET() {

  const key =
    process.env.OTCHARTS_API_KEY;

  if (!key) {

    return json({
      ok: false,
      error:
        "OTCHARTS_API_KEY belum terbaca."
    }, 500);
  }

  const symbols = [
    "EURUSD_otc",
    "GBPUSD_otc",
    "USDJPY_otc"
  ];

  const results = [];

  for (const symbol of symbols) {

    results.push(
      await testSymbol(
        key,
        symbol
      )
    );
  }

  return json({
    ok: true,
    tested: symbols,
    results
  });
}
