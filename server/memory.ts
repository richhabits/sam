// ─────────────────────────────────────────────────────────────
//  S.A.M. · SEMANTIC MEMORY  — SAM recalls the RIGHT past facts,
//  not just the last few. Stores ATOMIC FACTS (not raw logs),
//  embeds them, dedups on write, and retrieves the most relevant
//  for the current request. 
//  Upgraded to SQLite for infinite scale and zero memory bloat.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { embedOne, cosine } from "./embeddings.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const DB_PATH = join(VAULT_DIR, "memory.db");
const OLD_STORE = join(VAULT_DIR, "memory.json");
const DEDUP_SIM = 0.92;   // skip near-duplicate facts (research: dedup on write)

mkdirSync(VAULT_DIR, { recursive: true });
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    vec TEXT NOT NULL,
    model TEXT NOT NULL,
    kind TEXT NOT NULL,
    ts INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0
  )
`);
// Multi-user: each person's memories live under their own namespace (their name).
try { db.exec(`ALTER TABLE memories ADD COLUMN user TEXT NOT NULL DEFAULT ''`); } catch { /* already there */ }
const normUser = (u?: string) => (u || "").toLowerCase().trim().slice(0, 60);

// The OWNER is the first-ever named user, persisted so it survives restarts. ONLY the owner
// ever adopts/sees the legacy (untagged) memories — a family member connecting first after an
// update can never inherit the owner's private history. Anyone who isn't the owner starts clean.
const OWNER_FILE = join(process.env.VAULT_DIR || join(__dirname, "..", "vault"), "owner.json");
let _owner: string | null = (() => { try { return existsSync(OWNER_FILE) ? JSON.parse(readFileSync(OWNER_FILE, "utf8")).owner || null : null; } catch { return null; } })();
let _adopted = false;
function adoptLegacy(ns: string) {
  if (!ns) return;
  if (!_owner) {                       // first-ever named user becomes the owner (persisted)
    _owner = ns;
    try { mkdirSync(dirname(OWNER_FILE), { recursive: true }); writeFileSync(OWNER_FILE, JSON.stringify({ owner: ns })); } catch {}
  }
  if (_adopted || ns !== _owner) return;   // only the owner adopts legacy memories
  _adopted = true;
  try { const r = db.prepare(`UPDATE memories SET user = ? WHERE user = '' OR user IS NULL`).run(ns); if (r.changes) _vecCache.clear(); } catch {}
}

// ── MIGRATION (memory.json -> SQLite) ──
// Only touch the (up to 155KB) legacy file when the DB is EMPTY — once migrated, don't
// read+parse it on every boot. (Gate the READ on count, not just the insert.)
const _migCount = db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number };
if (_migCount.c === 0 && existsSync(OLD_STORE)) {
  try {
    const oldItems = JSON.parse(readFileSync(OLD_STORE, "utf8"));
    if (Array.isArray(oldItems) && oldItems.length > 0) {
      console.log(`[Memory] Migrating ${oldItems.length} items from memory.json to SQLite...`);
      const insert = db.prepare(`INSERT INTO memories (id, text, vec, model, kind, ts, hits) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const tx = db.transaction((items) => {
        for (const item of items) {
          insert.run(item.id, item.text, JSON.stringify(item.vec), item.model, item.kind || "fact", item.ts || Date.now(), item.hits || 0);
        }
      });
      tx(oldItems);
      console.log(`[Memory] Migration complete. (You can safely delete memory.json)`);
    }
  } catch (e) {
    console.error("[Memory] Failed to migrate old memory.json", e);
  }
}

// ── CORE LOGIC ──

// Store one atomic fact. Embeds it, skips near-duplicates.
// The embedding model this vault already uses (most memories). Pin to it so a
// provider rotation between sessions doesn't orphan everything stored under the
// old model. `undefined` = not computed yet; `null` = empty vault.
let _pinned: string | null | undefined = undefined;
export function pinnedModel(): string | null {
  if (_pinned !== undefined) return _pinned;
  try { const row = db.prepare(`SELECT model FROM memories GROUP BY model ORDER BY COUNT(*) DESC LIMIT 1`).get() as { model?: string } | undefined; _pinned = row?.model ?? null; } catch { _pinned = null; }
  return _pinned;
}

// In-memory Float32 vector index per model — each stored vector is parsed ONCE, then
// recall and dedup iterate typed arrays instead of JSON.parse-ing the whole table every
// turn (~22x faster at 1000+ memories). Kept in sync on every write/delete below.
type VecRow = { id: string; vec: Float32Array; ts: number; user: string };
const _vecCache = new Map<string, VecRow[]>();
function vecIndex(model: string): VecRow[] {
  let idx = _vecCache.get(model);
  if (idx) return idx;
  idx = [];
  const rows = db.prepare(`SELECT id, vec, ts, user FROM memories WHERE model = ?`).all(model) as { id: string; vec: string; ts: number; user: string }[];
  for (const r of rows) { try { idx.push({ id: r.id, vec: Float32Array.from(JSON.parse(r.vec)), ts: r.ts, user: r.user || "" }); } catch { /* skip corrupt row */ } }
  _vecCache.set(model, idx);
  return idx;
}

export async function remember(text: string, kind = "fact", user?: string): Promise<boolean> {
  const ns = normUser(user); adoptLegacy(ns);
  const clean = (text || "").trim();
  if (clean.length < 8) return false;

  const e = await embedOne(clean, false, pinnedModel());   // pin to the vault's model
  if (!e) return false; // no embeddings available — skip silently

  // Dedup against the in-memory index (no per-write full-table JSON.parse).
  const index = vecIndex(e.model);
  for (const row of index) if (row.user === ns && cosine(row.vec, e.vec) > DEDUP_SIM) return false; // Duplicate (same user)

  // Round the vector to 4 dp — identical for cosine matching, ~60% smaller on disk.
  const vec = e.vec.map((v) => Math.round(v * 1e4) / 1e4);
  const id = Date.now().toString(36) + Math.floor(Math.random() * 1000);
  const ts = Date.now();

  db.prepare(`INSERT INTO memories (id, text, vec, model, kind, ts, hits, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, clean, JSON.stringify(vec), e.model, kind, ts, 0, ns
  );
  index.push({ id, vec: Float32Array.from(vec), ts, user: ns });   // keep the index in sync
  _pinned = e.model;   // once we've written under a model, pin the vault to it
  return true;
}

// Retrieve using an ALREADY-COMPUTED query embedding (reused across recall + routing).
export function recallWith(e: { model: string; vec: number[] } | null, k = 5, floor = 0.35, user?: string): { id?: string, text: string; score: number }[] {
  const ns = normUser(user); adoptLegacy(ns);
  if (!e) return [];
  const now = Date.now();

  const index = vecIndex(e.model);   // parsed-once typed vectors — no per-turn JSON.parse
  if (!index.length) return [];

  const scored = [];
  for (const row of index) {
    if (row.user !== ns) continue;   // only THIS person's memories
    const sim = cosine(row.vec, e.vec);
    const ageDays = (now - row.ts) / 86400000;
    const recency = 1 - Math.min(0.25, ageDays * 0.004);  // gentle decay, capped at -25%
    const score = sim * recency;
    if (score >= floor) {
      scored.push({ id: row.id, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);
  if (!top.length) return [];

  // Fetch the actual text for only the top K hits
  const results = [];
  const getStmt = db.prepare(`SELECT text FROM memories WHERE id = ?`);
  const hitStmt = db.prepare(`UPDATE memories SET hits = hits + 1 WHERE id = ?`);
  
  for (const t of top) {
    const row = getStmt.get(t.id) as { text: string };
    if (row) {
      hitStmt.run(t.id);
      results.push({ id: t.id, text: row.text, score: t.score });
    }
  }

  return results;
}

// Convenience: embed the query then recall (when you don't already have a vector).
export async function recall(query: string, k = 5, floor = 0.35): Promise<{ id?: string, text: string; score: number }[]> {
  return recallWith(await embedOne(query, true, pinnedModel()), k, floor);   // pin so recall matches stored memories
}

export function memoryStats() {
  const count = db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number };
  return { count: count.c };
}

export function forget(id: string): boolean {
  const result = db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  if (result.changes > 0) for (const [m, idx] of _vecCache) {   // keep the index in sync
    const i = idx.findIndex((r) => r.id === id);
    if (i >= 0) { idx.splice(i, 1); break; }
  }
  return result.changes > 0;
}

export function listRecent(limit = 10): { id: string; text: string; ts: number }[] {
  return db.prepare("SELECT id, text, ts FROM memories ORDER BY ts DESC LIMIT ?").all(limit) as { id: string; text: string; ts: number }[];
}

export function clearAll(): void {
  db.prepare("DELETE FROM memories").run();
  _vecCache.clear();
  _pinned = null;   // vault is empty again — re-pin to whatever model next writes
}
