// ─────────────────────────────────────────────────────────────
//  S.A.M. · KNOWN FREE QUOTAS — what each free lane's provider DOCUMENTS as its limit.
//
//  ⚠️ BOUNDARY (non-negotiable, applies to everything built on this table): SAM stays INSIDE these
//  limits. It never creates provider accounts, signs up, scrapes or farms keys, uses temporary
//  emails/phone numbers, or rotates IPs/identities to get past a per-account limit. "More capacity"
//  only ever means more FREE MODELS and LANES that the owner's own keys (or genuinely keyless
//  endpoints) already allow, and smarter failover between them. Rotating between several keys the
//  owner added for the same provider is fine (KeyPool); creating keys is not.
//
//  Numbers are per KEY/ACCOUNT on the provider's free tier, for the model SAM defaults that lane to,
//  as published on the cited page when checked (2026-10-01). `null` = the provider does not publish
//  that number (or only shows it inside the logged-in console) — unknown, so never enforced, and the
//  429 + Retry-After path in keys.ts remains the backstop. Several providers (Groq, Cerebras) apply
//  limits per ORGANISATION: two keys from the same org share one budget, so the per-slot ledger can
//  under-count; that is exactly when a 429 arrives and its Retry-After sets the cooldown precisely.
// ─────────────────────────────────────────────────────────────

export interface FreeQuota {
  rpm: number | null;   // requests per minute
  rpd: number | null;   // requests per day
  tpm: number | null;   // tokens per minute
  tpd: number | null;   // tokens per day
  source: string;       // the docs page the numbers come from
}

export const FREE_QUOTAS: Record<string, FreeQuota> = {
  // openai/gpt-oss-120b, free plan: 30 RPM · 1K RPD · 8K TPM · 200K TPD.
  groq: { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200_000, source: "https://console.groq.com/docs/rate-limits" },
  // gpt-oss-120b, free trial: 5 RPM · 30K uncached TPM (90K total) · 1M TPH · 1M TPD. No RPD published.
  cerebras: { rpm: 5, rpd: null, tpm: 30_000, tpd: 1_000_000, source: "https://inference-docs.cerebras.ai/support/rate-limits" },
  // `:free` variants: 20 RPM; 50 RPD below 10 credits purchased (1000 RPD at ≥10). The lower,
  // conservative figure — an account with credits just gets a 429 later than it could have.
  openrouter: { rpm: 20, rpd: 50, tpm: null, tpd: null, source: "https://openrouter.ai/docs/api-reference/limits" },
  // Anonymous tier: "one request every 15 seconds" → 4 RPM, shared by all three pollinations lanes.
  pollinations: { rpm: 4, rpd: null, tpm: null, tpd: null, source: "https://github.com/pollinations/pollinations/blob/master/APIDOCS.md" },
  // Gemini: "Rate limits … can be viewed in Google AI Studio" — not published on the docs page.
  gemini: { rpm: null, rpd: null, tpm: null, tpd: null, source: "https://ai.google.dev/gemini-api/docs/rate-limits" },
  // Mistral's free (Experiment) tier limits are shown per workspace in the console, not in public docs.
  mistral: { rpm: null, rpd: null, tpm: null, tpd: null, source: "https://admin.mistral.ai/plateforme/limits" },
  codestral: { rpm: null, rpd: null, tpm: null, tpd: null, source: "https://admin.mistral.ai/plateforme/limits" },
  // NVIDIA's API catalog is credit-based for trial accounts; no per-minute figure is published.
  nvidia: { rpm: null, rpd: null, tpm: null, tpd: null, source: "https://docs.api.nvidia.com/nim/reference/models-1" },
};

/** Lanes that draw on ONE shared budget are accounted under one id (all pollinations lanes hit the
 *  same anonymous per-IP limit). Everything else is its own group. */
export function quotaGroup(providerId: string): string {
  return providerId.startsWith("pollinations") ? "pollinations" : providerId;
}

export function quotaFor(providerId: string): FreeQuota | null {
  return FREE_QUOTAS[quotaGroup(providerId)] ?? null;
}

/** Skip a key slot once it has used this fraction of any known window. */
export const SKIP_AT = 0.9;
