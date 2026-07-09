// ─────────────────────────────────────────────────────────────
//  S.A.M. · MODEL-CALL METRICS  (the proof layer)
//  A tiny, always-on ring buffer that records every brain call:
//  which tier answered, tokens in/out (estimated), latency, and
//  whether it was served from cache. Near-zero cost when idle.
//
//  Feeds two things:
//   • the router badge / /api/health (which tier answered & why)
//   • scripts/bench.ts (before/after cost + latency — marketing #s)
// ─────────────────────────────────────────────────────────────

import type { Tier } from "./models.ts";

export interface ModelCall {
  tier: Tier;
  provider: string;
  promptTokens: number;
  outputTokens: number;
  ms: number;             // total latency of this call
  ttftMs?: number;        // latency to first token (streaming only)
  cached?: boolean;       // served from the semantic cache (Phase 2) — 0 tokens billed
  escalated?: boolean;    // wrong-tier self-check bumped it up a tier (Phase 1)
  reason?: string;        // classifier verdict, e.g. "trivial→local", "hard→premium"
}

// Rough token estimate — ~4 chars/token is the standard heuristic and, crucially,
// STABLE across before/after runs, so deltas are honest even if absolute counts are approximate.
export function estTokens(s: string): number {
  return s ? Math.ceil(s.length / 4) : 0;
}

// Bounded ring so a long-running server never grows this without limit.
const MAX = 500;
let log: ModelCall[] = [];

export function recordModelCall(c: ModelCall): void {
  log.push(c);
  if (log.length > MAX) log.splice(0, log.length - MAX);
}

// Return everything recorded since the last drain, and clear. The bench drains
// between tasks so each task's calls are cleanly attributed to that task.
export function drainMetrics(): ModelCall[] {
  const out = log;
  log = [];
  return out;
}

// Non-destructive peek (for /api/health — show the last few routing decisions).
export function peekMetrics(n = 10): ModelCall[] {
  return log.slice(-n);
}

// ── PRICE TABLE (USD per 1M tokens) — a transparent lens over the raw token counts ──
// local & free brains are $0 in real dollars; we assign free a small NOMINAL cost so the
// token-diet win (fewer prompt tokens on every tier) is visible, not hidden behind zeros.
// premium ≈ Claude Sonnet-class. Documented in docs/BENCHMARKS.md so the numbers are auditable.
export const PRICE: Record<Tier, { in: number; out: number }> = {
  local: { in: 0, out: 0 },
  free: { in: 0.1, out: 0.1 },     // nominal quota-value, not real dollars
  premium: { in: 3, out: 15 },     // real dollars (Sonnet-class)
};

export function costUSD(c: Pick<ModelCall, "tier" | "promptTokens" | "outputTokens" | "cached">): number {
  if (c.cached) return 0;          // a cache hit bills nothing
  const p = PRICE[c.tier];
  return (c.promptTokens / 1e6) * p.in + (c.outputTokens / 1e6) * p.out;
}
