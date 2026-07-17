// ─────────────────────────────────────────────────────────────
//  S.A.M. · MODEL PROVIDERS  (rotating key vault, free-first)
//  local (Ollama) → free (Gemini · Groq · OpenRouter) → premium
//  (Claude · OpenAI). Every cloud provider pulls from a rotating
//  key pool so SAM never rate-limits itself, and always falls
//  back down the chain — it never goes dark.
//
//  Add a provider = one entry in PROVIDERS below. That's it.
// ─────────────────────────────────────────────────────────────

import { getKey, reportSuccess, reportFailure, poolSize, keyStatus } from "./keys.ts";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recordModelCall, estTokens } from "./metrics.ts";
import { loadRanking, rankingStale } from "./colosseum.ts";

export type Tier = "local" | "free" | "premium";
export interface ModelResult { text: string; provider: string; tier: Tier }

// ── BENCH MOCK ── deterministic, offline brain so scripts/bench.ts can exercise the FULL
// real pipeline (routing, prompt assembly, cache, agent loop) with zero network + zero quota.
// Gated behind SAM_BENCH_MOCK so production is untouched. Latency is MODELLED per tier (the
// ratios — local < free < premium — are what before/after deltas care about, documented as such).
const BENCH_MOCK = process.env.SAM_BENCH_MOCK === "1";
const MOCK_LATENCY: Record<Tier, number> = { local: 40, free: 200, premium: 500 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function mockText(tier: Tier): string {
  // A stable, plausible answer sized to a realistic short reply (~50 tokens).
  return `[${tier}] Done — here's a clear, useful answer to that. ` +
    "It covers the key point directly and stays tight, the way SAM replies when it's on form.";
}
async function mockRun(tier: Tier): Promise<ModelResult> {
  await sleep(MOCK_LATENCY[tier]);
  return { text: mockText(tier), provider: `mock:${tier}`, tier };
}

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

// ── SAM Cloud gateway (OPTIONAL hosted free tier — OFF unless SAM_GATEWAY_URL is set at build) ──
// Anonymous per-install device id (random, no personal data) so the gateway can meter fairly.
export const GATEWAY_URL = process.env.SAM_GATEWAY_URL || "";
const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
let _deviceId = "";
export function deviceId(): string {
  if (_deviceId) return _deviceId;
  const f = join(VAULT_DIR, ".device-id");
  try { _deviceId = readFileSync(f, "utf8").trim(); } catch { /* first run */ }
  if (!_deviceId) { _deviceId = randomBytes(12).toString("hex"); try { writeFileSync(f, _deviceId); } catch { /* read-only fs — ephemeral id is fine */ } }
  return _deviceId;
}
async function callGateway(system: string, prompt: string): Promise<string> {
  const r = await fetch(`${GATEWAY_URL}/v1/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: deviceId(), messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`gateway ${r.status}`);
  const d: any = await r.json();
  return d?.choices?.[0]?.message?.content || "";
}

// ── LOCAL · Ollama (free, on your machine) ───────────────────
async function callOllama(system: string, prompt: string, model = OLLAMA_MODEL): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
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
    }).catch(() => {});
    return target;
  } catch { return null; }
}

// ── Shared OpenAI-compatible caller (Groq, OpenRouter, OpenAI) ─
async function callOpenAICompat(
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

// Pollinations' simple GET endpoint — a DIFFERENT code path/URL to the POST /openai one above, so if
// that endpoint hiccups this independent lane can still answer. Keeps SAM working out of the box.
async function callPollinationsGet(system: string, prompt: string): Promise<string> {
  const q = `${system}\n\nUser: ${prompt}\nSAM:`.slice(0, 3000);
  const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(q)}?model=openai`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) { const e: any = new Error(`http ${r.status}`); e.status = r.status; throw e; }
  return (await r.text()).trim();
}

// ── FREE · Gemini 2.5 Flash (thinkingBudget 0 — no wasted tokens) ─
async function callGemini(system: string, prompt: string, key: string): Promise<string> {
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
async function callAnthropic(system: string, prompt: string, key: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    signal: AbortSignal.timeout(30000),   // never hang forever on a stalled provider
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      // Cache the (large, repeated) system prompt so every call after the first in
      // a multi-step task pays ~90% less on those input tokens. 5-min ephemeral TTL.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) { const e: any = new Error(`anthropic ${r.status}`); e.status = r.status; throw e; }
  const d = await r.json();
  const block = d?.content?.find((b: any) => b.type === "text");
  return block?.text?.trim() || "";
}

// ── PROVIDER REGISTRY — add a line to add a provider ─────────
interface Provider {
  id: string;
  tier: Tier;
  label: string;
  run: (system: string, prompt: string, key: string) => Promise<string>;
  noKey?: boolean;   // works with no API key at all (e.g. Pollinations) — the never-dry fallback
}

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "llama-3.3-70b";
const GITHUB_MODEL = process.env.GITHUB_MODEL || "gpt-4o-mini";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ── The "Invincible" Expansion Default Models ──
const TOGETHER_MODEL = process.env.TOGETHER_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const SAMBANOVA_MODEL = process.env.SAMBANOVA_MODEL || "Meta-Llama-3.3-70B-Instruct";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const FIREWORKS_MODEL = process.env.FIREWORKS_MODEL || "accounts/fireworks/models/llama-v3p1-70b-instruct";
const XAI_MODEL = process.env.XAI_MODEL || "grok-beta";
const HUGGINGFACE_MODEL = process.env.HUGGINGFACE_MODEL || "meta-llama/Llama-3.3-70B-Instruct";
const HYPERBOLIC_MODEL = process.env.HYPERBOLIC_MODEL || "meta-llama/Meta-Llama-3-70B-Instruct";
const NOVITA_MODEL = process.env.NOVITA_MODEL || "meta-llama/llama-3.1-70b-instruct";
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
const AI21_MODEL = process.env.AI21_MODEL || "jamba-1.5-large";
const UPSTAGE_MODEL = process.env.UPSTAGE_MODEL || "solar-1-mini-chat";
const NEBIUS_MODEL = process.env.NEBIUS_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
const COHERE_MODEL = process.env.COHERE_MODEL || "command-r-plus-08-2024";
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || "llama-3.1-sonar-small-128k-chat";

// ── "Infinite Compute" Global Mesh — Asian Heavyweights ──
const ALIBABA_MODEL = process.env.ALIBABA_MODEL || "qwen-plus";
const VOLCENGINE_MODEL = process.env.VOLCENGINE_MODEL || "doubao-1.5-pro-32k";
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || "glm-5.2";   // Zhipu flagship — 1M context, MIT (20M free tokens on signup; set glm-4-flash for the free-forever tier)
const HERMES_MODEL = process.env.HERMES_MODEL || "Hermes-4-405B";   // Nous Hermes flagship — open weights, superb agentic/tool-use reasoning (free tier via Nous portal)
const MOONSHOT_MODEL = process.env.MOONSHOT_MODEL || "moonshot-v1-8k";
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || "abab6.5s-chat";
const STEPFUN_MODEL = process.env.STEPFUN_MODEL || "step-1-8k";
const BAIDU_MODEL = process.env.BAIDU_MODEL || "ernie-speed-128k";
const TENCENT_MODEL = process.env.TENCENT_MODEL || "hunyuan-lite";

// ── Bonus free/free-credit providers (all real, OpenAI-compatible) ──
const DEEPINFRA_MODEL = process.env.DEEPINFRA_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
const SCALEWAY_MODEL = process.env.SCALEWAY_MODEL || "llama-3.3-70b-instruct";
const CHUTES_MODEL = process.env.CHUTES_MODEL || "deepseek-ai/DeepSeek-V3";
const FRIENDLI_MODEL = process.env.FRIENDLI_MODEL || "meta-llama-3.1-70b-instruct";
const CODESTRAL_MODEL = process.env.CODESTRAL_MODEL || "codestral-latest";
const INFERENCE_MODEL = process.env.INFERENCE_MODEL || "meta-llama/llama-3.1-8b-instruct/fp-8";
const GMI_MODEL = process.env.GMI_MODEL || "meta-llama/Llama-3.3-70B-Instruct";
const VERCEL_MODEL = process.env.VERCEL_MODEL || "meta/llama-3.3-70b";
const OVH_MODEL = process.env.OVH_MODEL || "Meta-Llama-3_1-70B-Instruct";
const POLLINATIONS_MODEL = process.env.POLLINATIONS_MODEL || "openai";

// ═══════════════════════════════════════════════════════════════
//  THE BURN-DOWN ENGINE — 30+ providers, tiered for maximum
//  free throughput. SAM sprays across Tier 1 first (speed),
//  cascades to Tier 2 (bottomless), then Tier 3 (Asian mesh),
//  and only touches Tier 4 (premium paid) as last resort.
// ═══════════════════════════════════════════════════════════════
const PROVIDERS: Provider[] = [
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
  { id: "moonshot", tier: "free", label: `moonshot:${MOONSHOT_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.moonshot.cn/v1", MOONSHOT_MODEL, s, p, k) },
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
  { id: "github", tier: "free", label: `github:${GITHUB_MODEL}`, run: (s, p, k) => callOpenAICompat("https://models.inference.ai.azure.com", GITHUB_MODEL, s, p, k) },
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
  { id: "pollinations", tier: "free", noKey: true, label: `pollinations:${POLLINATIONS_MODEL}`, run: (s, p) => callOpenAICompat("https://text.pollinations.ai/openai", POLLINATIONS_MODEL, s, p, "") },
  { id: "pollinations-fast", tier: "free", noKey: true, label: "pollinations:openai-fast", run: (s, p) => callOpenAICompat("https://text.pollinations.ai/openai", "openai-fast", s, p, "") },
  { id: "pollinations-get", tier: "free", noKey: true, label: "pollinations:get", run: (s, p) => callPollinationsGet(s, p) },

  // ── TIER 4: Premium (paid, last resort) ────────────────────
  { id: "anthropic", tier: "premium", label: CLAUDE_MODEL, run: callAnthropic },
  { id: "openai", tier: "premium", label: OPENAI_MODEL, run: (s, p, k) => callOpenAICompat("https://api.openai.com/v1", OPENAI_MODEL, s, p, k) },
];

// Try one provider, rotating through its key pool on failure.
async function tryProvider(prov: Provider, system: string, prompt: string): Promise<string | null> {
  if (prov.noKey) {   // no-key provider (Pollinations) — retry a couple of times; transient hiccups are common
    for (let i = 0; i < 2; i++) {
      try { const text = await prov.run(system, prompt, ""); if (text) return text; } catch { /* retry, then fall through */ }
      if (i === 0) await new Promise((r) => setTimeout(r, 800));
    }
    return null;
  }
  const attempts = Math.max(1, poolSize(prov.id));
  for (let i = 0; i < attempts; i++) {
    const key = getKey(prov.id);
    if (!key) return null;
    try {
      const text = await prov.run(system, prompt, key);
      if (text) { reportSuccess(prov.id, key); return text; }
    } catch (e: any) {
      reportFailure(prov.id, key, e?.status);
      // 4xx that isn't rate-limit = bad key/request; stop hammering this provider
      if (e?.status && e.status !== 429 && e.status < 500) break;
    }
  }
  return null;
}

// SMART USAGE ("Oliver Twist" — take a little, ask the next). Instead of hammering the
// single fastest provider for EVERY request until it rate-limits, we round-robin the
// starting point across the top few best-fit free providers, so each one's free quota is
// sipped lightly and lasts far longer. More total free-ness, same speed (all top picks
// are fast). A module counter is enough — no randomness needed.
let rrCounter = 0;
function spreadLoad(ranked: Provider[]): Provider[] {
  if (ranked.length < 2) return ranked;
  const spread = Math.min(3, ranked.length);            // rotate among the top few only
  const start = (rrCounter++) % spread;
  return [...ranked.slice(start, spread), ...ranked.slice(0, start), ...ranked.slice(spread)];
}

// Colosseum → routing: once a benchmark has run, prefer the brains it rated higher (Elo desc),
// keeping the incoming lane order as a stable tiebreaker. No ranking on file ⇒ pool unchanged.
export function arenaSort(pool: Provider[]): Provider[] {
  const rank = loadRanking();
  // No ranking, or one too old to trust → keep the incoming (static lane) order.
  if (!rank || rankingStale(rank.ts, Date.now())) return pool;
  // Ranked brains lead in Elo order; UNRANKED brains fall BELOW all of them — a brain we tested
  // and rated (even one that lost) beats one we never tested, instead of a neutral 1000 that let
  // untested brains leapfrog the benchmark's losers. Finite floor keeps the comparator NaN-free.
  const vals = Object.values(rank.elo);
  const floor = (vals.length ? Math.min(...vals) : 1000) - 1;
  const elo = (id: string) => rank.elo[id] ?? floor;
  return pool.map((p, i) => ({ p, i })).sort((a, b) => elo(b.p.id) - elo(a.p.id) || a.i - b.i).map((x) => x.p);
}

// Free-tier ordering. With an active ranking: PIN the champion first (always tried first, falling
// through only if it's actually down), then spread-load the runners-up so their quotas still
// rotate. Without a ranking: the original behaviour — spread-load the static lane order.
export function freeOrder(pool: Provider[], lane: Lane): Provider[] {
  const laned = laneSort(pool, lane);
  const rank = loadRanking();
  if (!rank || rankingStale(rank.ts, Date.now())) return spreadLoad(laned);
  const sorted = arenaSort(laned);
  return sorted.length > 1 ? [sorted[0], ...spreadLoad(sorted.slice(1))] : sorted;
}

// ── DISPATCH with graceful fallback ──────────────────────────
// ── TASK-AWARE LANES ─────────────────────────────────────────
// 30+ free models is a lot of firepower — so use the RIGHT one FIRST for the job:
// blazing-fast small models for quick chat, big reasoning models for hard problems,
// code-strong ones for programming. It still falls through ALL free providers on
// failure (nothing wasted) — this only changes which is TRIED first.
export type Lane = "fast" | "deep" | "code";
const LANE_PREF: Record<Lane, string[]> = {
  // fastest inference first (default — keeps quick chat snappy)
  fast: ["cerebras", "groq", "sambanova"],
  // biggest / strongest reasoning free models first
  deep: ["hermes", "zhipu", "deepseek", "nvidia", "together", "alibaba", "fireworks", "cerebras", "groq"],
  // strongest at code first
  code: ["hermes", "zhipu", "deepseek", "fireworks", "together", "nvidia", "cerebras", "groq"],
};
export function pickLane(text: string): Lane {
  const t = (text || "").slice(0, 600).toLowerCase();
  if (/```|\b(debug|refactor|stack ?trace|compile|regex|typescript|javascript|python|\bnpm\b|traceback|exception|syntax error|stack overflow)\b/.test(t)) return "code";
  if (t.length > 280 || /\b(analy[sz]e|explain why|strateg|compare\b|pros and cons|think through|break ?down|evaluate|deep dive|trade-?offs?|reason through|assess\b)\b/.test(t)) return "deep";
  return "fast";
}
// Stable-sort a free-tier pool so lane-preferred providers come first; unlisted keep order.
function laneSort(pool: Provider[], lane: Lane): Provider[] {
  const pref = LANE_PREF[lane];
  const rank = (id: string) => { const i = pref.indexOf(id); return i === -1 ? 999 : i; };
  return pool.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.id) - rank(b.p.id) || a.i - b.i).map((x) => x.p);
}

// Cheap cached check: is a local Ollama up WITH a model pulled? (private, offline, zero-key brain)
let _ollamaOk: boolean | null = null, _ollamaAt = 0;
export async function ollamaReady(): Promise<boolean> {
  const now = Date.now();
  if (_ollamaOk !== null && now - _ollamaAt < 30_000) return _ollamaOk;
  _ollamaAt = now;
  try { const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) }); const d: any = r.ok ? await r.json() : null; _ollamaOk = !!(d?.models?.length); }
  catch { _ollamaOk = false; }
  return _ollamaOk;
}
// Any cloud provider with a real key pooled? (noKey lanes like Pollinations don't count as "has keys")
function hasCloudKeys(): boolean { return PROVIDERS.some((p) => p.tier === "free" && !p.noKey && poolSize(p.id) > 0); }

async function runModelInner(tier: Tier, system: string, prompt: string, laneHint?: Lane): Promise<ModelResult> {
  // Local first when asked (free, private, no key).
  if (tier === "local") {
    try {
      const text = await callOllama(system, prompt);
      if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" };
    } catch { /* handled just below */ }
    // PRIVACY GUARANTEE: Private/local mode must NEVER send data to a cloud provider.
    // If the local model isn't up, say so honestly — do not silently go off-machine.
    return {
      text: `🔒 Private mode is on — nothing leaves your Mac — but the local model isn't responding right now. Start it with \`ollama serve\` (and \`ollama pull ${OLLAMA_MODEL}\` if needed), or switch to Auto/Best to use the free cloud brains.`,
      provider: "local-unavailable", tier: "local",
    };
  }

  // ZERO-KEY DEFAULT: if the user has added NO cloud keys and a local Ollama is up with a model,
  // prefer the LOCAL brain — private, offline, instant. It also becomes the floor if the free cloud
  // lanes below all fail. When cloud keys exist, we use the (usually faster/stronger) cloud pool first.
  if (tier !== "premium" && !hasCloudKeys() && await ollamaReady()) {
    try { const text = await callOllama(system, prompt); if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" }; } catch { /* fall to free cloud lanes */ }
  }
  // SAM Cloud gateway — if the operator turned it on (SAM_GATEWAY_URL at build) and the user has no
  // keys + no local brain, serve from the hosted free daily allowance before the public no-key lanes.
  if (tier !== "premium" && !hasCloudKeys() && GATEWAY_URL) {
    try { const text = await callGateway(system, prompt); if (text) return { text, provider: "sam-cloud", tier: "free" }; } catch { /* fall to free cloud lanes */ }
  }

  // Walk the cloud tiers. MONEY-SAVER: free/local requests NEVER escalate to
  // paid premium — only an explicit "premium" (Best) request may use paid models.
  const order: Tier[] = tier === "premium" ? ["premium", "free"] : ["free"];
  const lane = laneHint || pickLane(prompt);   // caller can force a lane (e.g. agent tool-planning → deep/Hermes)
  for (const t of order) {
    // Include no-key providers (Pollinations) so there's ALWAYS a free brain to fall to.
    const pool = PROVIDERS.filter((p) => p.tier === t && (poolSize(p.id) > 0 || p.noKey));
    // Free tier: best model for the task FIRST (lane), then spread load across the top few
    // (Oliver Twist) so no single free quota burns out. Still falls through ALL on failure.
    const ranked = t === "free" ? freeOrder(pool, lane) : pool;
    for (const prov of ranked) {
      const text = await tryProvider(prov, system, prompt);
      if (text) return { text, provider: prov.label, tier: t };
    }
  }

  // Last resort: local, even if it wasn't the requested tier.
  try {
    const text = await callOllama(system, prompt);
    if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" };
  } catch { /* nothing answered */ }

  return {
    text:
      "I couldn't reach a brain just now — the free lane may be briefly busy, or your internet dropped. " +
      "Give it a few seconds and try again. (SAM is free out of the box — you don't need to add anything. " +
      "If it keeps happening, you can add a free key in Settings 🔑 or run Ollama locally for an offline brain.)",
    provider: "none",
    tier,
  };
}

// Public entry — times the call and records it (tier, tokens, latency) for the router
// badge + benchmark. In bench-mock mode it returns a deterministic answer with no network.
export async function runModel(tier: Tier, system: string, prompt: string, laneHint?: Lane, meta?: { reason?: string; escalated?: boolean }): Promise<ModelResult> {
  const t0 = Date.now();
  const r = BENCH_MOCK ? await mockRun(tier) : await runModelInner(tier, system, prompt, laneHint);
  recordModelCall({
    tier: r.tier, provider: r.provider,
    promptTokens: estTokens(system) + estTokens(prompt),
    outputTokens: estTokens(r.text),
    ms: Date.now() - t0, reason: meta?.reason, escalated: meta?.escalated,
  });
  return r;
}

// ── STREAMING · token-by-token for the "types as it thinks" feel ──
async function streamOpenAICompat(base: string, model: string, system: string, prompt: string, key: string, onChunk: (t: string) => void): Promise<string> {
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
      try { const d = JSON.parse(data)?.choices?.[0]?.delta?.content; if (d) { full += d; onChunk(d); } } catch {}
    }
  }
  return full;
}

async function streamGemini(system: string, prompt: string, key: string, onChunk: (t: string) => void): Promise<string> {
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
      try { const parts = JSON.parse(t.slice(5).trim())?.candidates?.[0]?.content?.parts; const d = parts?.map((p: any) => p.text).join("") || ""; if (d) { full += d; onChunk(d); } } catch {}
    }
  }
  return full;
}

// Stream a completion. Tries a fast free streaming provider; if none stream,
// falls back to a normal call and emits the whole answer as one chunk.
async function streamModelInner(tier: Tier, system: string, prompt: string, onChunk: (t: string) => void, laneHint?: Lane): Promise<ModelResult> {
  const tryStream = async (id: string, run: (key: string) => Promise<string>, label: string): Promise<ModelResult | null> => {
    if (!poolSize(id)) return null;
    const key = getKey(id); if (!key) return null;
    try { const text = await run(key); if (text) { reportSuccess(id, key); return { text, provider: label, tier: "free" }; } }
    catch (e: any) { reportFailure(id, key, e?.status); }
    return null;
  };
  if (tier !== "premium") {
    const g = await tryStream("groq", (k) => streamOpenAICompat("https://api.groq.com/openai/v1", GROQ_MODEL, system, prompt, k, onChunk), `groq:${GROQ_MODEL}`);
    if (g) return g;
    const gem = await tryStream("gemini", (k) => streamGemini(system, prompt, k, onChunk), "gemini-2.5-flash");
    if (gem) return gem;
  }
  // fallback: non-streamed, emit whole text once (respects a forced lane, e.g. deep/Hermes)
  const r = await runModelInner(tier, system, prompt, laneHint);
  onChunk(r.text);
  return r;
}

// Public streaming entry — records ttft + total latency for the badge + benchmark.
// Bench-mock: emit the deterministic answer in two chunks with a modelled TTFT.
export async function streamModel(tier: Tier, system: string, prompt: string, onChunk: (t: string) => void, laneHint?: Lane, meta?: { reason?: string; escalated?: boolean }): Promise<ModelResult> {
  const t0 = Date.now();
  let ttft = 0;
  const wrap = (t: string) => { if (!ttft) ttft = Date.now() - t0; onChunk(t); };
  let r: ModelResult;
  if (BENCH_MOCK) {
    await sleep(Math.round(MOCK_LATENCY[tier] * 0.4));   // time-to-first-token < total
    const txt = mockText(tier);
    const mid = Math.floor(txt.length / 2);
    wrap(txt.slice(0, mid));
    await sleep(Math.round(MOCK_LATENCY[tier] * 0.6));
    wrap(txt.slice(mid));
    r = { text: txt, provider: `mock:${tier}`, tier };
  } else {
    r = await streamModelInner(tier, system, prompt, wrap, laneHint);
  }
  recordModelCall({
    tier: r.tier, provider: r.provider,
    promptTokens: estTokens(system) + estTokens(prompt),
    outputTokens: estTokens(r.text),
    ms: Date.now() - t0, ttftMs: ttft || undefined, reason: meta?.reason, escalated: meta?.escalated,
  });
  return r;
}

// ── VISION · look at photos/images (free via Gemini multimodal) ──
export interface ImagePart { mime: string; data: string } // data = raw base64

// Groq's vision guardrail frequently refuses perfectly benign photos — especially ones
// with a person/face — returning a canned "I can't help with that." Treat that (and a
// blank reply) as a MISS so we fall through to a real vision lane instead of surfacing
// the refusal to the user. Kept local so this low-level module stays dependency-free
// (mirrors classify.ts's selfCheckFailed).
const VISION_REFUSAL_RE = /i can[’'`]?t (help|assist)|i(?:'?m| am)? ?(?:un)?able to (?:help|assist|process)|i cannot (?:help|assist|process)/i;
function visionRefused(text: string): boolean {
  const a = (text || "").trim();
  return a.length < 8 || VISION_REFUSAL_RE.test(a);
}

export async function runVision(system: string, prompt: string, images: ImagePart[]): Promise<ModelResult> {
  // LANE 0 · Groq llama-4-scout (free tier, very fast) — vision without a Gemini key.
  {
    const gk = getKey("groq");
    if (gk) {
      try {
        const content: any[] = [{ type: "text", text: prompt || "Describe this and answer any question about it." },
          ...images.slice(0, 4).map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))];
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${gk}` },
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({ model: process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct", max_tokens: 1500, messages: [{ role: "system", content: system }, { role: "user", content }] }),
        });
        if (r.ok) {
          const text = (await r.json())?.choices?.[0]?.message?.content?.trim() || "";
          // Only accept a real answer — if Groq refused/blanked, fall through to Gemini/Ollama.
          if (text && !visionRefused(text)) { reportSuccess("groq", gk); return { text, provider: "groq:llama-4-scout (vision)", tier: "free" }; }
        } else reportFailure("groq", gk, r.status);
      } catch { /* fall through to Gemini */ }
    }
  }
  const attempts = Math.max(1, poolSize("gemini"));
  for (let i = 0; i < attempts; i++) {
    const key = getKey("gemini");
    if (!key) break;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
      const parts: any[] = [{ text: prompt || "Describe this and answer any question about it." },
        ...images.map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } }))];
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (!r.ok) { const e: any = new Error(`gemini ${r.status}`); e.status = r.status; throw e; }
      const d = await r.json();
      const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
      if (text) { reportSuccess("gemini", key); return { text: text.trim(), provider: "gemini-2.5-flash (vision)", tier: "free" }; }
    } catch (e: any) { reportFailure("gemini", key, e?.status); }
  }
    try {
      const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
      const ollamaModel = process.env.OLLAMA_VISION_MODEL || "llava";
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          stream: false,
          messages: [
            { role: "system", content: system },
            { 
              role: "user", 
              content: prompt || "Describe this and answer any question about it.",
              images: images.map(im => im.data) 
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.message?.content?.trim() || "";
        if (text) {
          return { text, provider: `ollama (${ollamaModel})`, tier: "local" };
        }
      }
    } catch (_e: any) {
      // Fall through to the offline message below if Ollama fails/isn't running
    }

  return { text: "To read photos, SAM needs a free Gemini key (add GEMINI_API_KEYS to .env) or Ollama running with the 'llava' model locally. Everything else works without it.", provider: "none", tier: "free" };
}

// For the HUD / status endpoint: which providers are wired.
export function providersStatus() {
  return {
    local: { ollama: OLLAMA_MODEL },
    pools: keyStatus(),
    providers: PROVIDERS.map((p) => ({ id: p.id, tier: p.tier, keys: poolSize(p.id) })),
    arena: (() => { const r = loadRanking(); if (!r) return null; const stale = rankingStale(r.ts, Date.now()); return { top: r.top, ts: r.ts, stale, steering: !stale }; })(),   // colosseum champion; steering only while fresh
  };
}

// ── Model Colosseum support ──
// The brains usable RIGHT NOW (have a key, or need none) — the arena's eligible competitors.
export function availableBrains(): { id: string; tier: Tier; label: string }[] {
  return PROVIDERS.filter((p) => p.noKey || poolSize(p.id) > 0).map((p) => ({ id: p.id, tier: p.tier, label: p.label }));
}
// Run ONE named brain directly (bypasses the cascade) so distinct models can go head-to-head.
export async function runBrain(id: string, system: string, prompt: string): Promise<string | null> {
  const prov = PROVIDERS.find((p) => p.id === id);
  return prov ? tryProvider(prov, system, prompt) : null;
}
