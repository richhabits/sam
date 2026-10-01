// ─────────────────────────────────────────────────────────────
//  S.A.M. · MODEL DISCOVERY — keep each free lane pointed at a model that still exists.
//
//  Retired slugs have broken SAM repeatedly (cerebras llama-3.3-70b, openrouter's withdrawn :free
//  slug, groq llama-3.3-70b-versatile — see the AUDITED notes in model-providers.ts): the lane
//  answered 404 on every turn until a human edited a constant. Once a day this asks each provider's
//  OWN model-LIST endpoint (never a completion — discovery spends zero tokens and zero credit) what
//  free chat models exist, caches the catalogue in ${VAULT_DIR}/model-catalogue.json, and if the
//  configured model has disappeared, switches the lane to the best listed replacement.
//
//  ⚠️ BOUNDARY: discovery only READS model lists with keys the owner already added (or public list
//  endpoints). It never creates accounts or keys, never calls a paid endpoint, and never calls a
//  completion endpoint. OpenRouter is the only list that carries prices, and anything not priced at
//  exactly zero is filtered out; the other providers' lists are what that key's free tier serves.
//
//  Opt out with SAM_MODEL_DISCOVERY=0.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic.ts";
import { peekKey } from "./keys.ts";
import { configuredModel, laneModel, setLaneModel } from "./model-providers.ts";

// Not chat: embeddings, speech, guards, rerankers, image/video generators, OCR.
const NON_CHAT = /(embed|whisper|tts|speech|transcri|audio|guard|moderation|rerank|ocr|image-gen|-image|imagen|veo|playai|orpheus|bge-|nv-embed|clip|parse|retriever)/i;

type Json = any;   // provider list payloads — parsed defensively below
export interface DiscoverySource {
  id: string;
  url: string;
  headers: (key: string) => Record<string, string>;
  /** The provider's currently FREE chat models, from its own list payload. */
  parse: (body: Json) => string[];
  /** Replacement preference when the configured model disappears (first match wins). */
  prefer: RegExp[];
}

const isZero = (v: unknown) => v !== undefined && v !== null && v !== "" && Number(v) === 0;
const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
const ids = (body: Json): string[] => (Array.isArray(body?.data) ? body.data : []).map((m: Json) => m?.id).filter((x: unknown): x is string => typeof x === "string");

export const SOURCES: DiscoverySource[] = [
  {
    id: "openrouter", url: "https://openrouter.ai/api/v1/models", headers: bearer,
    // Free = every listed price is zero AND the slug is a `:free` variant; output must include text.
    parse: (b) => (Array.isArray(b?.data) ? b.data : [])
      .filter((m: Json) => typeof m?.id === "string" && m.id.endsWith(":free")
        && isZero(m?.pricing?.prompt) && isZero(m?.pricing?.completion)
        && (m?.pricing?.request === undefined || isZero(m.pricing.request))
        && (!Array.isArray(m?.architecture?.output_modalities) || m.architecture.output_modalities.includes("text")))
      .map((m: Json) => m.id as string),
    prefer: [/nemotron.*super/i, /gpt-oss-120b/i, /deepseek/i, /qwen3/i, /llama-3\.3-70b/i],
  },
  {
    id: "groq", url: "https://api.groq.com/openai/v1/models", headers: bearer,
    parse: (b) => (Array.isArray(b?.data) ? b.data : []).filter((m: Json) => m?.active !== false).map((m: Json) => m?.id).filter((x: unknown): x is string => typeof x === "string" && !NON_CHAT.test(x)),
    prefer: [/gpt-oss-120b/i, /llama-3\.3-70b/i, /kimi/i, /qwen/i, /gpt-oss/i],
  },
  {
    id: "cerebras", url: "https://api.cerebras.ai/v1/models", headers: bearer,
    parse: (b) => ids(b).filter((x) => !NON_CHAT.test(x)),
    prefer: [/gpt-oss-120b/i, /glm/i, /qwen/i, /llama/i],
  },
  {
    id: "mistral", url: "https://api.mistral.ai/v1/models", headers: bearer,
    parse: (b) => (Array.isArray(b?.data) ? b.data : [])
      .filter((m: Json) => typeof m?.id === "string" && m?.capabilities?.completion_chat !== false && !m?.deprecation && !NON_CHAT.test(m.id))
      .map((m: Json) => m.id as string),
    prefer: [/^mistral-small-latest$/, /mistral-small/i, /mistral-medium/i, /mistral-large/i],
  },
  {
    id: "nvidia", url: "https://integrate.api.nvidia.com/v1/models", headers: bearer,
    parse: (b) => ids(b).filter((x) => !NON_CHAT.test(x)),
    prefer: [/llama-3\.3-70b-instruct/i, /nemotron.*super/i, /gpt-oss-120b/i, /llama.*70b/i],
  },
  {
    // The key goes in a header, never the URL (URLs end up in logs).
    id: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", headers: (key) => ({ "x-goog-api-key": key }),
    // Free tier covers the Flash family; Pro models are not reliably free, so they are never chosen.
    parse: (b) => (Array.isArray(b?.models) ? b.models : [])
      .filter((m: Json) => typeof m?.name === "string" && Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m: Json) => String(m.name).replace(/^models\//, ""))
      .filter((x: string) => /flash/i.test(x) && !NON_CHAT.test(x) && !/live|thinking-exp/i.test(x)),
    prefer: [/^gemini-2\.5-flash$/, /^gemini-\d+(\.\d+)?-flash$/, /^gemini-\d+(\.\d+)?-flash-latest$/, /flash-lite$/],
  },
];

export function pickReplacement(models: string[], prefer: RegExp[]): string | null {
  for (const re of prefer) { const hit = models.find((m) => re.test(m)); if (hit) return hit; }
  return models[0] ?? null;
}

export interface CatalogueEntry {
  models: string[];
  discoveredAt: string;
  configured: string;     // the slug configured when this was discovered (env pin or default)
  active: string;         // what the lane runs now
  replaced: boolean;      // true when `configured` had disappeared and `active` is the stand-in
}
export interface Catalogue { v: 1; providers: Record<string, CatalogueEntry> }

const vaultDir = () => process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
export const catalogueFile = () => join(vaultDir(), "model-catalogue.json");

let cache: Catalogue | null = null;
function loadCatalogue(): Catalogue {
  if (cache) return cache;
  cache = { v: 1, providers: {} };
  try {
    if (existsSync(catalogueFile())) {
      const d = JSON.parse(readFileSync(catalogueFile(), "utf8"));
      if (d?.v === 1 && d.providers && typeof d.providers === "object") cache = d;
    }
  } catch { /* corrupt cache → rediscover */ }
  return cache as Catalogue;
}
export function modelDiscoveredAt(id: string): string | null { return loadCatalogue().providers[id]?.discoveredAt ?? null; }
export function catalogue(): Catalogue { return JSON.parse(JSON.stringify(loadCatalogue())); }

/** Re-apply cached replacements at boot, but only while the configuration they were made against is
 *  unchanged — a slug the owner pinned AFTER the cache was written always wins. */
export function applyCachedOverrides(): void {
  for (const [id, e] of Object.entries(loadCatalogue().providers)) {
    if (e.replaced && e.configured === configuredModel(id)) setLaneModel(id, e.active);
  }
}

export interface DiscoverDeps {
  fetch?: typeof fetch;
  key?: (provider: string) => string | null;
  now?: () => Date;
  log?: (msg: string) => void;
}

/** One discovery pass over every source the owner has a key for. List endpoints only. */
export async function discoverModels(deps: DiscoverDeps = {}): Promise<Record<string, CatalogueEntry | { error: string }>> {
  const f = deps.fetch ?? fetch;
  const key = deps.key ?? peekKey;
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? ((m: string) => console.log(`  model discovery · ${m}`));
  const cat = loadCatalogue();
  const out: Record<string, CatalogueEntry | { error: string }> = {};
  for (const src of SOURCES) {
    const k = key(src.id);
    if (!k) continue;   // no key → this lane is not in use; nothing to discover
    const configured = configuredModel(src.id);
    if (!configured) continue;
    try {
      const r = await f(src.url, { headers: src.headers(k), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) { out[src.id] = { error: `http ${r.status}` }; continue; }
      const models = [...new Set(src.parse(await r.json()))].sort().slice(0, 300);
      // An empty or failed list proves nothing — keep whatever the lane runs now.
      if (models.length === 0) { out[src.id] = { error: "empty list" }; continue; }
      let active = configured, replaced = false;
      if (!models.includes(configured)) {
        const pick = pickReplacement(models, src.prefer);
        if (pick) { active = pick; replaced = true; }
      }
      if (laneModel(src.id) !== active) log(`${src.id}: ${replaced ? `"${configured}" is no longer listed → using "${active}"` : `back on "${active}"`}`);
      setLaneModel(src.id, replaced ? active : null);
      const entry: CatalogueEntry = { models, discoveredAt: now.toISOString(), configured, active, replaced };
      cat.providers[src.id] = entry;
      out[src.id] = entry;
    } catch (e) {
      out[src.id] = { error: (e as Error)?.message || "fetch failed" };
    }
  }
  try { writeFileAtomic(catalogueFile(), JSON.stringify(cat), { mode: 0o600 }); } catch { /* best-effort */ }
  return out;
}

export const DISCOVERY_EVERY_MS = 24 * 3600 * 1000;
export function discoveryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SAM_MODEL_DISCOVERY !== "0";
}

let timer: NodeJS.Timeout | null = null;
/** Boot hook: re-apply cached replacements now, rediscover shortly after boot if the cache is a day
 *  old (or missing), then once a day. Timers are unref'd so they never hold the process open. */
export function startModelDiscovery(): void {
  if (!discoveryEnabled() || timer) return;
  applyCachedOverrides();
  const stamps = Object.values(loadCatalogue().providers).map((e) => Date.parse(e.discoveredAt)).filter((n) => !Number.isNaN(n));
  const age = stamps.length ? Date.now() - Math.min(...stamps) : Number.POSITIVE_INFINITY;
  const run = () => { void discoverModels().catch(() => {/* best-effort — the lanes keep their current model */}); };
  if (age >= DISCOVERY_EVERY_MS) setTimeout(run, 30_000).unref?.();
  timer = setInterval(run, DISCOVERY_EVERY_MS);
  timer.unref?.();
}

/** Test helper. */
export function _resetDiscovery(): void { cache = null; if (timer) clearInterval(timer); timer = null; }
