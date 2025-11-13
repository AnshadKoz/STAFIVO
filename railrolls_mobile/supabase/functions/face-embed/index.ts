// deno-lint-ignore-file no-explicit-any

type DenoLike = {
  serve?: (handler: (req: Request) => Response | Promise<Response>) => void;
  env?: { get(key: string): string | undefined };
};

const deno = (globalThis as typeof globalThis & { Deno?: DenoLike }).Deno;

// Optional simple auth via header
const REQUIRED_KEY = deno?.env?.get("EMBED_API_KEY") ?? "";

function to128(vec: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < 128; i++) {
    const v = vec[i % vec.length] / 255; // [0,1]
    out.push(v * 2 - 1); // [-1,1]
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const dig = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return new Uint8Array(dig);
}

const handler = async (req: Request): Promise<Response> => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
      });
    }

    // Optional header check
    if (REQUIRED_KEY) {
      const key = req.headers.get("x-embed-key") ?? "";
      if (key !== REQUIRED_KEY) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const body = (await req.json()) as { image_b64?: string };
    if (!body?.image_b64) {
      return new Response(JSON.stringify({ error: "image_b64 required" }), {
        status: 400,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const raw = body.image_b64.split(",").pop() ?? body.image_b64;
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

    // TEMP deterministic 128-D vector (not real biometrics)
    const h = await sha256(bytes);
    const embedding = to128(h);

    return new Response(JSON.stringify({ embedding, dim: 128, model: "stub-128" }), {
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 200,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "embed-failed" }), {
      status: 500,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
};

if (deno?.serve) {
  deno.serve(handler);
} else {
  throw new Error("Deno runtime with `Deno.serve` is required to run this function.");
}
