// ─────────────────────────────────────────────────────────────
//  S.A.M. · TELEMETRY SINK  — the receiving end of the opt-in aggregate heartbeat.
//
//  Committed but NOT deployed (see README). It exists so the send-path in server/telemetry.ts has a real,
//  reviewable counterpart, and so deploying is one `wrangler deploy` away — not a from-scratch build.
//
//  It re-validates the SAME whitelist the client enforces (server/telemetry.ts · ALLOWED_FIELDS /
//  ALLOWED_FEATURES). Defence-in-depth: even a hand-crafted POST cannot store a field outside the closed
//  set, so content (prompts, paths, tool names, anything typed) is impossible to persist here. No field is
//  free text; nothing identifies a person. Stores one aggregate record per anon-id per day, TTL-bounded.
// ─────────────────────────────────────────────────────────────

const ALLOWED_FIELDS = ["schema", "anonId", "version", "os", "dau", "retentionBucket", "activated", "crashFree", "features"];
const ALLOWED_FEATURES = ["tasks", "toolUses", "workflowRuns", "cacheHits"];
const MAX_BODY = 2048;              // a valid payload is a few hundred bytes; anything larger is refused
const RETAIN_DAYS = 90;

function whitelisted(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  if (!Object.keys(p).every((k) => ALLOWED_FIELDS.includes(k))) return false;
  if (p.features !== undefined) {
    const f = p.features;
    if (!f || typeof f !== "object" || Array.isArray(f)) return false;
    if (!Object.keys(f).every((k) => ALLOWED_FEATURES.includes(k))) return false;
    if (!Object.values(f).every((v) => typeof v === "number")) return false;   // counts only, never a name
  }
  if (typeof p.anonId !== "string" || !/^[0-9a-f]{32}$/.test(p.anonId)) return false;   // anonymous id shape
  if (p.schema !== "sam-telemetry/1") return false;
  return true;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("telemetry sink", { status: 405 });

    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BODY) return new Response(null, { status: 413 });

    let payload;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return new Response(null, { status: 413 });
      payload = JSON.parse(text);
    } catch { return new Response(null, { status: 400 }); }

    if (!whitelisted(payload)) return new Response(null, { status: 400 });   // off-whitelist ⇒ refuse, store nothing

    // Persist one aggregate record per anon-id per day (last write wins), if a KV namespace is bound.
    // Undeployed / unbound ⇒ accept-and-drop, so the sink is safe to stand up before wiring storage.
    if (env?.SAM_TELEMETRY) {
      const day = new Date().toISOString().slice(0, 10);
      try { await env.SAM_TELEMETRY.put(`${day}:${payload.anonId}`, JSON.stringify(payload), { expirationTtl: RETAIN_DAYS * 86400 }); }
      catch { /* storage best-effort; never fail the client's heartbeat over it */ }
    }
    return new Response(null, { status: 204 });   // no body, no echo — nothing to leak back
  },
};
