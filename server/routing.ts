// ─────────────────────────────────────────────────────────────
//  S.A.M. · SEMANTIC ROUTING  — pick the RELEVANT tools & skill
//  for each message instead of stuffing all 37 tools every turn.
//  Research (RAG-MCP): retrieving relevant tools cuts prompt tokens
//  >50% AND ~3x's tool-selection accuracy on small free models.
//  Reuses the same embedding pipeline as memory.
// ─────────────────────────────────────────────────────────────

import { embed, cosine } from "./embeddings.ts";
import { TOOLS } from "./tools.ts";
import type { Skill } from "./skills.ts";

// Always-available core so the model is never stranded without essentials.
const CORE = ["web_search", "web_fetch", "run_command", "get_datetime", "read_file", "list_dir"];

let toolIdx: { name: string; vec: number[] }[] = [];
let skillIdx: { id: string; vec: number[] }[] = [];
let model = "";
let building = false, built = false;

// Build the tool + skill vector indexes once (lazy, non-blocking on boot).
export async function buildIndexes(skills: Skill[]): Promise<void> {
  if (built || building) return;
  building = true;
  try {
    const te = await embed(TOOLS.map((t) => `${t.name}: ${t.description}`), false);
    if (te?.vectors.length) { model = te.model; toolIdx = TOOLS.map((t, i) => ({ name: t.name, vec: te.vectors[i] })); }
    const se = await embed(skills.map((s) => `${s.name}. ${s.triggers.join(", ")}`), false);
    if (se?.vectors.length && se.model === model) skillIdx = skills.map((s, i) => ({ id: s.id, vec: se.vectors[i] }));
    built = toolIdx.length > 0;
  } catch { /* routing falls back to keyword + all tools */ }
  building = false;
}

// Relevant tools for this query vector: core + top-k. Falls back to ALL tools.
export function selectTools(q: { model: string; vec: number[] } | null, k = 8): string[] {
  if (!q || q.model !== model || !toolIdx.length) return TOOLS.map((t) => t.name);
  const top = toolIdx
    .map((t) => ({ name: t.name, s: cosine(t.vec, q.vec) }))
    .sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.name);
  return Array.from(new Set([...CORE, ...top]));
}

// Best skill id by semantic similarity (beats keyword on paraphrases). null → no clear match.
export function selectSkillId(q: { model: string; vec: number[] } | null): string | null {
  if (!q || q.model !== model || !skillIdx.length) return null;
  const best = skillIdx.map((s) => ({ id: s.id, s: cosine(s.vec, q.vec) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s > 0.32 ? best.id : null;
}

export function routingReady() { return built; }
