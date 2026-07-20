// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE ASK  (flag SAM_ASK, default OFF)
//
//  SAM's ask-first gate (mayAutoRun / authz.ts) already fails CLOSED — a dangerous action can never
//  auto-run unattended. But when a risky action needs approval and NO ONE is in-session, the pending
//  request was silently dropped (the scheduler reported "Finished." having done nothing) or hung
//  forever (a paused swarm agent with no timeout). The Ask closes that hole: it delivers the SAME
//  gate's escalation OUT-OF-BAND over the user's own channels, waits a configurable timeout, and
//  SAFE-DEFAULTS — on timeout OR denial OR ambiguity the action is NOT performed; it's recorded as
//  DEFERRED and surfaced, never silently done and never silently dropped.
//
//  The Ask adds NO new gates. It fires only for actions the ask-first gate already stops
//  (confirm/dangerous) when running unattended. Safe tools never raise an Ask.
//
//  This module is pure lifecycle + record-keeping: it parks the action (in the existing pending
//  store), records the Ask, delivers it (via an injectable hook so tests do no I/O), and logs every
//  request + outcome. It NEVER runs a tool itself — resolution hands the parked action back to the
//  caller to resume through the normal approval path. That keeps "the Ask can't perform an action"
//  a structural fact, not a promise.
// ─────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { holdPending, takePending, type PendingAction } from "./pending.ts";
import { isDangerous } from "./authz.ts";
import { logAutonomy } from "./autonomy-log.ts";

export function askEnabled(): boolean {
  return process.env.SAM_ASK === "1";   // default OFF (opt-in) — House Rule #4
}

// How long an unanswered Ask stays open before it SAFE-DEFAULTS to deferred. Configurable; never 0.
export function askTimeoutMs(): number {
  const n = Number(process.env.SAM_ASK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30 * 60_000;   // default 30 min
}

export type AskStatus = "open" | "approved" | "denied" | "deferred";

export interface Ask {
  id: string;
  pendingId: string;                 // the parked action in pending.ts (transcript stays server-side)
  tool: string;
  tier: string;
  source: string;                    // scheduler | proactive | ios | swarm | …
  action: string;                    // human "what" (the tool's activity line)
  why: string;                       // human "why" (why SAM wanted it)
  blast: "confirm" | "dangerous";    // blast radius, from the ask-first tiering
  raisedAt: number;
  expiresAt: number;
  status: AskStatus;
  swarmRef?: { swarmId: string; agentId: string };   // set when the source is a paused swarm agent
}

const ASKS = new Map<string, Ask>();
const MAX = 200;

// The out-of-band delivery hook. Default wires the user's own channels (push + native + email);
// tests inject a stub so unit tests never touch the network or the OS. Delivery is best-effort and
// can NEVER change the safe default — a channel that fails still leaves the Ask open + surfaced locally.
export type Deliver = (a: Ask) => void;
let DELIVER: Deliver = () => undefined;        // set by wireAskDelivery() at boot; no-op until then (tests stub it)
export function wireAskDelivery(fn: Deliver): void { DELIVER = fn; }

/**
 * Raise an Ask for a pending action that surfaced with no one in-session. Parks the action, records
 * the Ask as OPEN, delivers it out-of-band, and logs it. Returns the Ask. NEVER performs the action.
 */
export function raiseAsk(input: {
  pending: { tool: string; input: any; transcript?: string; trace?: string[]; activity?: string };
  tier: string;
  source: string;
  why?: string;
  swarmRef?: { swarmId: string; agentId: string };
  now?: number;
  deliver?: Deliver;
}): Ask {
  const now = input.now ?? Date.now();
  // evict expired + cap
  for (const [id, a] of ASKS) if (a.status !== "open" && now - a.raisedAt > askTimeoutMs() * 4) ASKS.delete(id);
  if (ASKS.size >= MAX) {
    const oldest = [...ASKS.entries()].sort((a, b) => a[1].raisedAt - b[1].raisedAt)[0];
    if (oldest) ASKS.delete(oldest[0]);
  }
  const pendingId = holdPending({
    tool: input.pending.tool, input: input.pending.input,
    transcript: input.pending.transcript || "", trace: input.pending.trace || [],
    tier: input.tier, skillBody: "",
  }, now);
  const ask: Ask = {
    id: randomUUID(),
    pendingId,
    tool: input.pending.tool,
    tier: input.tier,
    source: input.source,
    action: input.pending.activity || input.pending.tool,
    why: input.why || `an unattended ${input.source} task needs this to continue`,
    blast: isDangerous(input.pending.tool) ? "dangerous" : "confirm",
    raisedAt: now,
    expiresAt: now + askTimeoutMs(),
    status: "open",
    swarmRef: input.swarmRef,
  };
  ASKS.set(ask.id, ask);
  logAutonomy({
    at: new Date(now).toISOString(),
    behavior: "the Ask",
    kind: "blocked",   // a dangerous/confirm action the gate stopped and asked about — nothing ran
    summary: `asked to approve “${ask.action}” (${ask.blast}, from ${ask.source}) — awaiting your OK, else deferred`,
    tool: ask.tool,
  });
  try { (input.deliver || DELIVER)(ask); } catch { /* delivery is best-effort; the Ask stays open + surfaced locally */ }
  return ask;
}

/**
 * Turn a BACKGROUND agent result into a delivered outcome — the shared fix for the dropped paths.
 * If it's a risky pending action and the Ask is on, raise it out-of-band and return a DEFERRED
 * message (never a false "Finished."). A final answer passes through. If the Ask is off (or there's
 * nothing to do) it returns `none`, so the caller keeps its prior fallback. Never performs the action.
 */
export function handleUnattended(
  r: { kind?: string; text?: string; tool?: string; input?: any; transcript?: string; trace?: string[]; activity?: string },
  opts: { tier: string; source: string; why?: string; swarmRef?: { swarmId: string; agentId: string }; now?: number; deliver?: Deliver },
): { kind: "final" | "deferred" | "none"; text: string; ask?: Ask } {
  if (r?.kind === "final" && r.text) return { kind: "final", text: r.text };
  if (r?.kind === "pending" && askEnabled() && r.tool) {
    const ask = raiseAsk({
      pending: { tool: r.tool, input: r.input, transcript: r.transcript, trace: r.trace, activity: r.activity },
      tier: opts.tier, source: opts.source, why: opts.why, swarmRef: opts.swarmRef, now: opts.now, deliver: opts.deliver,
    });
    return { kind: "deferred", ask, text: `Deferred — I need your OK to “${ask.action}” (${ask.blast}). I've asked you; nothing was done.` };
  }
  return { kind: "none", text: "" };
}

/**
 * Resolve an Ask. SAFE by construction: it returns the parked action to run ONLY on an explicit
 * approval of an OPEN, non-expired Ask. Denial, expiry, an unknown id, an already-resolved Ask, or
 * any ambiguity ⇒ status recorded, action NOT returned. The caller runs the action via the normal
 * resume path; the Ask never runs anything itself.
 */
export function resolveAsk(id: string, approved: boolean, now = Date.now()): { ask: Ask; action: PendingAction | null } | null {
  const ask = ASKS.get(id);
  if (!ask) return null;                                   // unknown id ⇒ ambiguous ⇒ nothing happens
  if (ask.status !== "open") return { ask, action: null }; // already resolved ⇒ never re-run
  if (now > ask.expiresAt) {                               // expired at resolve time ⇒ safe-default
    ask.status = "deferred";
    takePending(ask.pendingId);
    logAutonomy({ at: new Date(now).toISOString(), behavior: "the Ask", kind: "blocked",
      summary: `“${ask.action}” expired before you answered — DEFERRED, not performed`, tool: ask.tool });
    return { ask, action: null };
  }
  if (approved) {
    const action = takePending(ask.pendingId) ?? null;     // consume the parked action (one-shot)
    ask.status = "approved";
    logAutonomy({ at: new Date(now).toISOString(), behavior: "the Ask", kind: "acted",
      summary: `you approved “${ask.action}” (${ask.blast}) — performing it now`, tool: ask.tool });
    return { ask, action };                                // caller resumes it; null if the park already expired
  }
  ask.status = "denied";
  takePending(ask.pendingId);
  logAutonomy({ at: new Date(now).toISOString(), behavior: "the Ask", kind: "blocked",
    summary: `you declined “${ask.action}” — not performed`, tool: ask.tool });
  return { ask, action: null };
}

/**
 * Expire every OPEN Ask past its timeout: mark DEFERRED, drop the parked action, log it, and return
 * the expired ones so a caller (e.g. a paused swarm) can finish cleanly instead of hanging forever.
 * NEVER approves anything — timeout is the safe default.
 */
export function sweepAsks(now = Date.now()): Ask[] {
  const expired: Ask[] = [];
  for (const ask of ASKS.values()) {
    if (ask.status === "open" && now > ask.expiresAt) {
      ask.status = "deferred";
      takePending(ask.pendingId);
      logAutonomy({ at: new Date(now).toISOString(), behavior: "the Ask", kind: "blocked",
        summary: `no answer in time for “${ask.action}” — DEFERRED, not performed`, tool: ask.tool });
      expired.push(ask);
    }
  }
  return expired;
}

/** The still-open Asks — the Console card's data (always available, even when push/email aren't set up). */
export function openAsks(now = Date.now()): Ask[] {
  return [...ASKS.values()].filter((a) => a.status === "open" && now <= a.expiresAt)
    .sort((a, b) => a.raisedAt - b.raisedAt);
}

export function getAsk(id: string): Ask | undefined { return ASKS.get(id); }
export function _asksSize(): number { return ASKS.size; }
export function _clearAsks(): void { ASKS.clear(); }
