// ─────────────────────────────────────────────────────────────
//  S.A.M. · SEMANTIC MEMORY  — SAM recalls the RIGHT past facts,
//  not just the last few. Stores ATOMIC FACTS (not raw logs),
//  embeds them, dedups on write, and retrieves the most relevant
//  for the current request. 
//  Upgraded to SQLite for infinite scale and zero memory bloat.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

// ── MIGRATION (memory.json -> SQLite) ──
if (existsSync(OLD_STORE)) {
  try {
    const oldItems = JSON.parse(readFileSync(OLD_STORE, "utf8"));
    const count = db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number };
    if (count.c === 0 && Array.isArray(oldItems) && oldItems.length > 0) {
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
export async function remember(text: string, kind = "fact"): Promise<boolean> {
  const clean = (text || "").trim();
  if (clean.length < 8) return false;
  
  const e = await embedOne(clean, false);
  if (!e) return false; // no embeddings available — skip silently

  // Dedup: fetch recent memories with the same model to check for duplicates.
  // Instead of scanning all, we'll scan the most recent 300 of the same model.
  const recent = db.prepare(`SELECT vec FROM memories WHERE model = ? ORDER BY ts DESC LIMIT 300`).all(e.model) as { vec: string }[];
  for (const row of recent) {
    const parsedVec = JSON.parse(row.vec);
    if (cosine(parsedVec, e.vec) > DEDUP_SIM) return false; // Duplicate
  }

  // Round the vector to 4 dp — identical for cosine matching, ~60% smaller on disk.
  const vec = e.vec.map((v) => Math.round(v * 1e4) / 1e4);
  const id = Date.now().toString(36) + Math.floor(Math.random() * 1000);
  
  db.prepare(`INSERT INTO memories (id, text, vec, model, kind, ts, hits) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, clean, JSON.stringify(vec), e.model, kind, Date.now(), 0
  );
  return true;
}

// Retrieve using an ALREADY-COMPUTED query embedding (reused across recall + routing).
export function recallWith(e: { model: string; vec: number[] } | null, k = 5, floor = 0.35): { text: string; score: number }[] {
  if (!e) return [];
  const now = Date.now();
  
  // To keep memory low, we only fetch id, vec, ts (not the giant text blocks)
  const rows = db.prepare(`SELECT id, vec, ts FROM memories WHERE model = ?`).all(e.model) as { id: string, vec: string, ts: number }[];
  if (!rows.length) return [];

  const scored = [];
  for (const row of rows) {
    const parsedVec = JSON.parse(row.vec);
    const sim = cosine(parsedVec, e.vec);
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
      results.push({ text: row.text, score: t.score });
    }
  }

  return results;
}

// Convenience: embed the query then recall (when you don't already have a vector).
export async function recall(query: string, k = 5, floor = 0.35): Promise<{ text: string; score: number }[]> {
  return recallWith(await embedOne(query, true), k, floor);
}

export function memoryStats() {
  const count = db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number };
  return { count: count.c };
}
