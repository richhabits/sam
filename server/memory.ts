// ─────────────────────────────────────────────────────────────
//  S.A.M. · SEMANTIC MEMORY  — SAM recalls the RIGHT past facts,
//  not just the last few. Stores ATOMIC FACTS (not raw logs),
//  embeds them, dedups on write, and retrieves the most relevant
//  for the current request. Flat-file vector store — tiny, fast,
//  no database. Vectors are tagged with their embedding model and
//  only same-model vectors are ever compared (dims must match).
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { embedOne, cosine } from "./embeddings.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const STORE = join(VAULT_DIR, "memory.json");
const MAX_ITEMS = 4000;
const DEDUP_SIM = 0.92;   // skip near-duplicate facts (research: dedup on write)

interface Mem { id: string; text: string; vec: number[]; model: string; kind: string; ts: number; hits: number }

let items: Mem[] = [];
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try { if (existsSync(STORE)) items = JSON.parse(readFileSync(STORE, "utf8")); } catch { items = []; }
}
function save() {
  try { mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(STORE, JSON.stringify(items)); } catch {}
}

// Store one atomic fact. Embeds it, skips near-duplicates, prunes to cap.
export async function remember(text: string, kind = "fact"): Promise<boolean> {
  load();
  const clean = (text || "").trim();
  if (clean.length < 8) return false;
  const e = await embedOne(clean, false);
  if (!e) return false;                                    // no embeddings available — skip silently
  for (let i = items.length - 1, seen = 0; i >= 0 && seen < 300; i--, seen++) {
    if (items[i].model === e.model && cosine(items[i].vec, e.vec) > DEDUP_SIM) return false;
  }
  items.push({ id: Date.now().toString(36) + items.length, text: clean, vec: e.vec, model: e.model, kind, ts: Date.now(), hits: 0 });
  if (items.length > MAX_ITEMS) items = items.slice(items.length - MAX_ITEMS);
  save();
  return true;
}

// Retrieve using an ALREADY-COMPUTED query embedding (reused across recall + routing).
export function recallWith(e: { model: string; vec: number[] } | null, k = 5, floor = 0.35): { text: string; score: number }[] {
  load();
  if (!items.length || !e) return [];
  const now = Date.now();
  const scored = items
    .filter((m) => m.model === e.model)
    .map((m) => {
      const sim = cosine(m.vec, e.vec);
      const ageDays = (now - m.ts) / 86400000;
      const recency = 1 - Math.min(0.25, ageDays * 0.004);  // gentle decay, capped at -25%
      return { m, score: sim * recency };
    })
    .filter((x) => x.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  for (const x of scored) x.m.hits++;
  return scored.map((x) => ({ text: x.m.text, score: x.score }));
}

// Convenience: embed the query then recall (when you don't already have a vector).
export async function recall(query: string, k = 5, floor = 0.35): Promise<{ text: string; score: number }[]> {
  return recallWith(await embedOne(query, true), k, floor);
}

export function memoryStats() { load(); return { count: items.length }; }
