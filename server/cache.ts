// ─────────────────────────────────────────────────────────────
//  S.A.M. · SEMANTIC CACHE  (Phase 2 — repeat answers = instant + free)
//
//  Before any brain call, look for a past answer to the SAME question in the
//  SAME context. A high-confidence hit is served instantly, with a
//  "from memory · 0 tokens" badge and a one-tap "re-ask fresh" option.
//
//  Two layers:
//   • EXACT   — normalised-text match. Zero embedding cost → truly instant,
//     works even on the fast path (greetings, re-asks, slash-repeats).
//   • SEMANTIC — cosine NN over stored query vectors (paraphrase hits), used
//     only when the caller already computed a query vector (no extra cost).
//
//  Correctness guards:
//   • INVALIDATION — the fingerprint hashes the ACTUAL context injected
//     (skill + recalled memory + docs). If a fact or file changes, the
//     recalled text changes → different fingerprint → automatic miss.
//   • NEVER CACHE — time-sensitive intent (today/now/news/price/weather),
//     anything the user marked private, and tool-driven answers (the caller
//     only stores tool-FREE finals, so dangerous-tool runs are never cached).
//   • TTL — entries expire (default 7 days) so stale facts age out.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cosine } from "./embeddings.ts";
import { needsLiveInfo } from "./agent.ts";
import type { Tier } from "./models.ts";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const CACHE_PATH = join(VAULT_DIR, "semantic_cache.json");
const TTL_MS = Number(process.env.SAM_CACHE_TTL_H || 168) * 3600 * 1000;   // default 7 days
const MAX_ENTRIES = 500;
const SEMANTIC_THRESHOLD = 0.93;   // conservative — near-identical only, so we never serve a wrong answer

interface Entry {
  norm: string;          // normalised question text (exact-match key)
  fp: string;            // context fingerprint (skill + recall + docs)
  model?: string;        // embedding model tag (for semantic matches)
  vec?: number[];        // query vector (semantic layer)
  answer: string;
  provider: string;
  tier: Tier;
  at: number;            // stored-at epoch ms
}

let entries: Entry[] = [];
let loaded = false;
let hits = 0, misses = 0;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!existsSync(CACHE_PATH)) return;
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    if (Array.isArray(raw?.entries)) entries = raw.entries;
  } catch { entries = []; }
}

let saveTimer: NodeJS.Timeout | null = null;
function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify({ entries }));
    } catch { /* best-effort */ }
  }, 1000);
  if (typeof saveTimer.unref === "function") saveTimer.unref();   // never hold the process open
}

function normalize(s: string): string {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[?!.]+$/, "");
}

// Anything the user asked to keep out of memory, or off-the-record drafts.
const PRIVATE_RE = /\b(private|off the record|don'?t (save|store|remember|cache)|do not (save|store|remember)|forget this)\b/i;

// Is this request safe + stable to cache at all? (Time-sensitive + private are excluded here;
// tool-driven answers are excluded by the caller only storing tool-free finals.)
export function cacheable(message: string): boolean {
  const m = message || "";
  if (m.length < 2) return false;
  if (needsLiveInfo(m)) return false;   // live/current info must never be served stale
  if (PRIVATE_RE.test(m)) return false;
  return true;
}

// Fingerprint the ACTUAL context that shaped the answer, so a change to any source misses.
export function fingerprint(parts: { skillId?: string | null; projectId?: string; userName?: string; mode?: string; persona?: string; lean?: boolean; recalled?: string; docs?: string }): string {
  const sig = [
    parts.skillId || "-",
    parts.projectId || "-",   // brand context is baked into the answer — never replay brand A's reply for brand B
    (parts.userName || "-").toLowerCase().trim(),
    parts.mode || "-",
    parts.persona || "sam",   // voice is part of the answer — never replay one persona's reply for another
    parts.lean ? "lean" : "full",
    normalize(parts.recalled || ""),
    normalize(parts.docs || ""),
  ].join("¦");
  return createHash("sha256").update(sig).digest("hex").slice(0, 16);
}

export interface CacheHit { answer: string; provider: string; tier: Tier; ageMs: number; semantic: boolean }

// Look for a fresh, same-context answer. Exact match first (free), then semantic (if a vector is given).
export function lookup(message: string, fp: string, qvec?: { model: string; vec: number[] } | null): CacheHit | null {
  load();
  const now = Date.now();
  const norm = normalize(message);

  // Drop expired entries lazily on read.
  if (entries.some((e) => now - e.at > TTL_MS)) entries = entries.filter((e) => now - e.at <= TTL_MS);

  // 1) EXACT — normalised text + same context.
  const exact = entries.find((e) => e.norm === norm && e.fp === fp);
  if (exact) { hits++; return { answer: exact.answer, provider: exact.provider, tier: exact.tier, ageMs: now - exact.at, semantic: false }; }

  // 2) SEMANTIC — nearest neighbour over same-model vectors, same context, above threshold.
  if (qvec?.vec?.length) {
    let best: Entry | null = null, bestS = 0;
    for (const e of entries) {
      if (e.fp !== fp || e.model !== qvec.model || !e.vec) continue;
      const s = cosine(e.vec, qvec.vec);
      if (s > bestS) { bestS = s; best = e; }
    }
    if (best && bestS >= SEMANTIC_THRESHOLD) { hits++; return { answer: best.answer, provider: best.provider, tier: best.tier, ageMs: now - best.at, semantic: true }; }
  }

  misses++;
  return null;
}

// Store a fresh answer. Caller guarantees it's a tool-free final for a cacheable request.
export function store(e: { message: string; fp: string; answer: string; provider: string; tier: Tier; qvec?: { model: string; vec: number[] } | null }): void {
  load();
  if (!e.answer || e.answer.length < 2) return;
  const norm = normalize(e.message);
  // Upsert: replace any existing exact+context entry.
  entries = entries.filter((x) => !(x.norm === norm && x.fp === e.fp));
  entries.push({
    norm, fp: e.fp, answer: e.answer, provider: e.provider, tier: e.tier, at: Date.now(),
    model: e.qvec?.model, vec: e.qvec?.vec,
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);   // LRU-ish (oldest first)
  saveSoon();
}

export function cacheStats() { load(); return { entries: entries.length, hits, misses }; }
export function clearCache(): void {
  entries = []; hits = 0; misses = 0;
  loaded = true;   // prevent a later lazy load() from resurrecting a stale on-disk cache (bench reproducibility)
  try { if (existsSync(CACHE_PATH)) writeFileSync(CACHE_PATH, JSON.stringify({ entries: [] })); } catch { /* best-effort */ }
}
