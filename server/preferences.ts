// ─────────────────────────────────────────────────────────────
//  S.A.M. · PREFERENCE MEMORY  (v1.8 — SAM learns you, 100% on-device)
//
//  Durable patterns SAM notices about how YOU work — a preferred brain, formats you reach for, defaults
//  you keep picking. Stored ONLY in your local vault, fully inspectable and deletable in the "What SAM
//  has learned about you" pane.
//
//  PRIVACY INVARIANT (loud, and tested): learned state NEVER leaves the device. It is never sent to any
//  brain provider or the gateway, and never used as training data. That's enforced structurally: this
//  module only ever (a) reads/writes the local file and (b) returns DERIVED LOCAL DECISIONS — which brain
//  tier to route to, a value to pre-fill a field with. It exposes NO function that turns your profile
//  into prompt text. Personalisation happens by SAM adjusting its OWN local behaviour, not by telling a
//  model who you are. If a personalisation can't be done without transmitting the profile, we don't do it.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tier } from "./models.ts";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "preferences.json");

export interface Preference { key: string; value: string; confidence: number; count: number; learnedAt: string; updatedAt: string }

function read(): Preference[] {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []; } catch { return []; }
}
function write(list: Preference[]) { try { mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(list, null, 2)); } catch { /* best-effort */ } }

// Record a durable signal. Same key+value ⇒ confidence climbs (up to 1); a changed value resets it —
// SAM adapts to your latest habit, not your oldest. `at` is injected so this stays pure + testable.
export function learnPreference(key: string, value: string, at: string): Preference {
  const list = read();
  const k = String(key).slice(0, 60), v = String(value).slice(0, 200);
  const existing = list.find((p) => p.key === k);
  if (existing && existing.value === v) {
    existing.count += 1; existing.confidence = Math.min(1, existing.confidence + 0.2); existing.updatedAt = at;
  } else if (existing) {
    existing.value = v; existing.count = 1; existing.confidence = 0.2; existing.updatedAt = at;
  } else {
    list.push({ key: k, value: v, confidence: 0.2, count: 1, learnedAt: at, updatedAt: at });
  }
  write(list);
  return read().find((p) => p.key === k)!;
}

// ── Inspect / delete / reset — the user is always in control ──
export function listPreferences(): Preference[] { return read(); }
export function getPreference(key: string): Preference | null { return read().find((p) => p.key === key) || null; }
export function forgetPreference(key: string): boolean {
  const list = read(); const next = list.filter((p) => p.key !== key);
  if (next.length === list.length) return false;
  write(next); return true;
}
export function resetPreferences(): void { write([]); }

// ── DERIVED LOCAL DECISIONS (never transmitted) ──
// A learned brain-tier preference, only trusted once it's stable (confidence ≥ 0.6). Returns a local
// routing choice — no profile data goes anywhere.
export function preferredTier(fallback: Tier): Tier {
  const p = getPreference("preferred-tier");
  if (p && p.confidence >= 0.6 && ["local", "free", "premium"].includes(p.value)) return p.value as Tier;
  return fallback;
}
// Pre-fill a field from what you usually pick. Local UI convenience; always overridable.
export function smartDefault(field: string, fallback = ""): string {
  const p = getPreference(`default:${field}`);
  return p && p.confidence >= 0.6 ? p.value : fallback;
}
