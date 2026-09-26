import { createClient } from "@supabase/supabase-js";

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

  const url =
    process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;


  // ==========================================================
  // CHECK ENVIRONMENT
  // ==========================================================

  if (!url) {

    return json({
      ok: false,
      step: "CONFIG",
      error:
        "SUPABASE_URL belum terbaca."
    }, 500);
  }


  if (!key) {

    return json({
      ok: false,
      step: "CONFIG",
      error:
        "SUPABASE_SERVICE_ROLE_KEY belum terbaca."
    }, 500);
  }


  // Jangan tampilkan URL/key lengkap
  const safeUrl =
    url.replace(
      /^(.{12}).*(.{8})$/,
      "$1...$2"
    );


  // ==========================================================
  // SUPABASE CLIENT
  // ==========================================================

  const supabase =
    createClient(
      url,
      key
    );


  // ==========================================================
  // TEST QUERY
  // ==========================================================

  try {

    const result =
      await supabase
        .from("signals")
        .select("id")
        .limit(1);


    if (result.error) {

      return json({

        ok: false,

        step:
          "SUPABASE_QUERY",

        url:
          safeUrl,

        error: {
          message:
            result.error.message,

          code:
            result.error.code || null,

          details:
            result.error.details || null,

          hint:
            result.error.hint || null
        }

      }, 500);
    }


    return json({

      ok: true,

      step:
        "SUPABASE_QUERY",

      url:
        safeUrl,

      message:
        "Koneksi Supabase berhasil.",

      rows:
        result.data?.length || 0

    });


  } catch (error) {

    return json({

      ok: false,

      step:
        "SUPABASE_FETCH",

      url:
        safeUrl,

      error: {
        name:
          error?.name || null,

        message:
          error?.message || null,

        cause:
          error?.cause
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
