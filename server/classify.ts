// ─────────────────────────────────────────────────────────────
//  S.A.M. · CASCADE CLASSIFIER  (Phase 1 — smarter, quicker, cheaper)
//
//  A fast, LOCAL pass that scores each request before any brain runs:
//    trivial     → local model (greetings, acks, tiny maths, one-liners)
//    standard    → cheapest healthy free pool
//    hard        → strong free "deep" lane (premium only on opt-in/escalation)
//    needs-tools → free pool + the agent tool loop (live/current info)
//
//  Two guarantees baked in:
//   • TRIVIAL NEVER TOUCHES A PAID API — it stays on the local brain.
//   • FREE-FIRST — hard questions stay on the (strong) free lane by default;
//     premium is reached only when the user opted in, or the wrong-tier
//     self-check escalates because a cheaper answer genuinely failed.
//
//  No model call in the common case — pure heuristics = ~0ms, $0.
// ─────────────────────────────────────────────────────────────

import type { Tier, Lane } from "./models.ts";
import { isFastPath, needsLiveInfo } from "./agent.ts";

export type ReqClass = "trivial" | "standard" | "hard" | "needs-tools";

export interface Verdict {
  klass: ReqClass;
  reason: string;   // human-readable, shown in the router badge: e.g. "trivial → local"
  lean: boolean;    // build a LEAN system prompt (skip heavy doctrine/brands) — token diet
}

// Greetings, acknowledgements, tiny social — nothing a local 3B can't nail instantly.
const TRIVIAL_RE = /^\s*(hi|hey|hello+|yo|sup|wassup|gm|good morning|good afternoon|good evening|good night|night|morning|thanks?|thank you|thx|ty|cheers|ok|okay|k|cool|nice|great|awesome|got it|noted|lol|haha|👍|🙏|❤️|sorry|no worries|np|yes|no|yep|nope|maybe)\b[\s!.,]*$/i;

// Pure arithmetic — "12*8", "what's 15% of 200", "3 + 4 =" — a local model does these free.
const SIMPLE_MATH_RE = /^\s*(what('?s| is)\s+)?(\d+% of\s+)?[-+*/x×÷\d\s().,%]+\s*=?\s*\??\s*$/i;

// Signals a genuinely harder reasoning task — worth the strong (deep) lane.
const HARD_RE = /\b(analy[sz]e|strateg(y|ic|ise|ize)|compare|pros and cons|trade-?offs?|think through|reason through|evaluate|assess|deep dive|break ?down|architect|design a|plan out|weigh up|implications?|framework|end[- ]to[- ]end)\b/i;

// Classify a message into a cascade class. Cheap heuristics, ordered by priority.
export function classify(message: string): Verdict {
  const m = (message || "").trim();
  const words = m ? m.split(/\s+/).length : 0;

  // 1) Live/current info → must use tools. Not trivial even if short ("what time is it?").
  if (needsLiveInfo(m)) return { klass: "needs-tools", reason: "needs-tools → free + tools", lean: false };

  // 2) Trivial — greetings/acks, tiny maths, or short self-contained one-liners.
  if (TRIVIAL_RE.test(m) || SIMPLE_MATH_RE.test(m)) return { klass: "trivial", reason: "trivial → local", lean: true };
  if (isFastPath(m) && words <= 12 && m.length < 140 && !HARD_RE.test(m)) return { klass: "trivial", reason: "trivial → local", lean: true };

  // 3) Hard — heavy reasoning, or a long message.
  if (HARD_RE.test(m) || m.length > 280) return { klass: "hard", reason: "hard → deep (free)", lean: false };

  // 4) Everything else — standard.
  return { klass: "standard", reason: "standard → free", lean: false };
}

// Map a class to the tier + lane, respecting an explicit user choice and free-first doctrine.
//  · An explicit user tier (Best/Private/etc.) always wins.
//  · Premium is used for "hard" ONLY when the user opted in (allowPremium) — otherwise the
//    strong FREE deep lane handles it. This keeps average cost DOWN, never up (Rule 2).
export interface RouteOpts { userTier?: Tier; allowPremium?: boolean }
export interface Route { tier: Tier; lane: Lane; klass: ReqClass; reason: string; lean: boolean }

export function route(message: string, opts: RouteOpts = {}): Route {
  const v = classify(message);
  const laneFor = (): Lane => (v.klass === "hard" || v.klass === "needs-tools") ? "deep" : "fast";

  // Explicit user pick overrides the cascade (they asked for a specific brain).
  if (opts.userTier) {
    return { tier: opts.userTier, lane: laneFor(), klass: v.klass, reason: `${v.reason} · user:${opts.userTier}`, lean: v.lean && opts.userTier === "local" };
  }
  let tier: Tier;
  switch (v.klass) {
    case "trivial": tier = "local"; break;
    case "hard": tier = opts.allowPremium ? "premium" : "free"; break;
    default: tier = "free";   // standard + needs-tools
  }
  return { tier, lane: laneFor(), klass: v.klass, reason: v.reason, lean: v.lean };
}

// ── WRONG-TIER SELF-CHECK ── a lightweight, model-free check on a cheap answer.
// If it looks truncated / refused / empty / echoed, the caller escalates ONE tier and
// the user sees the good answer, never the retry. Conservative on purpose — a false
// "failed" only costs one extra call; a false "passed" ships a bad answer.
const REFUSAL_RE = /\b(i (can'?t|cannot|am unable to|won'?t)\s+(help|assist|do that|answer)|i'?m sorry,? but|as an ai\b)/i;
const BRAIN_ERROR_RE = /couldn'?t reach a brain|free lane may be briefly busy|try again in a moment/i;

export function selfCheckFailed(answer: string, question = ""): boolean {
  const a = (answer || "").trim();
  if (a.length < 8) return true;                       // empty / near-empty
  if (BRAIN_ERROR_RE.test(a)) return true;             // the fallback "no brain" message
  if (REFUSAL_RE.test(a)) return true;                 // refused a (benign) request
  if (question && a.toLowerCase() === question.trim().toLowerCase()) return true;   // just echoed the prompt
  // Truncated: long answer that ends mid-sentence (no terminal punctuation / closing).
  if (a.length > 400 && !/[.!?"'`)\]}\n]$/.test(a) && !/```/.test(a.slice(-8))) return true;
  return false;
}

// The next tier up the cascade for escalation. Premium is only offered when allowed
// (free-first: we don't silently spend real money unless the user opted into premium).
export function nextTierUp(tier: Tier, allowPremium: boolean): Tier | null {
  if (tier === "local") return "free";
  if (tier === "free") return allowPremium ? "premium" : null;
  return null;   // already premium (or no higher rung)
}
