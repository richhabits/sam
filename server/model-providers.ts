import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getKey } from "./keys.ts";
import { collapseRepetition, isDegenerateRepetition } from "./repetition.ts";
export type Tier = "local" | "free" | "premium";


export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

// ── SAM Cloud gateway (OPTIONAL hosted free tier — OFF unless SAM_GATEWAY_URL is set at build) ──
// Anonymous per-install device id (random, no personal data) so the gateway can meter fairly.
export const GATEWAY_URL = process.env.SAM_GATEWAY_URL || "";
export const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
export let _deviceId = "";
export function deviceId(): string {
  if (_deviceId) return _deviceId;
  const f = join(VAULT_DIR, ".device-id");
  try { _deviceId = readFileSync(f, "utf8").trim(); } catch { /* first run */ }
  if (!_deviceId) { _deviceId = randomBytes(12).toString("hex"); try { writeFileSync(f, _deviceId); } catch { /* read-only fs — ephemeral id is fine */ } }
  return _deviceId;
}
export async function callGateway(system: string, prompt: string): Promise<string> {
  const r = await fetch(`${GATEWAY_URL}/v1/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: deviceId(), messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`gateway ${r.status}`);
  const d: any = await r.json();
  return d?.choices?.[0]?.message?.content || "";
}

// ── LOCAL · Ollama (free, on your machine) ───────────────────
export async function callOllama(system: string, prompt: string, model = OLLAMA_MODEL, format?: unknown): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal: AbortSignal.timeout(300000), // 5 minute timeout for cold starts
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      // THE GRAMMAR: when a schema is supplied, Ollama constrains every sampled token to it, so a
      // malformed / hallucinated tool call cannot be produced. Omitted → unconstrained, unchanged.
      ...(format ? { format } : {}),
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const data = await res.json();
  return data?.message?.content?.trim() || "";
}

// Pre-load the local Ollama model into RAM at boot so the FIRST message doesn't pay the
// multi-second cold model-load. Free + local + best-effort — we NEVER spend cloud quota to
// warm up. `prompt:""` loads the model without generating; keep_alive holds it resident.
export async function warmBrain(): Promise<string | null> {
  try {
    const tags = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1200) });
    if (!tags.ok) return null;   // Ollama not running — nothing to warm (cloud stays cold by design)
    // Only warm a model that's actually pulled, so we never falsely claim it's resident.
    const models: string[] = ((await tags.json())?.models || []).map((m: any) => m?.name).filter(Boolean);
    const target = models.includes(OLLAMA_MODEL) ? OLLAMA_MODEL : models[0];
    if (!target) return null;    // Ollama up but no models pulled — nothing to load
    void fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: target, prompt: "", keep_alive: "30m" }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => {/* best-effort — nothing downstream depends on this succeeding */});
    return target;
  } catch { return null; }
}

// ── Shared OpenAI-compatible caller (Groq, OpenRouter, OpenAI) ─
export async function callOpenAICompat(
  base: string, model: string, system: string, prompt: string, key: string
): Promise<string> {
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30000),   // never hang forever on a slow/unresponsive provider
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) { const e: any = new Error(`http ${r.status}`); e.status = r.status; throw e; }
  const d = await r.json();
  return d?.choices?.[0]?.message?.content?.trim() || "";
}

// Pollinations anonymous POST caller — folds system into user message and omits generation params
// (max_tokens, temperature) to stay on Pollinations' free anonymous lane without triggering 402 billing gates.
export async function callPollinationsAnon(model: string, system: string, prompt: string): Promise<string> {
  const combined = system ? `${system}\n\n${prompt}` : prompt;
  const r = await fetch("https://text.pollinations.ai/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: combined }],
    }),
  });
  if (!r.ok) { const e: any = new Error(`http ${r.status}`); e.status = r.status; throw e; }
  const d = await r.json();
  return d?.choices?.[0]?.message?.content?.trim() || "";
}

// Pollinations' simple GET endpoint — a DIFFERENT code path/URL to the POST /openai one above, so if
// that endpoint hiccups this independent lane can still answer. Keeps SAM working out of the box.
export async function callPollinationsGet(system: string, prompt: string): Promise<string> {
  const q = `${system}\n\nUser: ${prompt}\nSAM:`.slice(0, 3000);
  const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(q)}?model=openai`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) { const e: any = new Error(`http ${r.status}`); e.status = r.status; throw e; }
  return (await r.text()).trim();
}

// ── FREE · Gemini 2.5 Flash (thinkingBudget 0 — no wasted tokens) ─
export async function callGemini(system: string, prompt: string, key: string): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-2.5-flash:generateContent?key=${key}`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(30000),   // never hang forever on a stalled provider
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 6000, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!r.ok) { const e: any = new Error(`gemini ${r.status}`); e.status = r.status; throw e; }
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  if (!text) throw new Error("gemini empty");
  return text.trim();
}

// ── PREMIUM · Claude (raw fetch — no SDK dependency) ─────────
export async function callAnthropic(system: string, prompt: string, key: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    signal: AbortSignal.timeout(120000),   // 120s timeout for adaptive thinking
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31,computer-use-2024-10-22,server-side-fallback-2026-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      fallbacks: [{ model: "claude-opus-4-8" }],
      // The 4-Point Cache Break: Split the massive system prompt into its logical chunks
      // (Persona, Vault, Tools) so a change in Vault doesn't bust the static Persona/Tools cache.
      system: (() => {
        const blocks: any[] = [];
        const parts = system.split("Here are the tools you can use:");
        if (parts.length === 2) {
          const preTools = parts[0];
          const tools = "Here are the tools you can use:" + parts[1];
          const vaultParts = preTools.split("VAULT (THE MEMORY):");
          if (vaultParts.length === 2) {
            blocks.push({ type: "text", text: vaultParts[0], cache_control: { type: "ephemeral" } });
            blocks.push({ type: "text", text: "VAULT (THE MEMORY):" + vaultParts[1], cache_control: { type: "ephemeral" } });
            blocks.push({ type: "text", text: tools, cache_control: { type: "ephemeral" } });
          } else {
            blocks.push({ type: "text", text: preTools, cache_control: { type: "ephemeral" } });
            blocks.push({ type: "text", text: tools, cache_control: { type: "ephemeral" } });
          }
        } else {
          blocks.push({ type: "text", text: system, cache_control: { type: "ephemeral" } });
        }
        return blocks;
      })(),
      // Also cache the conversation history block for multi-step tool loops
      messages: [{ role: "user", content: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }] }],
    }),
  });
  if (!r.ok) { const e: any = new Error(`anthropic ${r.status}`); e.status = r.status; throw e; }
  const d = await r.json();
  if (d?.stop_reason === "refusal") {
    const e: any = new Error(`anthropic refused (${d?.stop_details?.category || "unspecified"})`);
    e.status = 200; throw e;
  }
  const block = d?.content?.find((b: any) => b.type === "text");
  const text = block?.text?.trim() || "";
  if (!text) throw new Error("anthropic empty");
  return text;
}

// ── PROVIDER REGISTRY — add a line to add a provider ─────────
export interface Provider {
  id: string;
  tier: Tier;
  label: string;
  run: (system: string, prompt: string, key: string) => Promise<string>;
  noKey?: boolean;   // works with no API key at all (e.g. Pollinations) — the never-dry fallback
}

export const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
export const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
export const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
// AUDITED LIVE 2026-08-01 against the providers' own /v1/models. `llama-3.3-70b` was RETIRED by
// Cerebras — every call 404'd `model_not_found`, and because cerebras leads the `fast` lane, that
//404 was the FIRST thing every quick chat did. GET /v1/models now lists exactly
// [zai-glm-4.7, gpt-oss-120b, gemma-4-31b]; gpt-oss-120b answered in 422ms.
export const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "gpt-oss-120b";
export const GITHUB_MODEL = process.env.GITHUB_MODEL || "gpt-4o-mini";
// Same audit: `meta-llama/llama-3.3-70b-instruct:free` no longer exists as a free slug —
// OpenRouter answers 404 and names the PAID slug as the replacement. Of the 14 free slugs live
// today, nemotron-3-super was both the fastest (579ms) and the largest context (262k).
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";
export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ── The "Invincible" Expansion Default Models ──
export const TOGETHER_MODEL = process.env.TOGETHER_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo";
export const SAMBANOVA_MODEL = process.env.SAMBANOVA_MODEL || "Meta-Llama-3.3-70B-Instruct";
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
export const FIREWORKS_MODEL = process.env.FIREWORKS_MODEL || "accounts/fireworks/models/llama-v3p1-70b-instruct";
export const XAI_MODEL = process.env.XAI_MODEL || "grok-beta";
export const HUGGINGFACE_MODEL = process.env.HUGGINGFACE_MODEL || "meta-llama/Llama-3.3-70B-Instruct";
export const HYPERBOLIC_MODEL = process.env.HYPERBOLIC_MODEL || "meta-llama/Meta-Llama-3-70B-Instruct";
export const NOVITA_MODEL = process.env.NOVITA_MODEL || "meta-llama/llama-3.1-70b-instruct";
export const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
export const AI21_MODEL = process.env.AI21_MODEL || "jamba-1.5-large";
export const UPSTAGE_MODEL = process.env.UPSTAGE_MODEL || "solar-1-mini-chat";
export const NEBIUS_MODEL = process.env.NEBIUS_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
export const COHERE_MODEL = process.env.COHERE_MODEL || "command-r-plus-08-2024";
export const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || "llama-3.1-sonar-small-128k-chat";

// ── "Infinite Compute" Global Mesh — Asian Heavyweights ──
export const ALIBABA_MODEL = process.env.ALIBABA_MODEL || "qwen-plus";
export const VOLCENGINE_MODEL = process.env.VOLCENGINE_MODEL || "doubao-1.5-pro-32k";
export const ZHIPU_MODEL = process.env.ZHIPU_MODEL || "glm-5.2";   // Zhipu flagship — 1M context, MIT (20M free tokens on signup; set glm-4-flash for the free-forever tier)
export const HERMES_MODEL = process.env.HERMES_MODEL || "Hermes-4-405B";   // Nous Hermes flagship — open weights, superb agentic/tool-use reasoning (free tier via Nous portal)
export const MOONSHOT_MODEL = process.env.MOONSHOT_MODEL || "kimi-k2.7-code";
// VERIFIED 2026-07-19 against a real key: GET /v1/models on api.moonshot.ai lists exactly
// ["kimi-k2.6", "kimi-k2.7-code"], so the id is right.
//
// The BASE URL was the actual bug. We called api.moonshot.cn, and a key issued on the global
// platform (platform.kimi.ai) gets 401 there — the two platforms are separate accounts, not
// mirrors. Every Kimi call was failing auth and the cascade skipped the brain silently, which
// looks identical to "no key". Default is the global endpoint now; MOONSHOT_BASE_URL overrides
// it for anyone on the mainland-China platform.
export const MOONSHOT_BASE = process.env.MOONSHOT_BASE_URL || "https://api.moonshot.ai/v1";
export const MINIMAX_MODEL = process.env.MINIMAX_MODEL || "abab6.5s-chat";
export const STEPFUN_MODEL = process.env.STEPFUN_MODEL || "step-1-8k";
export const BAIDU_MODEL = process.env.BAIDU_MODEL || "ernie-speed-128k";
export const TENCENT_MODEL = process.env.TENCENT_MODEL || "hunyuan-lite";

// ── Bonus free/free-credit providers (all real, OpenAI-compatible) ──
export const DEEPINFRA_MODEL = process.env.DEEPINFRA_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
export const SCALEWAY_MODEL = process.env.SCALEWAY_MODEL || "llama-3.3-70b-instruct";
export const CHUTES_MODEL = process.env.CHUTES_MODEL || "deepseek-ai/DeepSeek-V3";
export const FRIENDLI_MODEL = process.env.FRIENDLI_MODEL || "meta-llama-3.1-70b-instruct";
export const CODESTRAL_MODEL = process.env.CODESTRAL_MODEL || "codestral-latest";
export const INFERENCE_MODEL = process.env.INFERENCE_MODEL || "meta-llama/llama-3.1-8b-instruct/fp-8";
export const GMI_MODEL = process.env.GMI_MODEL || "meta-llama/Llama-3.3-70B-Instruct";
export const VERCEL_MODEL = process.env.VERCEL_MODEL || "meta/llama-3.3-70b";
export const OVH_MODEL = process.env.OVH_MODEL || "Meta-Llama-3_1-70B-Instruct";
export const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || "openai";

// ═══════════════════════════════════════════════════════════════
//  THE BURN-DOWN ENGINE — 30+ providers, tiered for maximum
//  free throughput. SAM sprays across Tier 1 first (speed),
//  cascades to Tier 2 (bottomless), then Tier 3 (Asian mesh),
//  and only touches Tier 4 (premium paid) as last resort.
// ═══════════════════════════════════════════════════════════════
export const PROVIDERS: Provider[] = [
  // ── TIER 1: Speed Demons (sub-200ms TTFT) ──────────────────
  { id: "cerebras", tier: "free", label: `cerebras:${CEREBRAS_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.cerebras.ai/v1", CEREBRAS_MODEL, s, p, k) },
  { id: "groq", tier: "free", label: `groq:${GROQ_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.groq.com/openai/v1", GROQ_MODEL, s, p, k) },
  { id: "sambanova", tier: "free", label: `sambanova:${SAMBANOVA_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.sambanova.ai/v1", SAMBANOVA_MODEL, s, p, k) },

  // ── TIER 2: Bottomless Wells (huge free quotas) ────────────
  { id: "together", tier: "free", label: `together:${TOGETHER_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.together.xyz/v1", TOGETHER_MODEL, s, p, k) },
  { id: "deepseek", tier: "free", label: `deepseek:${DEEPSEEK_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.deepseek.com", DEEPSEEK_MODEL, s, p, k) },
  { id: "fireworks", tier: "free", label: `fireworks:${FIREWORKS_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.fireworks.ai/inference/v1", FIREWORKS_MODEL, s, p, k) },
  { id: "nvidia", tier: "free", label: `nvidia:${NVIDIA_MODEL}`, run: (s, p, k) => callOpenAICompat("https://integrate.api.nvidia.com/v1", NVIDIA_MODEL, s, p, k) },
  { id: "siliconflow", tier: "free", label: `siliconflow:${SILICONFLOW_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.siliconflow.cn/v1", SILICONFLOW_MODEL, s, p, k) },
  { id: "xai", tier: "free", label: `xai:${XAI_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.x.ai/v1", XAI_MODEL, s, p, k) },
  { id: "huggingface", tier: "free", label: `huggingface:${HUGGINGFACE_MODEL}`, run: (s, p, k) => callOpenAICompat("https://router.huggingface.co/v1", HUGGINGFACE_MODEL, s, p, k) },
  { id: "hyperbolic", tier: "free", label: `hyperbolic:${HYPERBOLIC_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.hyperbolic.xyz/v1", HYPERBOLIC_MODEL, s, p, k) },
  { id: "novita", tier: "free", label: `novita:${NOVITA_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.novita.ai/v3/openai", NOVITA_MODEL, s, p, k) },
  { id: "nebius", tier: "free", label: `nebius:${NEBIUS_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.studio.nebius.ai/v1", NEBIUS_MODEL, s, p, k) },

  // ── TIER 3: Asian Heavyweights (massive free-tier new user quotas) ──
  { id: "alibaba", tier: "free", label: `alibaba:${ALIBABA_MODEL}`, run: (s, p, k) => callOpenAICompat("https://dashscope-intl.aliyuncs.com/compatible-mode/v1", ALIBABA_MODEL, s, p, k) },
  { id: "volcengine", tier: "free", label: `volcengine:${VOLCENGINE_MODEL}`, run: (s, p, k) => callOpenAICompat("https://ark.cn-beijing.volces.com/api/v3", VOLCENGINE_MODEL, s, p, k) },
  { id: "zhipu", tier: "free", label: `zhipu:${ZHIPU_MODEL}`, run: (s, p, k) => callOpenAICompat("https://open.bigmodel.cn/api/paas/v4", ZHIPU_MODEL, s, p, k) },
  // 🪽 Hermes (Nous Research) — open, un-nerfed, elite at agentic tool-use & long reasoning.
  // Reached however you already can, NO new signup required: Nous Portal key → OpenRouter (the
  // 300-model gateway, reuses that key) → local Ollama (free & private). noKey:true so it's always
  // in the running; it self-selects the best available path and only fails if none exist.
  { id: "hermes", tier: "free", noKey: true, label: `hermes:${HERMES_MODEL}`, run: async (s, p, _k) => {
    const nous = getKey("hermes");
    if (nous) return callOpenAICompat("https://inference-api.nousresearch.com/v1", HERMES_MODEL, s, p, nous);
    const orouter = getKey("openrouter");
    if (orouter) return callOpenAICompat("https://openrouter.ai/api/v1", process.env.HERMES_OR_MODEL || "nousresearch/hermes-4-405b", s, p, orouter);
    return callOllama(s, p, process.env.HERMES_LOCAL_MODEL || "hermes3");   // free + private fallback
  } },
  { id: "moonshot", tier: "free", label: `moonshot:${MOONSHOT_MODEL}`, run: (s, p, k) => callOpenAICompat(MOONSHOT_BASE, MOONSHOT_MODEL, s, p, k) },
  { id: "minimax", tier: "free", label: `minimax:${MINIMAX_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.minimax.chat/v1", MINIMAX_MODEL, s, p, k) },
  { id: "stepfun", tier: "free", label: `stepfun:${STEPFUN_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.stepfun.com/v1", STEPFUN_MODEL, s, p, k) },
  { id: "baidu", tier: "free", label: `baidu:${BAIDU_MODEL}`, run: (s, p, k) => callOpenAICompat("https://qianfan.baidubce.com/v2", BAIDU_MODEL, s, p, k) },
  { id: "tencent", tier: "free", label: `tencent:${TENCENT_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.lkeap.cloud.tencent.com/v1", TENCENT_MODEL, s, p, k) },

  // ── TIER 3b: Aggregators & Specialty ───────────────────────
  { id: "ai21", tier: "free", label: `ai21:${AI21_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.ai21.com/studio/v1", AI21_MODEL, s, p, k) },
  { id: "upstage", tier: "free", label: `upstage:${UPSTAGE_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.upstage.ai/v1/solar", UPSTAGE_MODEL, s, p, k) },
  { id: "cohere", tier: "free", label: `cohere:${COHERE_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.cohere.com/v1", COHERE_MODEL, s, p, k) },
  { id: "perplexity", tier: "free", label: `perplexity:${PERPLEXITY_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.perplexity.ai", PERPLEXITY_MODEL, s, p, k) },
  { id: "mistral", tier: "free", label: `mistral:${MISTRAL_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.mistral.ai/v1", MISTRAL_MODEL, s, p, k) },
  // GITHUB MODELS IS BEING RETIRED. Audited 2026-08-01: the old Azure endpoint answers 401, and
  // the current one (models.github.ai/inference) answers HTTP 410 `github_models_retirement_brownout`.
  // It stays listed because GITHUB_TOKEN is still a live credential — the GitHub CONNECTOR reads
  // your repos and issues with it (server/connectors.registry.ts) — but it is no longer a brain
  // anyone should be told to get a key for. The health memory sinks it on its first 410 anyway.
  { id: "github", tier: "free", label: `github:${GITHUB_MODEL}`, run: (s, p, k) => callOpenAICompat("https://models.github.ai/inference", GITHUB_MODEL, s, p, k) },
  { id: "gemini", tier: "free", label: "gemini-2.5-flash", run: callGemini },
  { id: "openrouter", tier: "free", label: `openrouter:${OPENROUTER_MODEL}`, run: (s, p, k) => callOpenAICompat("https://openrouter.ai/api/v1", OPENROUTER_MODEL, s, p, k) },

  // ── TIER 3c: Bonus free brains (opt-in — add a key; tried after the mains) ──
  { id: "deepinfra", tier: "free", label: `deepinfra:${DEEPINFRA_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.deepinfra.com/v1/openai", DEEPINFRA_MODEL, s, p, k) },
  { id: "scaleway", tier: "free", label: `scaleway:${SCALEWAY_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.scaleway.ai/v1", SCALEWAY_MODEL, s, p, k) },
  { id: "chutes", tier: "free", label: `chutes:${CHUTES_MODEL}`, run: (s, p, k) => callOpenAICompat("https://llm.chutes.ai/v1", CHUTES_MODEL, s, p, k) },
  { id: "friendli", tier: "free", label: `friendli:${FRIENDLI_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.friendli.ai/serverless/v1", FRIENDLI_MODEL, s, p, k) },
  { id: "codestral", tier: "free", label: `codestral:${CODESTRAL_MODEL}`, run: (s, p, k) => callOpenAICompat("https://codestral.mistral.ai/v1", CODESTRAL_MODEL, s, p, k) },
  { id: "inference", tier: "free", label: `inference:${INFERENCE_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.inference.net/v1", INFERENCE_MODEL, s, p, k) },
  { id: "gmi", tier: "free", label: `gmi:${GMI_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.gmi-serving.com/v1", GMI_MODEL, s, p, k) },
  { id: "vercel", tier: "free", label: `vercel:${VERCEL_MODEL}`, run: (s, p, k) => callOpenAICompat("https://ai-gateway.vercel.sh/v1", VERCEL_MODEL, s, p, k) },
  { id: "ovh", tier: "free", label: `ovh:${OVH_MODEL}`, run: (s, p, k) => callOpenAICompat("https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", OVH_MODEL, s, p, k) },

  // ── ALWAYS-LAST · never dry: free brains that need NO key at all. SAM works out of the box on
  //    these. Several independent lanes (different models + a different endpoint) so one transient
  //    hiccup can't take the whole no-key path down — there's always another free brain to fall to.
  //
  //    ⚠️ AUDITED 2026-08-01 and no longer the guarantee it reads as. Pollinations' anonymous tier
  //    now answers 402 Payment Required for anything NOVEL — repeated identical prompts still
  //    return 200 because they are served from ITS cache (the same response id came back every
  //    time). Worse, the 402 took up to 24 SECONDS to arrive, so the no-key floor was costing a
  //    keyless user half a minute to say no. Left in place because a cached hit is still a free
  //    answer and the endpoint may re-open, but the health memory demotes it the moment it 402s,
  //    and SAM's real zero-key story is now local Ollama. See docs/FREE-ROUTES.md.
  { id: "pollinations", tier: "free", noKey: true, label: `pollinations:${POLLINATIONS_MODEL}`, run: (s, p) => callPollinationsAnon(POLLINATIONS_MODEL, s, p) },
  { id: "pollinations-fast", tier: "free", noKey: true, label: "pollinations:openai-fast", run: (s, p) => callPollinationsAnon("openai-fast", s, p) },
  { id: "pollinations-get", tier: "free", noKey: true, label: "pollinations:get", run: (s, p) => callPollinationsGet(s, p) },

  // ── TIER 4: Premium (paid, last resort) ────────────────────
  { id: "anthropic", tier: "premium", label: CLAUDE_MODEL, run: callAnthropic },
  { id: "openai", tier: "premium", label: OPENAI_MODEL, run: (s, p, k) => callOpenAICompat("https://api.openai.com/v1", OPENAI_MODEL, s, p, k) },
];
export async function streamOpenAICompat(base: string, model: string, system: string, prompt: string, key: string, onChunk: (t: string) => void): Promise<string> {
  const r = await fetch(`${base}/chat/completions`, {
    signal: AbortSignal.timeout(30000),   // bound inter-chunk stalls so a hung stream can't wedge the SSE
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 1500, stream: true, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
  });
  if (!r.ok || !r.body) { const e: any = new Error(`http ${r.status}`); e.status = r.status; throw e; }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", full = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim(); if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim(); if (data === "[DONE]") continue;
      try { const d = JSON.parse(data)?.choices?.[0]?.delta?.content; if (d) { full += d; onChunk(d); } } catch { /* malformed SSE chunk — skip it, the stream continues */ }
    }
  }
  return full;
}

export async function streamGemini(system: string, prompt: string, key: string, onChunk: (t: string) => void): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${key}`, {
    signal: AbortSignal.timeout(30000),   // bound inter-chunk stalls so a hung stream can't wedge the SSE
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 6000, thinkingConfig: { thinkingBudget: 0 } } }),
  });
  if (!r.ok || !r.body) { const e: any = new Error(`gemini ${r.status}`); e.status = r.status; throw e; }
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = "", full = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim(); if (!t.startsWith("data:")) continue;
      try { const parts = JSON.parse(t.slice(5).trim())?.candidates?.[0]?.content?.parts; const d = parts?.map((p: any) => p.text).join("") || ""; if (d) { full += d; onChunk(d); } } catch { /* malformed SSE chunk — skip it, the stream continues */ }
    }
  }
  return full;
}

// Stream a completion. Tries a fast free streaming provider; if none stream,
// falls back to a normal call and emits the whole answer as one chunk.
// LOCAL streaming (Ollama, NDJSON) — the token-by-token path for the Grammar on streaming. Passes
// `format` so the model is grammar-constrained; the caller decodes the {"respond":…} value as it streams.
export async function callOllamaStream(system: string, prompt: string, model: string, format: unknown, onChunk: (t: string) => void): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal: AbortSignal.timeout(300000), // 5 min timeout for cold starts
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], ...(format ? { format } : {}) }),
  });
  if (!res.ok || !res.body) { const e = new Error(`ollama ${res.status}`) as Error & { status?: number }; e.status = res.status; throw e; }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = "", full = "", looped = false;
  const take = (line: string) => { const t = line.trim(); if (!t) return; try { const d = JSON.parse(t)?.message?.content; if (d) { full += d; onChunk(d); } } catch { /* skip a malformed NDJSON line */ } };
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() || "";
    for (const line of lines) take(line);
    // Ollama has no token cap and a 5-minute timeout — a weak/quantized local model stuck
    // repeating would otherwise run the full 5 minutes before this function ever returns,
    // even though isDegenerateRepetition would have flagged it in the first few dozen tokens.
    // Cancel the read and stop paying for tokens nobody's going to see.
    if (isDegenerateRepetition(full)) { looped = true; break; }
  }
  if (!looped) take(buf);
  if (looped) { try { await reader.cancel(); } catch { /* best-effort — the fetch is being abandoned either way */ } return collapseRepetition(full); }
  return full;
}

// Private/local mode may never reach a cloud brain — streaming or not. Exported so this one
// rule is unit-tested rather than merely inlined in a branch condition that a refactor could
// quietly fold back into the cloud path (which is exactly how the streaming leak happened).
