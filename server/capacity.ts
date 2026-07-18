// ─────────────────────────────────────────────────────────────
//  S.A.M. · CAPACITY  — SAM manages its own free-tier AI capacity.
//  It watches the key pools, knows when free capacity is running
//  thin, and points you at ONE legit provider to top up (you create
//  the account — per each provider's ToS; SAM never farms them).
//  Local (Ollama) is always the unlimited, key-free fallback.
// ─────────────────────────────────────────────────────────────

import { keyStatus } from "./keys.ts";

// Free-tier providers, best-first (speed + generosity). Each links to its OWN legit
// signup page — SAM points you there, you create the account. One account per provider.
export const FREE_PROVIDERS: { id: string; label: string; url: string; note: string }[] = [
  { id: "cerebras",   label: "Cerebras",      url: "https://cloud.cerebras.ai",              note: "blazing fast · 70B" },
  { id: "groq",       label: "Groq",          url: "https://console.groq.com/keys",          note: "fastest · generous" },
  { id: "nvidia",     label: "NVIDIA",        url: "https://build.nvidia.com",               note: "capable 70B · generous" },
  { id: "gemini",     label: "Gemini",        url: "https://aistudio.google.com/apikey",     note: "multimodal (photos)" },
  { id: "openrouter", label: "OpenRouter",    url: "https://openrouter.ai/keys",             note: "many models, one key" },
  { id: "mistral",    label: "Mistral",       url: "https://console.mistral.ai/api-keys",    note: "capable" },
  { id: "github",     label: "GitHub Models", url: "https://github.com/settings/tokens",     note: "free with a GitHub token" },
];

export type CapacityLevel = "ample" | "ok" | "low" | "none";
export interface CapacityReport {
  level: CapacityLevel;
  configured: number;   // free providers with ≥1 key
  freeKeys: number;     // total free keys pooled
  healthy: number;      // free keys usable right now (not cooling)
  cooling: number;      // free keys rate-limited/cooling
  nextToAdd: { id: string; label: string; url: string; note: string } | null;
  /** Minutes until the first rate-limited key frees up (0 = nothing cooling, null = unknown). */
  waitMinutes: number | null;
  headline: string;
}

/** "in 4 min" / "in about an hour" — a wait you can act on, not a raw timestamp. */
function humanWait(mins: number | null): string {
  if (mins === null || mins <= 0) return "";
  if (mins < 2) return "in under a minute";
  if (mins < 60) return `in ~${Math.round(mins)} min`;
  const h = mins / 60;
  return h < 2 ? "in about an hour" : `in ~${Math.round(h)} hours`;
}

// Compute capacity purely from the live key-pool health (keys.ts). No network.
export function capacityReport(): CapacityReport {
  const byId = new Map(keyStatus().map((s) => [s.provider, s]));
  const free = FREE_PROVIDERS.map((p) => byId.get(p.id)).filter(Boolean) as ReturnType<typeof keyStatus>;
  const configured = free.filter((s) => s.total > 0).length;
  const freeKeys = free.reduce((a, s) => a + s.total, 0);
  const healthy = free.reduce((a, s) => a + s.healthy, 0);
  const cooling = free.reduce((a, s) => a + s.cooling, 0);
  const nextToAdd = FREE_PROVIDERS.find((p) => !(byId.get(p.id)?.total)) || null;

  // keys.ts already knows when the soonest rate-limited key frees up — it was computed and then
  // consumed by nothing, so SAM could say "everything is cooling" but never "back in 4 minutes".
  // Waiting is often the right answer and it costs nothing; without this the only advice we
  // could give was "add another key", which pushes people to sign up for something they may not
  // need. Two real options beat one.
  const coolingUntils = free.map((s) => (s as { coolingUntil?: number }).coolingUntil || 0).filter((t) => t > Date.now());
  const waitMinutes = coolingUntils.length ? (Math.min(...coolingUntils) - Date.now()) / 60000 : null;

  let level: CapacityLevel;
  if (configured === 0) level = "none";
  else if (healthy === 0) level = "low";                       // everything's cooling / rate-limited
  else if (configured >= 2 && healthy >= 2) level = "ample";
  else level = "ok";                                           // only one provider carrying the load

  const headline =
    level === "none" ? "No free AI key yet — SAM is running local-only (needs Ollama, else it can't think)."
    : level === "low" ? `Free capacity is maxed out right now — every key is rate-limited${humanWait(waitMinutes) ? `, back ${humanWait(waitMinutes)}` : ""}.`
    : level === "ok"  ? "Free capacity is thin — one provider is carrying the load."
    : "Free capacity looks healthy.";

  return { level, configured, freeKeys, healthy, cooling, nextToAdd, waitMinutes, headline };
}

// A short, actionable nudge — ONLY when adding a key would actually help (low/none).
// Returns null when capacity is fine (so SAM never nags for no reason).
export function capacityNudge(): string | null {
  const r = capacityReport();
  if (r.level === "ample" || r.level === "ok") return null;
  const add = r.nextToAdd;
  // If everything is merely COOLING, waiting is a real option and costs nothing — lead with it.
  // Telling someone to go and sign up for another service when their key frees up in four
  // minutes is bad advice dressed as helpfulness.
  const waiting = r.waitMinutes !== null && r.waitMinutes > 0 && r.freeKeys > 0;
  const tip = waiting
    ? ` Wait it out, or add another free key in Settings → API keys${add ? ` (${add.label} is a good next one)` : ""}.`
    : add
    ? ` Grab a free ${add.label} key (${add.note}) — ${add.url} — and paste it in Settings → API keys (60s).`
    : " Add another free key in Settings → API keys, or start Ollama for unlimited local.";
  return `${r.headline}${tip}`;
}
