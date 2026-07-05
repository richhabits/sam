// ─────────────────────────────────────────────────────────────
//  S.A.M. · SEMANTIC ROUTING  — pick the RELEVANT tools & skill
//  for each message instead of stuffing all 37 tools every turn.
//  Research (RAG-MCP): retrieving relevant tools cuts prompt tokens
//  >50% AND ~3x's tool-selection accuracy on small free models.
//  Reuses the same embedding pipeline as memory.
//
//  OPTIMISATION: SHA-256 vector cache. On subsequent boots the full
//  tool+skill index loads from disk in <1ms with ZERO network calls.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { embed, cosine } from "./embeddings.ts";
import { pinnedModel } from "./memory.ts";
import { TOOLS } from "./tools.ts";
import type { Skill } from "./skills.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "..", "vault", "routing_cache.json");

// Always-available core so the model is never stranded without essentials.
const CORE = ["web_search", "web_fetch", "run_command", "get_datetime", "read_file", "list_dir"];

let toolIdx: { name: string; vec: number[] }[] = [];
let skillIdx: { id: string; vec: number[] }[] = [];
let model = "";
let building = false, built = false;

// Produce a stable SHA-256 fingerprint of the tool+skill catalogue.
// If this hasn't changed since last boot, the cached vectors are valid.
function catalogueHash(skills: Skill[]): string {
  const toolSigs = TOOLS.map((t) => `${t.name}: ${t.description}`).join("\n");
  const skillSigs = skills.map((s) => `${s.id}. ${s.triggers.join(", ")}`).join("\n");
  return createHash("sha256").update(toolSigs + "\n---\n" + skillSigs).digest("hex");
}

interface CacheData {
  hash: string;
  model: string;
  tools: { name: string; vec: number[] }[];
  skills: { id: string; vec: number[] }[];
}

function loadCache(hash: string): CacheData | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const raw: CacheData = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    if (raw.hash !== hash || !raw.model || !raw.tools?.length) return null;
    return raw;
  } catch { return null; }
}

function saveCache(data: CacheData) {
  try {
    const dir = dirname(CACHE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(data));
  } catch { /* best-effort */ }
}

// Build the tool + skill vector indexes once (lazy, non-blocking on boot).
// Uses the SHA-256 cache to skip embedding when nothing changed.
export async function buildIndexes(skills: Skill[]): Promise<void> {
  if (built || building) return;
  building = true;
  try {
    const hash = catalogueHash(skills);
    const pin = pinnedModel();

    // ── Fast path: load from disk cache ──
    const cached = loadCache(hash);
    if (cached && (!pin || cached.model === pin)) {
      toolIdx = cached.tools;
      skillIdx = cached.skills;
      model = cached.model;
      built = true;
      building = false;
      return;
    }

    // ── Slow path: embed everything + save cache ──
    const te = await embed(TOOLS.map((t) => `${t.name}: ${t.description}`), false, pin);
    if (te?.vectors.length) { model = te.model; toolIdx = TOOLS.map((t, i) => ({ name: t.name, vec: te.vectors[i] })); }
    const se = await embed(skills.map((s) => `${s.name}. ${s.triggers.join(", ")}`), false, model || pin);
    if (se?.vectors.length && se.model === model) skillIdx = skills.map((s, i) => ({ id: s.id, vec: se.vectors[i] }));
    built = toolIdx.length > 0;

    if (built) saveCache({ hash, model, tools: toolIdx, skills: skillIdx });
  } catch { /* routing falls back to keyword + all tools */ }
  building = false;
}

// Relevant tools for this query vector: core + top-k semantic matches. On a miss
// (no index yet / model mismatch), falls back to CORE + a keyword-matched subset
// of the query — NOT all 128 tools, which is a ~5k-token bomb on a free 3B model.
export function selectTools(q: { model: string; vec: number[] } | null, k = 8, text = ""): string[] {
  if (q && q.model === model && toolIdx.length) {
    const top = toolIdx
      .map((t) => ({ name: t.name, s: cosine(t.vec, q.vec) }))
      .sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.name);
    return Array.from(new Set([...CORE, ...top]));
  }
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const matched = words.length
    ? TOOLS.filter((t) => { const hay = (t.name + " " + t.description).toLowerCase(); return words.some((w) => hay.includes(w)); }).map((t) => t.name).slice(0, 12)
    : [];
  return Array.from(new Set([...CORE, ...matched]));
}

// Best skill id by semantic similarity (beats keyword on paraphrases). null → no clear match.
export function selectSkillId(q: { model: string; vec: number[] } | null): string | null {
  if (!q || q.model !== model || !skillIdx.length) return null;
  const best = skillIdx.map((s) => ({ id: s.id, s: cosine(s.vec, q.vec) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s > 0.32 ? best.id : null;
}

export function routingReady() { return built; }

