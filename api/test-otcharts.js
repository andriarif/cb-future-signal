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

export async function GET() {
  const key = process.env.OTCHARTS_API_KEY;

  if (!key) {
    return json({
      ok: false,
      step: "environment",
      error: "OTCHARTS_API_KEY belum terbaca oleh Vercel"
    }, 500);
  }

  const url = new URL(
    "https://otcharts.com/v1/candles"
  );

  url.searchParams.set(
    "venue",
    "otc"
  );

  url.searchParams.set(
    "symbol",
    "USDJPY_otc"
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

    return json({

      ok: response.ok,

      status:
        response.status,

      statusText:
        response.statusText,

      url:
        url.toString(),

      response:
        text

    });

  } catch (error) {

    return json({

      ok: false,

      step: "fetch",

      error: {
        name: error?.name || null,
        message: error?.message || null,

        cause: error?.cause
          ? {
              name:
                error.cause.name || null,

              code:
                error.cause.code || null,

              message:
                error.cause.message || null
            }
          : null
      }

    }, 500);
  }
}
