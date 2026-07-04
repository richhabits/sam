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
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system,
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

// Free order = FASTEST capable first (Cerebras & Groq are the quickest 70Bs),
// then NVIDIA/Mistral/GitHub as capable backups, Gemini for vision, OpenRouter last.
// Multiple 70B lanes → if one is rate-limited SAM falls to another CAPABLE model.
const PROVIDERS: Provider[] = [
  {
    id: "cerebras", tier: "free", label: `cerebras:${CEREBRAS_MODEL}`,
    run: (s, p, k) => callOpenAICompat("https://api.cerebras.ai/v1", CEREBRAS_MODEL, s, p, k),
  },
  {
    id: "groq", tier: "free", label: `groq:${GROQ_MODEL}`,
    run: (s, p, k) => callOpenAICompat("https://api.groq.com/openai/v1", GROQ_MODEL, s, p, k),
  },
  {
    id: "nvidia", tier: "free", label: `nvidia:${NVIDIA_MODEL}`,
    run: (s, p, k) => callOpenAICompat("https://integrate.api.nvidia.com/v1", NVIDIA_MODEL, s, p, k),
  },
  {
    id: "mistral", tier: "free", label: `mistral:${MISTRAL_MODEL}`,
    run: (s, p, k) => callOpenAICompat("https://api.mistral.ai/v1", MISTRAL_MODEL, s, p, k),
  },
  {
    id: "github", tier: "free", label: `github:${GITHUB_MODEL}`,
    run: (s, p, k) => callOpenAICompat("https://models.inference.ai.azure.com", GITHUB_MODEL, s, p, k),
  },
  { id: "gemini", tier: "free", label: "gemini-2.5-flash", run: callGemini },
  {
    id: "openrouter", tier: "free", label: `openrouter:${OPENROUTER_MODEL}`,
    run: (s, p, k) => callOpenAICompat("https://openrouter.ai/api/v1", OPENROUTER_MODEL, s, p, k),
  },
  { id: "anthropic", tier: "premium", label: CLAUDE_MODEL, run: callAnthropic },
  {
    id: "openai", tier: "premium", label: OPENAI_MODEL,
    run: (s, p, k) => callOpenAICompat("https://api.openai.com/v1", OPENAI_MODEL, s, p, k),
  },
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
    } catch { /* fall through to cloud */ }
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
  return { text: "To read photos, SAM needs a free Gemini key (it's multimodal). Add GEMINI_API_KEYS to .env — everything else works without it.", provider: "none", tier: "free" };
}

// For the HUD / status endpoint: which providers are wired.
export function providersStatus() {
  return {
    local: { ollama: OLLAMA_MODEL },
    pools: keyStatus(),
    providers: PROVIDERS.map((p) => ({ id: p.id, tier: p.tier, keys: poolSize(p.id) })),
  };
}
