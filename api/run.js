const RUN_SECRET = process.env.RUN_SECRET || "";

function getOrigin(req) {
  const forwardedProto =
    req.headers["x-forwarded-proto"] || "https";

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  return `${forwardedProto}://${host}`;
}

async function callEndpoint(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "CB-Future-Signal-Runner"
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text
    };
  }

  return {
    httpStatus: response.status,
    ok: response.ok,
    data
  };
}

export default async function handler(req, res) {
  try {
    /*
     * Optional security.
     *
     * Kalau RUN_SECRET belum dibuat,
     * endpoint tetap bisa dijalankan untuk testing.
     */
    if (RUN_SECRET) {
      const suppliedSecret =
        req.headers["x-run-secret"] ||
        req.query?.secret ||
        "";

      if (suppliedSecret !== RUN_SECRET) {
        return res.status(401).json({
          ok: false,
          error: "UNAUTHORIZED"
        });
      }
    }

    const origin = getOrigin(req);

    // ==================================================
    // 1. SCAN SIGNAL
    // ==================================================

    const scan = await callEndpoint(
      `${origin}/api/scan`
    );

    // ==================================================
    // 2. SETTLEMENT
    // ==================================================

    const settle = await callEndpoint(
      `${origin}/api/settle`
    );

    // ==================================================
    // RESULT
    // ==================================================

    return res.status(200).json({
      ok: scan.ok && settle.ok,

      runAt:
        new Date().toISOString(),

      scan: scan.data,

      settle: settle.data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      step: "RUN",
      error: error.message
    });
  }
}
