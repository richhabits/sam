// ─────────────────────────────────────────────────────────────
//  SAM Cloud gateway — OPTIONAL hosted free-tier brain.
//
//  A tiny Cloudflare Worker that lets new SAM installs get instant cloud AI through pooled keys that
//  the operator (the user) holds — WITHOUT shipping any key in the app. It enforces hard cost controls:
//  per-device daily quota, a global daily cap, a cheap-models-only whitelist, an abuse blocklist, and
//  an automatic shutoff at a spend ceiling. Device identity is an anonymous random ID generated at
//  install — no personal data, so the zero-telemetry promise holds.
//
//  This is BUILT but OFF by default. It only becomes a brain in SAM when the client is built with
//  SAM_GATEWAY_URL set. See docs/GATEWAY.md.
// ─────────────────────────────────────────────────────────────
export interface Env {
  QUOTA: KVNamespace;                 // per-device + global counters, daily TTL
  PROVIDER_KEYS: string;              // secret: comma-separated pooled upstream keys
  UPSTREAM_URL: string;              // e.g. https://api.groq.com/openai/v1  (OpenAI-compatible)
  MODEL_WHITELIST: string;           // comma-separated cheap models the gateway will serve
  PER_DEVICE_DAILY?: string;         // default 50
  GLOBAL_DAILY?: string;             // default 20000
  SPEND_CEILING_CALLS?: string;      // hard global kill-switch (cumulative), default 500000
  PAUSED?: string;                   // INSTANT kill-switch: set "1" to pause everything now (no redeploy)
  ALLOW_ORIGIN?: string;             // CORS, default *
}

const json = (data: unknown, status = 200, origin = "*") =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, GET, OPTIONS" } });

const today = (ts: number) => new Date(ts).toISOString().slice(0, 10);   // caller passes Date.now()
const num = (v: string | undefined, d: number) => { const n = parseInt(v || "", 10); return Number.isFinite(n) ? n : d; };

async function bump(kv: KVNamespace, key: string, ttl = 172800): Promise<number> {
  const n = num((await kv.get(key)) ?? undefined, 0) + 1;
  await kv.put(key, String(n), { expirationTtl: ttl });
  return n;
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const origin = env.ALLOW_ORIGIN || "*";
    if (req.method === "OPTIONS") return json({}, 204, origin);
    const url = new URL(req.url);

    if (url.pathname === "/health") return json({ ok: true, service: "sam-gateway", paused: env.PAUSED === "1" }, 200, origin);

    // INSTANT kill-switch — `wrangler secret put PAUSED` / dashboard var = "1" pauses everything at once,
    // no redeploy. SAM falls back to its own free lanes, so users aren't stranded.
    if (env.PAUSED === "1") return json({ error: "gateway paused — SAM is using its own free lanes" }, 503, origin);

    // Quota check — SAM shows the user their remaining daily allowance.
    if (url.pathname === "/v1/quota" && req.method === "GET") {
      const device = url.searchParams.get("device") || "";
      if (!device) return json({ error: "device required" }, 400, origin);
      const day = today(Date.now());
      const perDevice = num(env.PER_DEVICE_DAILY, 50);
      const used = num((await env.QUOTA.get(`d:${device}:${day}`)) ?? undefined, 0);
      return json({ used, limit: perDevice, remaining: Math.max(0, perDevice - used), resetsDaily: true }, 200, origin);
    }

    if (url.pathname === "/v1/chat" && req.method === "POST") {
      const now = Date.now();
      const day = today(now);
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, origin); }
      const device = String(body.device || "").trim();
      if (!device || device.length < 8) return json({ error: "valid device id required" }, 400, origin);

      // Abuse blocklist
      if (await env.QUOTA.get(`block:${device}`)) return json({ error: "device blocked" }, 403, origin);

      // Model whitelist — cheap models only, no matter what the client asks for.
      const whitelist = (env.MODEL_WHITELIST || "").split(",").map((s) => s.trim()).filter(Boolean);
      const model = String(body.model || whitelist[0] || "").trim();
      if (!whitelist.includes(model)) return json({ error: "model not allowed", allowed: whitelist }, 400, origin);

      // Hard global kill-switch (cumulative spend ceiling)
      const totalCalls = num((await env.QUOTA.get("total:calls")) ?? undefined, 0);
      if (totalCalls >= num(env.SPEND_CEILING_CALLS, 500000)) return json({ error: "gateway temporarily at capacity — add your own free key to keep going" }, 503, origin);

      // Per-device + global daily caps
      const perDevice = num(env.PER_DEVICE_DAILY, 50);
      const globalDaily = num(env.GLOBAL_DAILY, 20000);
      const dUsed = num((await env.QUOTA.get(`d:${device}:${day}`)) ?? undefined, 0);
      if (dUsed >= perDevice) return json({ error: "daily free allowance used up — resets tomorrow, or add your own free key for unlimited", quota: { used: dUsed, limit: perDevice } }, 429, origin);
      const gUsed = num((await env.QUOTA.get(`g:${day}`)) ?? undefined, 0);
      if (gUsed >= globalDaily) return json({ error: "gateway busy today — add your own free key to keep going" }, 503, origin);

      // Rotate a pooled key + forward to the upstream (OpenAI-compatible).
      const keys = (env.PROVIDER_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!keys.length) return json({ error: "gateway not configured" }, 500, origin);
      const key = keys[(dUsed + gUsed) % keys.length];

      let upstream: Response;
      try {
        upstream = await fetch(`${env.UPSTREAM_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: body.messages, stream: !!body.stream, max_tokens: Math.min(num(body.max_tokens, 1024), 2048), temperature: body.temperature ?? 0.7 }),
        });
      } catch { return json({ error: "upstream unreachable" }, 502, origin); }

      // Count the call ONLY on a successful upstream (don't burn quota on our own errors).
      if (upstream.ok) {
        await Promise.all([bump(env.QUOTA, `d:${device}:${day}`), bump(env.QUOTA, `g:${day}`), bump(env.QUOTA, "total:calls", 60 * 60 * 24 * 365)]);
      }
      // Pass the upstream response straight through (stream or json), with CORS.
      const headers = new Headers(upstream.headers);
      headers.set("access-control-allow-origin", origin);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return json({ error: "not found" }, 404, origin);
  },
};
