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

// AUDIT FIX (5, 16): validate every VALUE, not just the key NAMES. The old check only confirmed
// keys were on the whitelist, so os/version/retentionBucket could carry arbitrary free text (PII),
// and feature counts passed as long as they were `typeof number` (NaN/Infinity/negative/huge all
// through). Each field now has a strict type/format/bound — nothing free-text can be persisted.
const RETENTION_BUCKETS = ["d1", "d7", "d30", "d30+"];
const isCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e9;   // finite, bounded

function whitelisted(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  if (!Object.keys(p).every((k) => ALLOWED_FIELDS.includes(k))) return false;

  // required, fixed-shape identity fields
  if (p.schema !== "sam-telemetry/1") return false;
  if (typeof p.anonId !== "string" || !/^[0-9a-f]{32}$/.test(p.anonId)) return false;   // anonymous id shape

  // every OPTIONAL field, if present, must match its exact expected shape — no free text survives
  if (p.version !== undefined && (typeof p.version !== "string" || !/^[\w.+-]{1,20}$/.test(p.version))) return false;
  if (p.os !== undefined && (typeof p.os !== "string" || !/^[a-z0-9]{1,20}$/.test(p.os))) return false;   // process.platform shape
  if (p.retentionBucket !== undefined && !RETENTION_BUCKETS.includes(p.retentionBucket)) return false;
  if (p.dau !== undefined && typeof p.dau !== "boolean") return false;
  if (p.activated !== undefined && typeof p.activated !== "boolean") return false;
  if (p.crashFree !== undefined && typeof p.crashFree !== "boolean") return false;

  if (p.features !== undefined) {
    const f = p.features;
    if (!f || typeof f !== "object" || Array.isArray(f)) return false;
    if (!Object.keys(f).every((k) => ALLOWED_FEATURES.includes(k))) return false;
    if (!Object.values(f).every(isCount)) return false;   // finite, non-negative, bounded counts only
  }
  return true;
}

// AUDIT FIX (15): read the body with a HARD byte cap. The content-length header can lie or be
// absent, and request.text() buffers the WHOLE body before any length check — so a chunked/oversized
// POST could exhaust memory. Stream and abort the moment the cap is crossed.
async function readCapped(request, maxBytes) {
  if (!request.body) { const t = await request.text(); return t.length <= maxBytes ? t : null; }
  const reader = request.body.getReader();
  const dec = new TextDecoder();
  let out = "", total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch { /* closing */ } return null; }
    out += dec.decode(value, { stream: true });
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("telemetry sink", { status: 405 });

    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BODY) return new Response(null, { status: 413 });

    let payload;
    try {
      const text = await readCapped(request, MAX_BODY);   // hard cap regardless of content-length
      if (text === null) return new Response(null, { status: 413 });
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
