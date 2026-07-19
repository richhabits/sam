// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE RELAY  — one path every outbound brain call takes.
//
//  Key selection, failure handling, and the local↔cloud boundary used to be reimplemented at each
//  call site. The Relay applies ONE ordered policy chain: check the Breaker → pick a key from the
//  pool → run → report success/failure (feeds the pool cooldown) → record failures to the Black Box.
//
//  Two rules it enforces that scattered call sites couldn't:
//   • THE BREAKER. A brain that keeps failing is skipped (fail fast — don't pay its timeout every
//     request), then allowed one probe after a cooldown; a success closes it again.
//   • THE BOUNDARY. A request that must stay local may NEVER cross to a cloud brain. The crossing is
//     refused EXPLICITLY here — never a silent fallback.
// ─────────────────────────────────────────────────────────────
import { getKey, poolSize, reportFailure, reportSuccess } from "./keys.ts";
import { capture } from "./issues.ts";
import { count } from "./pulse.ts";

// ── The Breaker ──────────────────────────────────────────────
const BREAKER_TRIP = 3;             // consecutive brain-level failures before it opens
const BREAKER_COOLDOWN_MS = 30_000; // how long it stays open before a half-open probe

interface Breaker { fails: number; openUntil: number }
const breakers = new Map<string, Breaker>();
function breakerFor(id: string): Breaker {
  let b = breakers.get(id);
  if (!b) { b = { fails: 0, openUntil: 0 }; breakers.set(id, b); }
  return b;
}

export type BreakerStatus = "closed" | "open" | "half-open";
/** closed = healthy; open = skip (fail fast); half-open = cooldown elapsed, allow one probe. */
export function breakerStatus(id: string, now = Date.now()): BreakerStatus {
  const b = breakers.get(id);
  if (!b || b.openUntil === 0) return "closed";
  return now < b.openUntil ? "open" : "half-open";
}
/** May we attempt this brain? False only while the Breaker is fully open. */
export function canAttempt(id: string, now = Date.now()): boolean {
  return breakerStatus(id, now) !== "open";
}
function onSuccess(id: string): void { const b = breakerFor(id); b.fails = 0; b.openUntil = 0; }
function onFailure(id: string, now = Date.now()): void {
  const b = breakerFor(id);
  b.fails++;
  count("brain.failures", 1, { brain: id });
  if (b.fails >= BREAKER_TRIP) {
    if (b.fails === BREAKER_TRIP) count("breaker.open", 1, { brain: id }); // count the trip, not every failure while open
    b.openUntil = now + BREAKER_COOLDOWN_MS;
  }
}
/** Test/maintenance helper — reset all Breakers. */
export function _resetBreakers(): void { breakers.clear(); }

// ── The boundary invariant ───────────────────────────────────
export type Boundary = "local" | "cloud";
export interface RelayPolicy { allowCloud: boolean }

/** A brain the Relay can run: its id (pool key), whether it's local or cloud, whether it needs no
 *  key, and the actual call. `run` owns its own request + timeout; the Relay wraps the outcome. */
export interface Brain {
  id: string;
  boundary: Boundary;
  noKey?: boolean;
  run: (system: string, prompt: string, key: string) => Promise<string>;
}

export type RelayOutcome =
  | { text: string }
  | { blocked: string }   // the boundary refused this — explicit, never silent
  | null;                 // nothing came back (breaker open, no key, or the brain failed)

export interface RelayOpts {
  now?: number;
  retryDelayMs?: number;
  /** Cap how many pooled keys to try. Streaming passes 1: a stream that already emitted tokens
   *  can't be retried on another key without double-emitting, so it gets exactly one attempt. */
  maxKeys?: number;
}

/**
 * Route one brain call through the policy chain. Behaviour matches the previous per-call-site logic
 * (no-key → two tries; keyed → one try per pooled key; a 4xx that isn't 429 stops hammering) and
 * ADDS the Breaker, the boundary guard, and failure capture.
 */
export async function relayBrain(b: Brain, system: string, prompt: string, policy: RelayPolicy, opts: RelayOpts = {}): Promise<RelayOutcome> {
  const now = opts.now ?? Date.now();
  // THE BOUNDARY — a local/private request may not cross to cloud. Refuse loudly, never silently.
  if (b.boundary === "cloud" && !policy.allowCloud) {
    return { blocked: `local request refused to cross to cloud brain "${b.id}"` };
  }
  // THE BREAKER — skip a brain that keeps failing rather than pay its timeout again.
  if (!canAttempt(b.id, now)) return null;

  if (b.noKey) {
    for (let i = 0; i < 2; i++) {
      try {
        const text = await b.run(system, prompt, "");
        if (text) { onSuccess(b.id); return { text }; }
      } catch (e) {
        capture(e, { brain: b.id, boundary: b.boundary });
      }
      if (i === 0) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 800));
    }
    onFailure(b.id, now);
    return null;
  }

  const attempts = Math.min(opts.maxKeys ?? Number.POSITIVE_INFINITY, Math.max(1, poolSize(b.id)));
  let ran = false;   // did we actually reach a brain? no key available ≠ a failure to trip the Breaker on.
  for (let i = 0; i < attempts; i++) {
    const key = getKey(b.id);
    if (!key) break;
    ran = true;
    try {
      const text = await b.run(system, prompt, key);
      if (text) { reportSuccess(b.id, key); onSuccess(b.id); return { text }; }
    } catch (e) {
      const status = (e as { status?: number })?.status;
      reportFailure(b.id, key, status);
      capture(e, { brain: b.id, boundary: b.boundary, status });
      // A 4xx that isn't rate-limit means a bad key/request — stop hammering this brain.
      if (status && status !== 429 && status < 500) break;
    }
  }
  if (ran) onFailure(b.id, now);   // only a real attempt counts toward the Breaker
  return null;
}
