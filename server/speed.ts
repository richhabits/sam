// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE HEALTH MEMORY — what SAM has learned about each brain by USING it.
//
//  Why this exists, precisely. On 2026-08-01 the free lane was audited by hand and 7 of 11 free
//  brains were dead: cerebras 404 (its model slug had been retired upstream), openrouter 404 (its
//  `:free` slug retired), github models HTTP 410 (the product is being retired), hermes 402 (Nous
//  now charges), pollinations 402 (anonymous is cache-only). Three of those — cerebras, hermes —
//  were the FIRST brain tried in their lane, so every single turn opened by failing, and one of
//  them took 24 SECONDS to fail. None of it was visible: the cascade falls through silently, so a
//  dead brain looks exactly like a slightly slow one.
//
//  A hand audit fixes that day. It rots by the next model retirement. So SAM measures instead:
//  every brain call reports how long it took and whether it worked, and the free ordering follows
//  the measurement. When a provider retires a slug next month, SAM notices on the first call and
//  stops leading with it — no human, no release.
//
//  Two kinds of failure, deliberately distinguished:
//    · TRANSIENT (429, 5xx, timeout) — it's having a moment. The Relay's Breaker already handles
//      that in-process; here it only nudges the ordering.
//    · TERMINAL (401, 402, 404, 410) — the key is wrong, the model is gone, the product is
//      retired, or it now costs money. Retrying that on the next turn is pure latency. It gets
//      SUNK for hours, then allowed one probe: a retirement is permanent, but a billing mistake
//      or a re-issued key should heal without anyone clearing a file.
//
//  Nothing here decides IF a brain may be called — the cascade still falls through everything, so
//  a demoted brain is still tried when the ones above it fail. This only changes the ORDER, which
//  is the difference between a fast free answer and a slow one.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Health {
  /** Exponentially-weighted mean latency of the calls that WORKED, in ms. 0 = never succeeded. */
  ewmaMs: number;
  calls: number;
  ok: number;
  /** Epoch ms until which this brain is sunk to the bottom after a terminal failure. */
  sunkUntil: number;
  /** The status that sank it — the sentence the audit would have written. */
  reason?: string;
  lastAt: number;
}

/** Statuses that mean "this will fail again in one second exactly as it failed now". */
export const TERMINAL = new Set([401, 402, 403, 404, 410]);
/** How long a terminally-failed brain stays at the bottom before it earns one probe. */
export const SINK_MS = Number(process.env.SAM_SINK_MS) || 6 * 60 * 60 * 1000;
// Fresh enough to follow a provider getting slower, slow enough that one unlucky call doesn't
// reorder the world.
const ALPHA = 0.3;

const vaultDir = () => process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const healthFile = () => join(vaultDir(), "brain-health.json");

let state: Record<string, Health> = {};
let loaded = false;
let dirty = false;
let flushAt = 0;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(healthFile())) state = JSON.parse(readFileSync(healthFile(), "utf8")) || {};
  } catch { state = {}; /* a corrupt file just means SAM re-learns — never a boot failure */ }
}

/** Persist at most once every few seconds: this sits on the hot path of every brain call. */
function flush(now: number, force = false): void {
  if (!dirty) return;
  if (!force && now - flushAt < 5000) return;
  flushAt = now;
  dirty = false;
  try {
    mkdirSync(vaultDir(), { recursive: true });
    writeFileSync(healthFile(), JSON.stringify(state, null, 2));
  } catch { /* best-effort — the ordering just starts from scratch next boot */ }
}

export function health(id: string): Health | undefined {
  load();
  return state[id];
}

export function allHealth(): Record<string, Health> {
  load();
  return { ...state };
}

/**
 * One brain call, measured. `status` is the HTTP status when the call failed with one — it is what
 * separates "busy" from "gone".
 */
export function record(id: string, r: { ms: number; ok: boolean; status?: number; now?: number }): void {
  load();
  const now = r.now ?? Date.now();
  const h = state[id] ?? { ewmaMs: 0, calls: 0, ok: 0, sunkUntil: 0, lastAt: 0 };
  h.calls++;
  h.lastAt = now;
  if (r.ok) {
    h.ok++;
    h.ewmaMs = h.ewmaMs ? Math.round(ALPHA * r.ms + (1 - ALPHA) * h.ewmaMs) : r.ms;
    // A brain that just answered is not retired, whatever it said last time. This is the healing
    // path — no file to clear, no restart.
    h.sunkUntil = 0;
    h.reason = undefined;
  } else if (r.status && TERMINAL.has(r.status)) {
    h.sunkUntil = now + SINK_MS;
    h.reason = `HTTP ${r.status}`;
  }
  state[id] = h;
  dirty = true;
  flush(now);
}

/** Write immediately — for shutdown, and for tests that assert on the file. */
export function flushNow(): void {
  flush(Date.now(), true);
}

/** Is this brain currently sunk (terminal failure, not yet due a probe)? */
export function sunk(id: string, now = Date.now()): boolean {
  const h = health(id);
  return !!h && h.sunkUntil > now;
}

/**
 * Order a pool by what has actually been measured, WITHOUT throwing away the caller's ordering —
 * the lane preference encodes which brains are right for the job, and speed is a tiebreak within
 * that, not a replacement for it. So:
 *   1. sunk brains go last (they are still tried, just never first)
 *   2. among the rest, a brain measurably SLOWER than the leader by more than `tolerance` sinks
 *      below the ones that beat it; everything within tolerance keeps the incoming order
 * Unmeasured brains keep their place: never tried is not the same as tried and slow, and a new
 * brain deserves the chance the audit gave cerebras.
 */
export function healthOrder<T extends { id: string }>(pool: T[], now = Date.now()): T[] {
  load();
  if (pool.length < 2) return pool;
  const measured = pool.map((p, i) => ({ p, i, h: state[p.id] }));
  const speeds = measured.map((m) => m.h?.ewmaMs || 0).filter((n) => n > 0);
  const best = speeds.length ? Math.min(...speeds) : 0;
  // 3× the fastest measured brain, floored so a 100ms leader doesn't demote a fine 400ms one.
  const tolerance = Math.max(best * 3, 1500);
  const grade = (m: { p: T; h?: Health }) => {
    if (m.h && m.h.sunkUntil > now) return 2;             // gone, as far as today is concerned
    if (m.h?.ewmaMs && m.h.ewmaMs > tolerance) return 1;  // works, but measurably slow
    // Tried repeatedly, never once produced an answer, and never with a status that says why —
    // which is what a brain that TIMES OUT looks like. nvidia did exactly this during the audit:
    // two 30-second timeouts and no HTTP status at all, so nothing above would have demoted it,
    // and it would have gone on leading a lane it has never answered from.
    if (m.h && m.h.calls >= 2 && m.h.ok === 0) return 1;
    return 0;                                             // fast, or not yet known
  };
  return measured.sort((a, b) => grade(a) - grade(b) || a.i - b.i).map((m) => m.p);
}

/** Human-readable, for the Console and `npm run routes`. Fastest first, dead at the bottom. */
export function report(now = Date.now()): { id: string; ms: number; calls: number; okRate: number; state: string }[] {
  load();
  return Object.entries(state)
    .map(([id, h]) => ({
      id,
      ms: h.ewmaMs,
      calls: h.calls,
      okRate: h.calls ? Math.round((h.ok / h.calls) * 100) : 0,
      state: h.sunkUntil > now
        ? `sunk (${h.reason || "failed"})`
        : h.ewmaMs
          ? "ok"
          // "untried" would be a lie for a brain that has been called twice and timed out twice.
          : h.calls >= 2 ? `failing (${h.calls} tries, no answer)` : "untried",
    }))
    .sort((a, b) => (a.state.startsWith("sunk") ? 1 : 0) - (b.state.startsWith("sunk") ? 1 : 0) || (a.ms || 1e9) - (b.ms || 1e9));
}

/** Forget everything — the "audit it again from scratch" button. */
export function _reset(): void {
  state = {};
  loaded = true;
  dirty = true;
}
