// ─────────────────────────────────────────────────────────────
//  S.A.M. · SERVER-HELD PENDING APPROVALS
//  A risky action pauses HERE, keyed by an opaque id. The client approves by
//  id ONLY — the tool, input and transcript are never accepted back from the
//  network, so a caller can't approve an action the agent never proposed, and
//  the transcript (which may hold sensitive context) never leaves the server.
// ─────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";

export interface PendingCtx {
  tier: string;
  projectId?: string;
  skillBody: string;
  skillId?: string;
  user?: any;
}
export interface PendingAction extends PendingCtx {
  tool: string;
  input: any;
  transcript: string;
  trace: string[];
  ts: number;
}

const PENDING = new Map<string, PendingAction>();
const TTL_MS = 15 * 60_000;   // an unanswered approval expires after 15 min
const MAX = 500;              // hard cap — the store never grows unbounded

// Park a pending action and return its opaque id.
export function holdPending(p: Omit<PendingAction, "ts">, now = Date.now()): string {
  for (const [id, v] of PENDING) if (now - v.ts > TTL_MS) PENDING.delete(id);
  if (PENDING.size >= MAX) PENDING.clear();
  const id = randomUUID();
  PENDING.set(id, { ...p, ts: now });
  return id;
}

// Look up and consume a pending action by id (one-shot).
export function takePending(id?: string): PendingAction | undefined {
  if (!id) return undefined;
  const p = PENDING.get(id);
  if (p) PENDING.delete(id);
  return p;
}

// Wrap an agent result/event: if it's a pending action, park it server-side and
// hand the client an id (+ the preview/activity it needs to render the card),
// stripping the transcript so it stays on the server.
export function withPending<T extends { kind?: string; type?: string; [k: string]: any }>(
  r: T, ctx: PendingCtx
): T & { pendingId?: string } {
  if (!r || (r.kind !== "pending" && r.type !== "pending")) return r;
  const pendingId = holdPending({
    tool: r.tool, input: r.input, transcript: r.transcript || "", trace: r.trace || [], ...ctx,
  });
  return { ...r, pendingId, transcript: "" };
}

export function _pendingSize(): number { return PENDING.size; }
export function _clearPending(): void { PENDING.clear(); }
