// ─────────────────────────────────────────────────────────────
//  S.A.M. · EMBEDDINGS  — text → vectors for semantic recall + routing.
//  FREE & low-RAM: Jina API (no RAM) → Gemini (no RAM) → Ollama
//  nomic-embed (local). ONE provider is used per call and the model
//  is TAGGED — you must never compare vectors from different models
//  (different dims), so callers filter by the returned `model`.
// ─────────────────────────────────────────────────────────────

import { getKey } from "./keys.ts";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

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
    const vectors: number[][] = [];
    for (const text of texts) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: 768 }) }
      );
      if (!r.ok) return null;
      const d = await r.json();
      if (!d?.embedding?.values) return null;
      vectors.push(d.embedding.values);
    }
    return { model: "gemini-001-768", vectors };
  } catch { return null; }
}

async function viaOllama(texts: string[]): Promise<Embedded | null> {
  try {
    const vectors: number[][] = [];
    for (const text of texts) {
      const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text", prompt: text }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (!d?.embedding) return null;
      vectors.push(d.embedding);
    }
    return vectors.length ? { model: "nomic", vectors } : null;
  } catch { return null; }
}

// Embed a batch — returns tagged vectors, or null if no provider available.
export async function embed(texts: string[], isQuery = false): Promise<Embedded | null> {
  if (!texts.length) return { model: "none", vectors: [] };
  return (await viaJina(texts, isQuery)) || (await viaGemini(texts)) || (await viaOllama(texts));
}

export async function embedOne(text: string, isQuery = false): Promise<{ model: string; vec: number[] } | null> {
  const r = await embed([text], isQuery);
  return r?.vectors?.[0] ? { model: r.model, vec: r.vectors[0] } : null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
