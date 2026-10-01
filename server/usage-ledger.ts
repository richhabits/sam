// ─────────────────────────────────────────────────────────────
//  S.A.M. · USAGE LEDGER — per provider, per key SLOT, what SAM has actually spent.
//
//  Fed by the Relay (server/relay.ts), the one place every outbound brain call passes through with
//  its key in hand — recordModelCall (metrics.ts) only ever sees the WINNING provider's label after
//  the cascade, never which key slot answered or how many attempts 429'd on the way, so it cannot
//  attribute usage per slot. Persisted to ${VAULT_DIR}/usage-ledger.json (atomic, 0600, small).
//
//  A slot is identified by an 8-hex-char SHA-256 prefix of the key — stable across reorderings,
//  useless for recovering the key, and never shown by any endpoint. Key VALUES are never stored.
//
//  BOUNDARY: this ledger exists to keep SAM *under* each provider's documented free limits (see
//  free-quotas.ts). It never creates accounts or keys and never works around a per-account limit.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic.ts";
import { quotaFor, quotaGroup, SKIP_AT } from "./free-quotas.ts";

export interface SlotUsage {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  rateLimited: number;   // 429s
  errors: number;        // any other failure
  day: string;           // UTC YYYY-MM-DD the day window belongs to
  dayRequests: number;
  dayTokens: number;
  minute: number;        // epoch minute the minute window belongs to
  minuteRequests: number;
  minuteTokens: number;
  lastAt: number;
}
interface ProviderUsage { slots: Record<string, SlotUsage>; recent: number[] }
interface LedgerFile { v: 1; providers: Record<string, ProviderUsage> }

const RECENT = 20;                         // outcomes kept for the success rate
const PRUNE_MS = 30 * 24 * 3600 * 1000;    // forget slots unused for 30 days (keeps the file small)

const vaultDir = () => process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
export const ledgerFile = () => join(vaultDir(), "usage-ledger.json");

let data: LedgerFile = { v: 1, providers: {} };
let loaded = false;
let dirty = false;
let flushAt = 0;

const slotCache = new Map<string, string>();
/** Opaque, stable id for a key: never the key itself. "nokey" for keyless lanes. */
export function slotId(key: string): string {
  if (!key) return "nokey";
  let s = slotCache.get(key);
  if (!s) {
    s = createHash("sha256").update(key).digest("hex").slice(0, 8);
    if (slotCache.size > 500) slotCache.clear();
    slotCache.set(key, s);
  }
  return s;
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);
const minuteOf = (now: number) => Math.floor(now / 60_000);

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(ledgerFile())) {
      const d = JSON.parse(readFileSync(ledgerFile(), "utf8"));
      if (d && d.v === 1 && d.providers && typeof d.providers === "object") data = d;
    }
  } catch { data = { v: 1, providers: {} }; }
}

function flush(now: number, force = false): void {
  if (!dirty) return;
  if (!force && now - flushAt < 5000) return;
  flushAt = now;
  dirty = false;
  for (const p of Object.values(data.providers)) {
    for (const [s, u] of Object.entries(p.slots)) if (now - u.lastAt > PRUNE_MS) delete p.slots[s];
  }
  try { writeFileAtomic(ledgerFile(), JSON.stringify(data), { mode: 0o600 }); } catch { /* best-effort */ }
}
export function flushLedger(): void { flush(Date.now(), true); }

function fresh(now: number): SlotUsage {
  return { requests: 0, tokensIn: 0, tokensOut: 0, rateLimited: 0, errors: 0, day: dayOf(now), dayRequests: 0, dayTokens: 0, minute: minuteOf(now), minuteRequests: 0, minuteTokens: 0, lastAt: now };
}
/** Roll the day/minute windows forward so stale counts never read as current usage. */
function roll(u: SlotUsage, now: number): SlotUsage {
  const d = dayOf(now);
  if (u.day !== d) { u.day = d; u.dayRequests = 0; u.dayTokens = 0; }
  const m = minuteOf(now);
  if (u.minute !== m) { u.minute = m; u.minuteRequests = 0; u.minuteTokens = 0; }
  return u;
}
function provider(id: string): ProviderUsage {
  load();
  const g = quotaGroup(id);
  let p = data.providers[g];
  if (!p) { p = { slots: {}, recent: [] }; data.providers[g] = p; }
  return p;
}
function slot(id: string, s: string, now: number): SlotUsage {
  const p = provider(id);
  let u = p.slots[s];
  if (!u) { u = fresh(now); p.slots[s] = u; }
  return roll(u, now);
}

export interface CallOutcome { ok: boolean; status?: number; tokensIn?: number; tokensOut?: number; now?: number }

/** One attempt against one key slot. A 429 is counted as rate-limited, not as a spent request —
 *  the provider refused it, so it did not draw down the quota. */
export function recordLaneCall(providerId: string, s: string, o: CallOutcome): void {
  const now = o.now ?? Date.now();
  const u = slot(providerId, s, now);
  u.lastAt = now;
  if (o.status === 429) {
    u.rateLimited++;
  } else {
    const tokens = (o.tokensIn || 0) + (o.tokensOut || 0);
    u.requests++; u.dayRequests++; u.minuteRequests++;
    u.tokensIn += o.tokensIn || 0; u.tokensOut += o.tokensOut || 0;
    u.dayTokens += tokens; u.minuteTokens += tokens;
    if (!o.ok) u.errors++;
  }
  const p = provider(providerId);
  p.recent.push(o.ok ? 1 : 0);
  if (p.recent.length > RECENT) p.recent.splice(0, p.recent.length - RECENT);
  dirty = true;
  flush(now);
}

const over = (used: number, limit: number | null) => limit !== null && limit > 0 && used >= Math.max(1, Math.floor(limit * SKIP_AT));

/** Has this slot used ≥90% of any documented window? Then skip it BEFORE the provider says 429. */
export function nearQuota(providerId: string, s: string, now = Date.now()): boolean {
  const q = quotaFor(providerId);
  if (!q) return false;
  load();
  const u = data.providers[quotaGroup(providerId)]?.slots[s];
  if (!u) return false;
  roll(u, now);
  return over(u.minuteRequests, q.rpm) || over(u.dayRequests, q.rpd) || over(u.minuteTokens, q.tpm) || over(u.dayTokens, q.tpd);
}

/** When a slot skipped by nearQuota becomes usable again: the next minute if only a per-minute
 *  window is full, else the next UTC midnight. 0 when it is not gated. */
export function quotaFreesAt(providerId: string, s: string, now = Date.now()): number {
  if (!nearQuota(providerId, s, now)) return 0;
  const q = quotaFor(providerId);
  const u = data.providers[quotaGroup(providerId)]?.slots[s];
  if (!q || !u) return 0;
  if (over(u.dayRequests, q.rpd) || over(u.dayTokens, q.tpd)) {
    const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  }
  return (minuteOf(now) + 1) * 60_000;
}

/** Fraction of the documented daily request budget still left on this slot (1 when unknown). */
export function dayHeadroom(providerId: string, s: string, now = Date.now()): number {
  const q = quotaFor(providerId);
  if (!q?.rpd) return 1;
  load();
  const u = data.providers[quotaGroup(providerId)]?.slots[s];
  if (!u) return 1;
  roll(u, now);
  return Math.max(0, 1 - u.dayRequests / q.rpd);
}

/** Share of the last ~20 attempts that answered; null until there are at least 3. */
export function successRate(providerId: string): number | null {
  load();
  const r = data.providers[quotaGroup(providerId)]?.recent;
  if (!r || r.length < 3) return null;
  return r.reduce((a, b) => a + b, 0) / r.length;
}

/** Requests spent today across every slot of this lane's quota group. */
export function usedToday(providerId: string, now = Date.now()): number {
  load();
  const p = data.providers[quotaGroup(providerId)];
  if (!p) return 0;
  const d = dayOf(now);
  return Object.values(p.slots).reduce((a, u) => a + (u.day === d ? u.dayRequests : 0), 0);
}

/** A read-only copy for diagnostics/tests. */
export function ledgerSnapshot(): LedgerFile { load(); return JSON.parse(JSON.stringify(data)); }

/** Test helper — forget everything in memory and re-read from disk on next use. */
export function _resetLedger(): void { data = { v: 1, providers: {} }; loaded = false; dirty = false; flushAt = 0; }
