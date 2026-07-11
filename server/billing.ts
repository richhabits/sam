// ─────────────────────────────────────────────────────────────
//  S.A.M. · BILLING  (v2.0 — the business layer, OFF by default, operator's decision)
//
//  How SAM could fund itself WITHOUT betraying free/local/private. Ships behind SAM_BILLING (OFF) and is
//  inert until the operator turns it on. The sacred rule, enforced by a typed-false tripwire + tests:
//    ► BILLING NEVER GATES CORE. `coreGated()` is `false`, forever. Everything SAM does today stays free.
//  Paid plans only unlock OPTIONAL extras that cost the operator money or that only some users want:
//    • supporter — badge / priority pack curation / early features (funds the project, paywalls nothing)
//    • cloud     — SAM Cloud: higher hosted-gateway limits for people who don't want keys/Ollama
//    • team      — SAM Teams (future): shared packs/workflows, org registry, admin (scaffold only)
//  Entitlement is stored locally; a real deployment verifies it against Stripe. See docs/BUSINESS.md.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "entitlement.json");

export type Plan = "free" | "supporter" | "cloud" | "team";
export const PLANS: { id: Plan; label: string; priceUsdMonthly: number; blurb: string }[] = [
  { id: "free", label: "Free", priceUsdMonthly: 0, blurb: "Everything SAM does. Local, private, yours. Forever." },
  { id: "supporter", label: "Supporter", priceUsdMonthly: 5, blurb: "Fund a free, private tool. Badge, priority pack review, early features. Paywalls nothing." },
  { id: "cloud", label: "SAM Cloud", priceUsdMonthly: 8, blurb: "Zero-setup hosted brains with higher daily limits — for when you don't want keys or Ollama. A generous free tier stays below it." },
  { id: "team", label: "SAM Teams", priceUsdMonthly: 0, blurb: "Shared packs + workflows, org registry, admin. (Coming later.)" },
];

export function billingEnabled(): boolean { return process.env.SAM_BILLING === "1"; }

interface Entitlement { plan: Plan; active: boolean; since?: string; customerId?: string }
function read(): Entitlement {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")); } catch { /* ignore */ }
  return { plan: "free", active: true };
}
function write(e: Entitlement) { try { mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(e, null, 2)); } catch { /* best-effort */ } }

// The user's current plan. Everyone is "free" (fully functional) unless billing is on AND they hold an
// active paid entitlement. Absence of a paid plan NEVER reduces functionality.
export function currentPlan(): Plan {
  if (!billingEnabled()) return "free";
  const e = read();
  return e.active ? e.plan : "free";
}

// ── THE TRIPWIRE — core is never behind billing. If anyone makes this true to paywall a feature, the
// test fails and the type breaks. This is the load-bearing guarantee of the whole business model. ──
export function coreGated(): false { return false; }

// Optional-extra gates. These may ONLY guard things that are not core function (higher cloud limits,
// team features). They default to the free behaviour when billing is off.
export function hasCloudBoost(): boolean { return billingEnabled() && (currentPlan() === "cloud" || currentPlan() === "team"); }
export function hasTeamFeatures(): boolean { return billingEnabled() && currentPlan() === "team"; }
export function isSupporter(): boolean { return billingEnabled() && currentPlan() !== "free"; }

// Stripe checkout scaffold. Real deployment plugs a Stripe price id + secret (server-side, loopback
// only) and returns a Checkout Session URL; here it returns the shape + an honest, non-manipulative
// upgrade message. No secret ships; nothing charges until the operator wires Stripe + flips the flag.
export function checkout(plan: Plan): { ok: boolean; plan: Plan; url: string | null; message: string; reason?: string } {
  if (!billingEnabled()) return { ok: false, plan, url: null, message: "", reason: "billing is off — SAM is free" };
  const p = PLANS.find((x) => x.id === plan);
  if (!p || plan === "free" || plan === "team") return { ok: false, plan, url: null, message: "", reason: "not a purchasable plan yet" };
  return {
    ok: true, plan, url: null,   // a wired deployment fills this with a Stripe Checkout Session URL
    message: `You're supporting a free, private tool — thank you. $${p.priceUsdMonthly}/mo, cancel anytime. This unlocks ${plan === "cloud" ? "higher hosted limits" : "supporter perks"}; it never unlocks anything that was already free.`,
  };
}

// Local entitlement setter (a real deployment writes this from a verified Stripe webhook).
export function setEntitlement(plan: Plan, active: boolean, at: string): void { write({ plan, active, since: at }); }

export function billingStatus() {
  return { enabled: billingEnabled(), plan: currentPlan(), coreGated: coreGated(), plans: PLANS };
}
