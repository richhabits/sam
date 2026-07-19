// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE KNACK  — observability for learned influence. Never silent.
//
//  SAM already learns confidence-scored preferences (preferences.ts) and lets HIGH-confidence ones
//  change a decision (preferredTier, smartDefault). Today that influence is SILENT — the one thing a
//  no-silent-failures app must not allow for self-learned behaviour. The Knack makes every such
//  influence ATTRIBUTABLE: when a learned pattern above its threshold changes a choice, it is recorded
//  with its provenance (which pattern, what value, what confidence) to a bounded, inspectable, local
//  log plus the Pulse and the Trail — so it surfaces in the Console/Scope.
//
//  The Knack does NOT learn and does NOT decide. It only observes and attributes. It never touches a
//  destructive action, the local↔cloud boundary, or a security decision — those are not learnable.
//  Opt-in (SAM_KNACK=1), default off: disabling it restores today's exact behaviour (the influence
//  still happens — it just isn't logged), so it can never change what SAM does, only what it reveals.
// ─────────────────────────────────────────────────────────────
import { trail } from "./issues.ts";
import { count } from "./pulse.ts";

export interface Influence { pattern: string; value: string; confidence: number; at: string }

const MAX = 100;                 // bounded ring — the log never grows unbounded
const applied: Influence[] = [];

/** Observability is opt-in. Off (default) = today's behaviour exactly (learned influence, unlogged). */
export function knackEnabled(): boolean { return process.env.SAM_KNACK === "1"; }

/**
 * Record that a learned pattern influenced a decision. Attributable, local, bounded. A no-op unless
 * enabled, so callers can wrap the influence inline without changing behaviour when it's off.
 */
export function recordInfluence(pattern: string, value: string, confidence: number, at = new Date().toISOString()): void {
  if (!knackEnabled()) return;
  applied.push({ pattern, value, confidence, at });
  if (applied.length > MAX) applied.shift();
  count("knack.applied", 1, { pattern });
  trail("state", `Knack: acted on learned "${pattern}" = ${value} (confidence ${confidence.toFixed(2)})`, { pattern, confidence });
}

/** The recent attributed influences — for the Console/Scope and for the user to inspect. */
export function recentInfluences(): Influence[] { return [...applied]; }
export function knackSummary(): { enabled: boolean; count: number; recent: Influence[] } {
  return { enabled: knackEnabled(), count: applied.length, recent: applied.slice(-10) };
}

/** Reset fully clears the influence log (the learned patterns themselves live in preferences.ts). */
export function _reset(): void { applied.length = 0; }
