// ─────────────────────────────────────────────────────────────
//  S.A.M. · EMBEDDINGS  — text → vectors for semantic recall + routing.
//  FREE & low-RAM: Jina API (no RAM) → Gemini (no RAM) → Ollama
//  nomic-embed (local). ONE provider is used per call and the model
//  is TAGGED — you must never compare vectors from different models
//  (different dims), so callers filter by the returned `model`.
// ─────────────────────────────────────────────────────────────

import { getKey } from "./keys.ts";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

// Bounded-concurrency mapper — runs at most `limit` promises at once.
// Prevents CPU/thermal spikes on low-end laptops while still being
// dramatically faster than sequential loops.
async function mapConcurrent<T, R>(items: T[], fn: (item: T) => Promise<R>, limit = 8): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export interface Embedded { model: string; vectors: number[][] }

async function viaJina(texts: string[], isQuery: boolean): Promise<Embedded | null> {
  const key = process.env.JINA_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "jina-embeddings-v3", task: isQuery ? "retrieval.query" : "retrieval.passage", dimensions: 512, input: texts }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const vectors = d?.data?.map((x: any) => x.embedding);
    return vectors?.length ? { model: "jina-v3-512", vectors } : null;
  } catch { return null; }
}

async function viaGemini(texts: string[]): Promise<Embedded | null> {
  const key = getKey("gemini");
  if (!key) return null;
  try {
    // Batch API: pack up to 100 texts into ONE HTTP round-trip.
    const BATCH = 100;
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const chunk = texts.slice(i, i + BATCH);
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: chunk.map((text) => ({
              model: "models/gemini-embedding-001",
              content: { parts: [{ text }] },
              outputDimensionality: 768,
            })),
          }) }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const embs = d?.embeddings;
      if (!Array.isArray(embs) || embs.length !== chunk.length) return null;
      for (const e of embs) {
        if (!e?.values) return null;
        vectors.push(e.values);
      }
    }
    return { model: "gemini-001-768", vectors };
  } catch { return null; }
}

async function viaOllama(texts: string[]): Promise<Embedded | null> {
  try {
    // Bounded concurrency — 8 parallel requests max (safe for any laptop).
    const embedModel = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
    const vectors = await mapConcurrent(texts, async (text) => {
      const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embedModel, prompt: text }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d?.embedding as number[] | null;
    }, 8);
    if (vectors.some((v) => !v)) return null;
    return vectors.length ? { model: "nomic", vectors: vectors as number[][] } : null;
  } catch { return null; }
}

// Route a request to the exact provider that produces a given model tag, so the
// vault can PIN one embedding model. Mixing models (dims differ) makes older
// memories unretrievable when the available provider rotates between sessions.
function viaFor(tag: string, texts: string[], isQuery: boolean): Promise<Embedded | null> {
  if (tag === "jina-v3-512") return viaJina(texts, isQuery);
  if (tag === "gemini-001-768") return viaGemini(texts);
  if (tag === "nomic") return viaOllama(texts);
  return Promise.resolve(null);
}

// Embed a batch — returns tagged vectors, or null if no provider available.
// `prefer` pins to the vault's existing model when set (falls back only if that
// provider is genuinely down — a switch would silently orphan stored memories).
export async function embed(texts: string[], isQuery = false, prefer?: string | null): Promise<Embedded | null> {
  if (!texts.length) return { model: "none", vectors: [] };
  if (prefer) { const p = await viaFor(prefer, texts, isQuery); if (p) return p; }
  return (await viaJina(texts, isQuery)) || (await viaGemini(texts)) || (await viaOllama(texts));
}

// Single-text embedding with a small LRU cache. Embedding a given text under a given
// model is deterministic, so caching kills a network round-trip (~100-500ms) whenever
// a query repeats — common for greetings, slash-commands, re-asks and tool routing.
const EMB_CACHE = new Map<string, { model: string; vec: number[] }>();
const EMB_CACHE_MAX = 512;
export async function embedOne(text: string, isQuery = false, prefer?: string | null): Promise<{ model: string; vec: number[] } | null> {
  const key = `${prefer || ""}|${isQuery ? "q" : "p"}|${text}`;
  const hit = EMB_CACHE.get(key);
  if (hit) { EMB_CACHE.delete(key); EMB_CACHE.set(key, hit); return hit; }   // LRU touch
  const r = await embed([text], isQuery, prefer);
  const out = r?.vectors?.[0] ? { model: r.model, vec: r.vectors[0] } : null;
  if (out) {
    EMB_CACHE.set(key, out);
    if (EMB_CACHE.size > EMB_CACHE_MAX) { const oldest = EMB_CACHE.keys().next().value; if (oldest !== undefined) EMB_CACHE.delete(oldest); }   // evict oldest
  }
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
