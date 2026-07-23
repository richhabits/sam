// ─────────────────────────────────────────────────────────────
//  SAM Cloud gateway — OPTIONAL hosted free-tier brain.
//
//  A tiny Cloudflare Worker that lets new SAM installs get instant cloud AI through pooled keys that
//  the operator holds — WITHOUT shipping any key in the app. It enforces hard cost controls:
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
  PER_IP_DAILY?: string;             // per-source-IP daily cap — the abuse backstop device-id can't rotate past, default 200
  GLOBAL_DAILY?: string;             // default 20000
  SPEND_CEILING_CALLS?: string;      // hard global kill-switch (cumulative), default 500000
  MAX_INPUT_CHARS?: string;          // reject prompts larger than this (token-cost bound), default 24000
  PAUSED?: string;                   // INSTANT kill-switch: set "1" to pause everything now (no redeploy)
  ALLOW_ORIGIN?: string;             // CORS, default *
  QUOTA_DO?: DurableObjectNamespace; // OPTIONAL (Workers Paid): atomic check-and-reserve caps. Bound → used; unbound → KV path.
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

// ── ATOMIC QUOTA (audit finding 1) ────────────────────────────────────────────
// KV get-then-put is not atomic, so a concurrent burst can race every daily/global/spend cap
// (finding 1/10). A Durable Object is a SINGLE-threaded, consistent actor: routing every
// check-and-reserve through one instance serialises them, so two requests can NEVER both pass
// when one slot remains. Day-scoped counters live under bare keys and are wiped on rollover;
// `total` (the cumulative spend ceiling) never resets. blockConcurrencyWhile makes the
// read→check→reserve one indivisible step. OPTIONAL: a Workers Paid feature — when no DO is
// bound the Worker falls back to the KV path (bounded by the per-IP cap), so free-plan deploys
// keep working unchanged.
interface Caps { perDevice: number; perIp: number; globalDaily: number; spendCeiling: number }

export class QuotaCounter {
  constructor(private state: DurableObjectState) {}
  async fetch(req: Request): Promise<Response> {
    const { action, device, ip, day, caps } = await req.json() as { action: string; device: string; ip?: string; day: string; caps?: Caps };
    return await this.state.blockConcurrencyWhile(async () => {
      const s = this.state.storage;
      const get = async (k: string) => (await s.get<number>(k)) ?? 0;
      // Keys are DAY-SCOPED, so a new day is implicitly fresh (correctness never depends on a reset
      // completing). `total` is cumulative and never resets. Old-day keys are purged best-effort on
      // rollover; leftovers can't affect today's checks because today reads today's keys.
      const gKey = `g:${day}`, dKey = `d:${device}:${day}`, iKey = ip ? `ip:${ip}:${day}` : "";

      if ((await s.get<string>("day")) !== day) {
        const stale = [...(await s.list<number>())].map(([k]) => k).filter((k) => k !== "total" && k !== "day" && !k.endsWith(`:${day}`));
        if (stale.length) await s.delete(stale.slice(0, 128));   // bounded; further rollovers finish it
        await s.put("day", day);
      }

      if (action === "peek") {
        return Response.json({ used: await get(dKey), ipUsed: iKey ? await get(iKey) : 0, global: await get(gKey), total: await get("total") });
      }
      if (action === "refund") {   // undo a reservation whose upstream call failed
        for (const k of ["total", gKey, dKey, iKey].filter(Boolean)) { const v = await get(k); if (v > 0) await s.put(k, v - 1); }
        return Response.json({ ok: true });
      }

      // action === "reserve": check every cap, and ONLY if all pass, reserve a slot in each.
      const c = caps!;
      const total = await get("total"), g = await get(gKey), d = await get(dKey), i = iKey ? await get(iKey) : 0;
      if (total >= c.spendCeiling) return Response.json({ ok: false, code: 503, error: "gateway temporarily at capacity — add your own free key to keep going" });
      if (d >= c.perDevice) return Response.json({ ok: false, code: 429, error: "daily free allowance used up — resets tomorrow, or add your own free key for unlimited" });
      if (iKey && i >= c.perIp) return Response.json({ ok: false, code: 429, error: "too many requests from this network today — add your own free key to keep going" });
      if (g >= c.globalDaily) return Response.json({ ok: false, code: 503, error: "gateway busy today — add your own free key to keep going" });
      await s.put("total", total + 1); await s.put(gKey, g + 1); await s.put(dKey, d + 1);
      if (iKey) await s.put(iKey, i + 1);
      return Response.json({ ok: true, n: g + 1 });   // n = new global count → key rotation seed
    });
  }
}

const quotaStub = (env: Env) => env.QUOTA_DO!.get(env.QUOTA_DO!.idFromName("quota"));
async function doQuota(env: Env, action: string, args: Record<string, unknown>): Promise<any> {
  const r = await quotaStub(env).fetch("https://quota/", { method: "POST", body: JSON.stringify({ action, ...args }) });
  return await r.json();
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
      const used = env.QUOTA_DO
        ? Number((await doQuota(env, "peek", { device, day })).used) || 0   // authoritative in DO mode
        : num((await env.QUOTA.get(`d:${device}:${day}`)) ?? undefined, 0);
      return json({ used, limit: perDevice, remaining: Math.max(0, perDevice - used), resetsDaily: true }, 200, origin);
    }

    if (url.pathname === "/v1/chat" && req.method === "POST") {
      const now = Date.now();
      const day = today(now);
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, origin); }
      const device = String(body.device || "").trim();
      if (!device || device.length < 8) return json({ error: "valid device id required" }, 400, origin);

      // AUDIT FIX (finding 2): `device` is fully client-supplied, so an attacker rotates it for
      // unlimited per-device allowance and to evade the block-list. The real abuse boundary is the
      // SOURCE IP (from Cloudflare's trusted cf-connecting-ip header), which the client cannot mint
      // at will — enforce a per-IP daily cap and key the block-list on IP as well as device.
      const ip = req.headers.get("cf-connecting-ip") || "";
      if (ip && await env.QUOTA.get(`block:ip:${ip}`)) return json({ error: "blocked" }, 403, origin);

      // Abuse blocklist (device + IP)
      if (await env.QUOTA.get(`block:${device}`)) return json({ error: "device blocked" }, 403, origin);

      // AUDIT FIX (finding 3): bound INPUT size. Every cap here counts CALLS, but provider cost is
      // per TOKEN and body.messages was forwarded unbounded — so a few huge-prompt calls blow past
      // the spend estimate. Reject an oversized prompt before it reaches a pooled key.
      const inputChars = JSON.stringify(body.messages ?? "").length;
      if (inputChars > num(env.MAX_INPUT_CHARS, 24000)) return json({ error: "prompt too large for the free gateway — add your own key for longer prompts" }, 413, origin);

      // Model whitelist — cheap models only, no matter what the client asks for.
      const whitelist = (env.MODEL_WHITELIST || "").split(",").map((s) => s.trim()).filter(Boolean);
      const model = String(body.model || whitelist[0] || "").trim();
      if (!whitelist.includes(model)) return json({ error: "model not allowed", allowed: whitelist }, 400, origin);

      const caps = { perDevice: num(env.PER_DEVICE_DAILY, 50), perIp: num(env.PER_IP_DAILY, 200), globalDaily: num(env.GLOBAL_DAILY, 20000), spendCeiling: num(env.SPEND_CEILING_CALLS, 500000) };
      const keys = (env.PROVIDER_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!keys.length) return json({ error: "gateway not configured" }, 500, origin);

      // THE QUOTA DECISION. With a Durable Object bound, this is an ATOMIC check-and-reserve — the
      // slot is taken BEFORE the upstream call, so a concurrent burst can never overspend a cap
      // (finding 1). Without one, the KV path reads the counters (non-atomic; the per-IP cap bounds
      // the race) and bumps AFTER a successful call. Same caps, same messages, either backend.
      const useDO = !!env.QUOTA_DO;
      let rotation: number;
      if (useDO) {
        const r = await doQuota(env, "reserve", { device, ip, day, caps });
        if (!r.ok) return json({ error: r.error }, r.code, origin);   // reservation denied → cap hit, nothing forwarded
        rotation = Number(r.n) || 0;
      } else {
        const totalCalls = num((await env.QUOTA.get("total:calls")) ?? undefined, 0);
        if (totalCalls >= caps.spendCeiling) return json({ error: "gateway temporarily at capacity — add your own free key to keep going" }, 503, origin);
        const dUsed = num((await env.QUOTA.get(`d:${device}:${day}`)) ?? undefined, 0);
        if (dUsed >= caps.perDevice) return json({ error: "daily free allowance used up — resets tomorrow, or add your own free key for unlimited", quota: { used: dUsed, limit: caps.perDevice } }, 429, origin);
        const ipUsed = ip ? num((await env.QUOTA.get(`ip:${ip}:${day}`)) ?? undefined, 0) : 0;
        if (ip && ipUsed >= caps.perIp) return json({ error: "too many requests from this network today — add your own free key to keep going" }, 429, origin);
        const gUsed = num((await env.QUOTA.get(`g:${day}`)) ?? undefined, 0);
        if (gUsed >= caps.globalDaily) return json({ error: "gateway busy today — add your own free key to keep going" }, 503, origin);
        rotation = dUsed + gUsed;
      }

      // Rotate a pooled key + forward to the upstream (OpenAI-compatible).
      const key = keys[Math.abs(rotation) % keys.length];

      let upstream: Response;
      try {
        upstream = await fetch(`${env.UPSTREAM_URL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          // AUDIT FIX (finding 12): clamp max_tokens on BOTH ends — a negative/NaN value used to be
          // forwarded unclamped (min(NaN,2048)=NaN), which some providers reject or mishandle.
          body: JSON.stringify({ model, messages: body.messages, stream: !!body.stream, max_tokens: Math.max(1, Math.min(num(body.max_tokens, 1024), 2048)), temperature: body.temperature ?? 0.7 }),
        });
      } catch {
        // Never reached upstream. In DO mode the slot was already reserved → give it back.
        if (useDO) await doQuota(env, "refund", { device, ip, day });
        return json({ error: "upstream unreachable" }, 502, origin);
      }

      // Count only SUCCESSFUL calls. DO mode already reserved the slot atomically before forwarding,
      // so here it only REFUNDS a failed call; the KV path bumps after success (non-atomic — the
      // per-IP cap bounds the race; true atomicity is the DO path above). Either way, a failed
      // upstream never costs the caller a slot.
      if (useDO) {
        if (!upstream.ok) await doQuota(env, "refund", { device, ip, day });
      } else if (upstream.ok) {
        await Promise.all([
          bump(env.QUOTA, `d:${device}:${day}`), bump(env.QUOTA, `g:${day}`),
          ...(ip ? [bump(env.QUOTA, `ip:${ip}:${day}`)] : []),
          bump(env.QUOTA, "total:calls", 60 * 60 * 24 * 365),
        ]);
      }
      // AUDIT FIX (finding 9): do NOT forward upstream response headers verbatim — that could leak
      // provider set-cookie / rate-limit / internal headers (or a mis-set auth echo) to any caller.
      // Build a clean header set: content-type (so streaming/json is parsed) + our CORS only.
      const headers = new Headers();
      const ct = upstream.headers.get("content-type"); if (ct) headers.set("content-type", ct);
      headers.set("access-control-allow-origin", origin);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return json({ error: "not found" }, 404, origin);
  },
};
