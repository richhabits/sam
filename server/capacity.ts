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
  headline: string;
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

  let level: CapacityLevel;
  if (configured === 0) level = "none";
  else if (healthy === 0) level = "low";                       // everything's cooling / rate-limited
  else if (configured >= 2 && healthy >= 2) level = "ample";
  else level = "ok";                                           // only one provider carrying the load

  const headline =
    level === "none" ? "No free AI key yet — SAM is running local-only (needs Ollama, else it can't think)."
    : level === "low" ? "Free capacity is maxed out right now — every key is rate-limited/cooling."
    : level === "ok"  ? "Free capacity is thin — one provider is carrying the load."
    : "Free capacity looks healthy.";

  return { level, configured, freeKeys, healthy, cooling, nextToAdd, headline };
}

// A short, actionable nudge — ONLY when adding a key would actually help (low/none).
// Returns null when capacity is fine (so SAM never nags for no reason).
export function capacityNudge(): string | null {
  const r = capacityReport();
  if (r.level === "ample" || r.level === "ok") return null;
  const add = r.nextToAdd;
  const tip = add
    ? ` Grab a free ${add.label} key (${add.note}) — ${add.url} — and paste it in Settings → API keys (60s).`
    : " Add another free key in Settings → API keys, or start Ollama for unlimited local.";
  return `⚡ ${r.headline}${tip}`;
}
