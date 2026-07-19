// ─────────────────────────────────────────────────────────────
//  S.A.M. · TELEMETRY  (v2.0 — OFF by default, opt-in, anonymous, aggregate)
//
//  The ONLY way the maker ever learns real user count + retention — and it is sacred that it never
//  betrays the privacy promise. Rules, enforced here and tested:
//    • OFF by default. Nothing is sent unless the user explicitly opts in (neutral first-run choice).
//    • ANONYMOUS: a random per-install id, no account, no personal data.
//    • AGGREGATE + WHITELISTED: only the fields in ALLOWED below can ever be transmitted. Content —
//      prompts, messages, file names, paths, tool inputs, anything a person typed — CANNOT be in a
//      payload. buildPayload constructs a fixed shape from a whitelist; it never copies arbitrary input.
//  What exactly is/ isn't sent is documented in docs/PRIVACY.md. See telemetry.test.ts for the guards.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Analytics } from "./analytics.ts";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "telemetry.json");

// THE WHITELIST — the complete, closed set of keys that may ever leave the device. Anything not here is
// impossible to send. Deliberately contains zero free-text and nothing identifying.
export const ALLOWED_FIELDS = ["schema", "anonId", "version", "os", "dau", "retentionBucket", "activated", "crashFree", "features"] as const;
// Feature counters are themselves whitelisted to fixed names (no user-supplied strings).
export const ALLOWED_FEATURES = ["tasks", "toolUses", "workflowRuns", "cacheHits"] as const;

interface TelemetryState { enabled: boolean; anonId: string; decidedAt?: string }

function read(): TelemetryState {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")); } catch { /* ignore */ }
  return { enabled: false, anonId: "" };   // OFF by default
}
function write(s: TelemetryState) { try { mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(s, null, 2)); } catch { /* best-effort */ } }

export function telemetryEnabled(): boolean { return read().enabled === true; }
export function telemetryDecided(): boolean { return !!read().decidedAt; }

// The user's explicit, neutral choice. `on=false` is a first-class outcome, not "not yet decided".
export function setTelemetry(on: boolean, at: string): void {
  const s = read();
  s.enabled = !!on;
  s.decidedAt = at;
  if (on && !s.anonId) s.anonId = randomBytes(16).toString("hex");   // anonymous id minted only on opt-in
  if (!on) s.anonId = "";                                             // opting out discards the id
  write(s);
}

function retentionBucket(days: number): string {
  if (days <= 1) return "d1"; if (days <= 7) return "d7"; if (days <= 30) return "d30"; return "d30+";
}

// Build the ONE payload that may be sent. It reads a FIXED set of aggregate numbers from local analytics
// and emits only ALLOWED_FIELDS. It never copies arbitrary input — so content cannot appear even if a
// caller passed a poisoned analytics object. Returns null when telemetry is off (⇒ nothing to send).
export function buildPayload(a: Analytics, version: string, os: string, now: string): Record<string, unknown> | null {
  const s = read();
  if (!s.enabled) return null;
  const retentionDays = a.firstSeen ? Math.round((new Date(now).getTime() - new Date(a.firstSeen + "T00:00:00Z").getTime()) / 86_400_000) + 1 : 0;
  return {
    schema: "sam-telemetry/1",
    anonId: s.anonId,
    version: String(version).slice(0, 20),
    os: String(os).slice(0, 20),
    dau: a.lastSeen.slice(0, 10) === now.slice(0, 10),
    retentionBucket: retentionBucket(retentionDays),
    activated: !!a.activatedAt,
    crashFree: (a.crashes || 0) === 0,
    // feature COUNTS only, under fixed keys — never a user-supplied tool/workflow name or input
    features: { tasks: a.tasks | 0, toolUses: Object.values(a.toolUses).reduce((x, n) => x + n, 0) | 0, workflowRuns: a.workflowRuns | 0, cacheHits: a.cacheHits | 0 },
  };
}

// Defence-in-depth: a payload is only sendable if EVERY top-level key is in the whitelist. Any stray key
// ⇒ refuse to send. (buildPayload can't produce one, but if the shape ever drifts, this catches it.)
export function isSendable(payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload);
  if (!keys.every((k) => (ALLOWED_FIELDS as readonly string[]).includes(k))) return false;
  const f = payload.features;
  if (f && typeof f === "object") {
    if (!Object.keys(f).every((k) => (ALLOWED_FEATURES as readonly string[]).includes(k))) return false;
  }
  return true;
}

// The reasons a send didn't happen are first-class, never a silent swallow (Doctrine: no silent failures).
export type SendResult = "sent" | "off" | "no-endpoint" | "blocked" | "failed";

// The ONE place data may leave the device. It sends ONLY when BOTH gates are open:
//   1. the user opted in            → buildPayload returns non-null
//   2. the maker set an endpoint     → TELEMETRY_ENDPOINT is configured (unset ⇒ "no-endpoint", the
//      default, so a shipped-but-undeployed build phones home NOTHING).
// isSendable is a third, defence-in-depth gate: a drifted shape is refused rather than sent. The endpoint
// is MAKER config (an env var we set at build/deploy), never user- or content-supplied — so this is not
// an SSRF surface. Returns a typed reason; the caller logs it, never assumes success.
export async function postTelemetry(
  a: Analytics, version: string, os: string, now: string,
  endpoint: string | undefined = process.env.TELEMETRY_ENDPOINT,
): Promise<SendResult> {
  if (!endpoint) return "no-endpoint";                 // no URL ⇒ inert; nothing ever leaves
  const payload = buildPayload(a, version, os, now);
  if (!payload) return "off";                           // telemetry disabled ⇒ null ⇒ nothing to send
  if (!isSendable(payload)) return "blocked";           // shape drifted ⇒ refuse (never send a stray key)
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok ? "sent" : "failed";
  } catch { return "failed"; }
}
