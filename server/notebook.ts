// ─────────────────────────────────────────────────────────────
//  S.A.M. · NOTEBOOKS  — a NotebookLM, but yours and free.
//  Drop in sources (files · web pages · pasted text · a whole
//  research sweep of the web), and SAM answers ONLY from them,
//  with citations — plus a two-host "Audio Overview" podcast of
//  your material, spoken with SAM's free TTS. Everything is
//  chunked + embedded LOCALLY (free, private) next to memory.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname, extname, basename } from "node:path";
import type Database from "better-sqlite3";
import { openDb } from "./db.ts";
import { embed, embedOne, cosine } from "./embeddings.ts";
import { pinnedModel } from "./memory.ts";
import { chunkText, extractText } from "./ingest.ts";

// Lazy DB handle — opened on FIRST use, not at import. This keeps the (native) SQLite open OFF
// the boot path, so packaging into the Electron main process can't stall startup, and the vault
// path is resolved when VAULT_DIR is actually set. Resolves the same file memory.ts uses.
let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const VAULT = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
  mkdirSync(VAULT, { recursive: true });
  _db = openDb(join(VAULT, "memory.db"));
  _db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nb_chunks (
      id TEXT PRIMARY KEY, notebook TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL,
      idx INTEGER NOT NULL, text TEXT NOT NULL, vec TEXT NOT NULL, model TEXT NOT NULL, ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS nb_chunks_nb ON nb_chunks(notebook);
  `);
  return _db;
}

const slug = (s: string) => (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "notebook";
let _counter = 0;
const newId = () => `${Date.now().toString(36)}${(_counter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export interface Notebook { id: string; title: string; created: number; sources: number; chunks: number }

export function listNotebooks(): Notebook[] {
  const rows = db().prepare(`SELECT id, title, created FROM notebooks ORDER BY created DESC`).all() as { id: string; title: string; created: number }[];
  return rows.map((n) => {
    const c = db().prepare(`SELECT COUNT(*) c, COUNT(DISTINCT source) s FROM nb_chunks WHERE notebook = ?`).get(n.id) as { c: number; s: number };
    return { ...n, chunks: c.c, sources: c.s };
  });
}

// Find an existing notebook by id or title (case-insensitive), or create one.
export function ensureNotebook(idOrTitle: string): { id: string; title: string } {
  const key = (idOrTitle || "").trim();
  const found = db().prepare(`SELECT id, title FROM notebooks WHERE id = ? OR lower(title) = lower(?)`).get(key, key) as { id: string; title: string } | undefined;
  if (found) return found;
  const id = slug(key);
  const realId = db().prepare(`SELECT id FROM notebooks WHERE id = ?`).get(id) ? `${id}-${newId().slice(-4)}` : id;
  db().prepare(`INSERT INTO notebooks (id, title, created) VALUES (?, ?, ?)`).run(realId, key || "Notebook", Date.now());
  return { id: realId, title: key || "Notebook" };
}

// Turn raw text into embedded, retrievable chunks under a notebook + source label.
async function storeSource(notebookId: string, source: string, title: string, raw: string): Promise<number> {
  const chunks = chunkText(raw);
  if (!chunks.length) return 0;
  const e = await embed(chunks, false, pinnedModel());
  if (!e || !e.vectors.length) throw new Error("no embedding provider (start Ollama, or add a free key)");
  const ins = db().prepare(`INSERT INTO nb_chunks (id, notebook, source, title, idx, text, vec, model, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = db().transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const vec = e.vectors[i].map((v) => Math.round(v * 1e4) / 1e4);
      ins.run(newId(), notebookId, source, title, i, chunks[i], JSON.stringify(vec), e.model, Date.now());
    }
  });
  tx();
  return chunks.length;
}

// Strip a fetched HTML page down to readable text.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export async function addText(notebookId: string, title: string, text: string): Promise<number> {
  return storeSource(notebookId, title || "note", title || "Pasted note", text || "");
}

export async function addFile(notebookId: string, path: string): Promise<number> {
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  const raw = await extractText(path, extname(path).toLowerCase());
  return storeSource(notebookId, basename(path), basename(path), raw);
}

export async function addUrl(notebookId: string, url: string): Promise<{ chunks: number; title: string }> {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (SAM Notebook)" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const html = await r.text();
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || url).trim().slice(0, 120);
  const text = htmlToText(html);
  const chunks = await storeSource(notebookId, url, title, text);
  return { chunks, title };
}

export interface Passage { text: string; source: string; title: string; score: number }

// Retrieve the passages in a notebook most relevant to a question (grounded-answer context).
export async function retrieve(notebookId: string, question: string, k = 8): Promise<Passage[]> {
  const e = await embedOne(question, true, pinnedModel());
  if (!e) return [];
  const rows = db().prepare(`SELECT text, source, title, vec FROM nb_chunks WHERE notebook = ?`).all(notebookId) as { text: string; source: string; title: string; vec: string }[];
  const scored: Passage[] = [];
  for (const row of rows) {
    try { scored.push({ text: row.text, source: row.source, title: row.title, score: cosine(e.vec, JSON.parse(row.vec)) }); } catch {}
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// A representative spread of a notebook's material (for the audio overview / summary) —
// the first chunk of each source, so the podcast covers everything, not just chunk 1.
export function overviewChunks(notebookId: string, limit = 12): Passage[] {
  const rows = db().prepare(
    `SELECT text, source, title FROM nb_chunks WHERE notebook = ? AND idx = 0 ORDER BY ts ASC LIMIT ?`
  ).all(notebookId, limit) as { text: string; source: string; title: string }[];
  return rows.map((r) => ({ ...r, score: 1 }));
}

export function notebookSources(notebookId: string): { source: string; title: string; chunks: number }[] {
  return db().prepare(
    `SELECT source, title, COUNT(*) chunks FROM nb_chunks WHERE notebook = ? GROUP BY source ORDER BY MIN(ts)`
  ).all(notebookId) as { source: string; title: string; chunks: number }[];
}

export function deleteNotebook(notebookId: string): boolean {
  const a = db().prepare(`DELETE FROM nb_chunks WHERE notebook = ?`).run(notebookId);
  const b = db().prepare(`DELETE FROM notebooks WHERE id = ?`).run(notebookId);
  return a.changes > 0 || b.changes > 0;
}
