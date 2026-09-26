// api/run.js
// CB Future Signal - RUNNER FINAL
// Hanya menjalankan /api/scan
// Tidak menjalankan settlement / WIN / LOSS

const RUN_SECRET =
  process.env.RUN_SECRET || "";

function getOrigin(req) {

  const forwardedProto =
    req.headers["x-forwarded-proto"] ||
    "https";

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  return `${forwardedProto}://${host}`;
}


async function callEndpoint(
  url,
  secret
) {

  const headers = {
    "User-Agent":
      "CB-Future-Signal-Runner"
  };

  // Kirim RUN_SECRET ke /api/scan
  if (secret) {
    headers["x-run-secret"] = secret;
  }

  const response =
    await fetch(url, {
      method: "GET",
      headers
    });

  const text =
    await response.text();

  let data;

  try {

    data = JSON.parse(text);

  } catch {

    data = {
      raw: text
    };

  }

  return {
    httpStatus:
      response.status,

    ok:
      response.ok,

    data
  };
}


export default async function handler(
  req,
  res
) {

  try {

    // ==================================================
    // CHECK RUN SECRET
    // ==================================================

    if (RUN_SECRET) {

      const suppliedSecret =
        req.headers["x-run-secret"] ||
        req.query?.secret ||
        "";

      if (
        suppliedSecret !==
        RUN_SECRET
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


    const origin =
      getOrigin(req);


    // ==================================================
    // SCAN SIGNAL ONLY
    // ==================================================

    const scan =
      await callEndpoint(
        `${origin}/api/scan`,
        RUN_SECRET
      );


    // ==================================================
    // RESULT
    // ==================================================

    return res
      .status(
        scan.ok ? 200 : 500
      )
      .json({

        ok:
          scan.ok,

        mode:
          "SIGNAL_ONLY",

        runAt:
          new Date().toISOString(),

        scan:
          scan.data

      });

  }
  catch (error) {

    return res
      .status(500)
      .json({

        ok: false,

        step:
          "RUN",

        error:
          error.message

      });
  }
}
