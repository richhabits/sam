// ─────────────────────────────────────────────────────────────
//  S.A.M. · SUPPORTER  (v1.8 — optional, OFF by default, operator's decision)
//
//  A scaffold for a way SAM could fund itself WITHOUT compromising the promise. Ships OFF (behind the
//  SAM_SUPPORTER flag) and is inert until the operator chooses to enable it. Hard rules, enforced here:
//    1. It NEVER paywalls a core feature — `coreFeatureGated()` is a compile-time `false` tripwire.
//    2. It NEVER adds telemetry — this module sends nothing, anywhere.
//    3. Supporter perks are only OPTIONAL extras (e.g. higher hosted-gateway limits, priority pack
//       curation) — things that cost the operator money to provide, never things SAM already does locally.
//  See docs/SUPPORTER.md for the model. This is a placeholder the operator can wire to a real check later.
// ─────────────────────────────────────────────────────────────

export function supporterEnabled(): boolean { return process.env.SAM_SUPPORTER === "1"; }

export interface SupporterStatus { enabled: boolean; tier: "free" | "supporter"; note: string }

export function supporterStatus(): SupporterStatus {
  const on = supporterEnabled();
  return {
    enabled: on,
    tier: on ? "supporter" : "free",
    note: "Core SAM is free, local and private forever. Supporter only unlocks optional hosted extras — never core function, never telemetry.",
  };
}

// TRIPWIRE: core function is gated by NOTHING in this module. If anyone ever makes this return true to
// paywall a feature, the supporter.test.ts assertion fails — a deliberate guard on the free-forever promise.
export function coreFeatureGated(): false { return false; }
