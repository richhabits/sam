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

export type Tier = "local" | "free" | "premium";
export interface ModelResult { text: string; provider: string; tier: Tier }

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

// ── LOCAL · Ollama (free, on your machine) ───────────────────
async function callOllama(system: string, prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
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

// ── Shared OpenAI-compatible caller (Groq, OpenRouter, OpenAI) ─
async function callOpenAICompat(
  base: string, model: string, system: string, prompt: string, key: string
): Promise<string> {
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
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

// ── FREE · Gemini 2.5 Flash (thinkingBudget 0 — no wasted tokens) ─
async function callGemini(system: string, prompt: string, key: string): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `gemini-2.5-flash:generateContent?key=${key}`;
  const r = await fetch(url, {
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
const GLHF_MODEL = process.env.GLHF_MODEL || "hf:meta-llama/Llama-3.1-70B-Instruct";
const AI21_MODEL = process.env.AI21_MODEL || "jamba-1.5-large";
const UPSTAGE_MODEL = process.env.UPSTAGE_MODEL || "solar-1-mini-chat";
const NEBIUS_MODEL = process.env.NEBIUS_MODEL || "meta-llama/Meta-Llama-3.1-70B-Instruct";
const COHERE_MODEL = process.env.COHERE_MODEL || "command-r-plus-08-2024";
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || "llama-3.1-sonar-small-128k-chat";

// Free order = FASTEST capable first (Cerebras & Groq), followed by SambaNova, Together, DeepSeek
const PROVIDERS: Provider[] = [
  { id: "cerebras", tier: "free", label: `cerebras:${CEREBRAS_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.cerebras.ai/v1", CEREBRAS_MODEL, s, p, k) },
  { id: "groq", tier: "free", label: `groq:${GROQ_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.groq.com/openai/v1", GROQ_MODEL, s, p, k) },
  { id: "sambanova", tier: "free", label: `sambanova:${SAMBANOVA_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.sambanova.ai/v1", SAMBANOVA_MODEL, s, p, k) },
  { id: "together", tier: "free", label: `together:${TOGETHER_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.together.xyz/v1", TOGETHER_MODEL, s, p, k) },
  { id: "deepseek", tier: "free", label: `deepseek:${DEEPSEEK_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.deepseek.com", DEEPSEEK_MODEL, s, p, k) },
  { id: "fireworks", tier: "free", label: `fireworks:${FIREWORKS_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.fireworks.ai/inference/v1", FIREWORKS_MODEL, s, p, k) },
  { id: "xai", tier: "free", label: `xai:${XAI_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.x.ai/v1", XAI_MODEL, s, p, k) },
  { id: "huggingface", tier: "free", label: `huggingface:${HUGGINGFACE_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api-inference.huggingface.co/v1", HUGGINGFACE_MODEL, s, p, k) },
  { id: "hyperbolic", tier: "free", label: `hyperbolic:${HYPERBOLIC_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.hyperbolic.xyz/v1", HYPERBOLIC_MODEL, s, p, k) },
  { id: "novita", tier: "free", label: `novita:${NOVITA_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.novita.ai/v3/openai", NOVITA_MODEL, s, p, k) },
  { id: "siliconflow", tier: "free", label: `siliconflow:${SILICONFLOW_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.siliconflow.cn/v1", SILICONFLOW_MODEL, s, p, k) },
  { id: "glhf", tier: "free", label: `glhf:${GLHF_MODEL}`, run: (s, p, k) => callOpenAICompat("https://glhf.chat/api/openai/v1", GLHF_MODEL, s, p, k) },
  { id: "ai21", tier: "free", label: `ai21:${AI21_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.ai21.com/studio/v1", AI21_MODEL, s, p, k) },
  { id: "upstage", tier: "free", label: `upstage:${UPSTAGE_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.upstage.ai/v1/solar", UPSTAGE_MODEL, s, p, k) },
  { id: "nebius", tier: "free", label: `nebius:${NEBIUS_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.studio.nebius.ai/v1/", NEBIUS_MODEL, s, p, k) },
  { id: "cohere", tier: "free", label: `cohere:${COHERE_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.cohere.com/v1", COHERE_MODEL, s, p, k) },
  { id: "perplexity", tier: "free", label: `perplexity:${PERPLEXITY_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.perplexity.ai", PERPLEXITY_MODEL, s, p, k) },
  { id: "nvidia", tier: "free", label: `nvidia:${NVIDIA_MODEL}`, run: (s, p, k) => callOpenAICompat("https://integrate.api.nvidia.com/v1", NVIDIA_MODEL, s, p, k) },
  { id: "mistral", tier: "free", label: `mistral:${MISTRAL_MODEL}`, run: (s, p, k) => callOpenAICompat("https://api.mistral.ai/v1", MISTRAL_MODEL, s, p, k) },
  { id: "github", tier: "free", label: `github:${GITHUB_MODEL}`, run: (s, p, k) => callOpenAICompat("https://models.inference.ai.azure.com", GITHUB_MODEL, s, p, k) },
  { id: "gemini", tier: "free", label: "gemini-2.5-flash", run: callGemini },
  { id: "openrouter", tier: "free", label: `openrouter:${OPENROUTER_MODEL}`, run: (s, p, k) => callOpenAICompat("https://openrouter.ai/api/v1", OPENROUTER_MODEL, s, p, k) },
  { id: "anthropic", tier: "premium", label: CLAUDE_MODEL, run: callAnthropic },
  { id: "openai", tier: "premium", label: OPENAI_MODEL, run: (s, p, k) => callOpenAICompat("https://api.openai.com/v1", OPENAI_MODEL, s, p, k) },
];

// Try one provider, rotating through its key pool on failure.
async function tryProvider(prov: Provider, system: string, prompt: string): Promise<string | null> {
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

// ── DISPATCH with graceful fallback ──────────────────────────
export async function runModel(tier: Tier, system: string, prompt: string): Promise<ModelResult> {
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

  // Walk the cloud tiers. MONEY-SAVER: free/local requests NEVER escalate to
  // paid premium — only an explicit "premium" (Best) request may use paid models.
  const order: Tier[] = tier === "premium" ? ["premium", "free"] : ["free"];
  for (const t of order) {
    for (const prov of PROVIDERS.filter((p) => p.tier === t && poolSize(p.id) > 0)) {
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
      "SAM router offline — no provider answered. Start Ollama (`ollama serve`) " +
      "or add a key to .env (GEMINI_API_KEYS / GROQ_API_KEYS / ANTHROPIC_API_KEYS).",
    provider: "none",
    tier,
  };
}

// ── STREAMING · token-by-token for the "types as it thinks" feel ──
async function streamOpenAICompat(base: string, model: string, system: string, prompt: string, key: string, onChunk: (t: string) => void): Promise<string> {
  const r = await fetch(`${base}/chat/completions`, {
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
export async function streamModel(tier: Tier, system: string, prompt: string, onChunk: (t: string) => void): Promise<ModelResult> {
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
  // fallback: non-streamed, emit whole text once
  const r = await runModel(tier, system, prompt);
  onChunk(r.text);
  return r;
}

// ── VISION · look at photos/images (free via Gemini multimodal) ──
export interface ImagePart { mime: string; data: string } // data = raw base64
export async function runVision(system: string, prompt: string, images: ImagePart[]): Promise<ModelResult> {
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
  
  // Fully Local Zero-Cloud Fallback via Ollama (llava). Always attempt it — Ollama
  // runs on the default localhost URL without any env var set, so gating on
  // process.env.OLLAMA_URL meant this never fired on a normal local install. If
  // Ollama's down or llava isn't pulled, the fetch fails and we fall through below.
  {
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
    } catch (e: any) {
      // Fall through to the offline message below if Ollama fails/isn't running
    }
  }

  return { text: "To read photos, SAM needs a free Gemini key (add GEMINI_API_KEYS to .env) or Ollama running with the 'llava' model locally. Everything else works without it.", provider: "none", tier: "free" };
}

// For the HUD / status endpoint: which providers are wired.
export function providersStatus() {
  return {
    local: { ollama: OLLAMA_MODEL },
    pools: keyStatus(),
    providers: PROVIDERS.map((p) => ({ id: p.id, tier: p.tier, keys: poolSize(p.id) })),
  };
}
