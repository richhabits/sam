// ─────────────────────────────────────────────────────────────
//  S.A.M. · DOC INGESTION — SAM knows your documents.
//  Point it at any folder (a project, a drive) and it walks it,
//  extracts text (md/txt/pdf/docx/csv/json/html), chunks it,
//  embeds it and stores it in the vault next to memories.
//  INCREMENTAL: unchanged files (same mtime+size) are skipped,
//  so re-running on a huge drive only pays for what changed.
//  Doc hits are recalled by meaning at chat time, with the
//  source file cited — same free embedding lanes as memory.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, dirname, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { openDb } from "./db.ts";
import { embed, embedOne, cosine } from "./embeddings.ts";
import { pinnedModel } from "./memory.ts";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazy, per-vault DB handle — resolves VAULT_DIR at call time (tests point it
// at a temp dir) and shares memory.db with the memory subsystem.
let _db: Database.Database | null = null;
let _dbPath = "";
function db(): Database.Database {
  const vaultDir = process.env.VAULT_DIR || join(__dirname, "..", "vault");
  const path = join(vaultDir, "memory.db");
  if (_db && _dbPath === path) return _db;
  mkdirSync(vaultDir, { recursive: true });
  _db?.close();
  _db = openDb(path);
  _dbPath = path;
  _docCache.clear();   // new DB (e.g. VAULT_DIR changed in tests) → drop stale cached vectors
  _db.exec(`
    CREATE TABLE IF NOT EXISTS doc_files (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      chunks INTEGER NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      idx INTEGER NOT NULL,
      text TEXT NOT NULL,
      vec TEXT NOT NULL,
      model TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS docs_path ON docs(path);
    CREATE INDEX IF NOT EXISTS docs_model ON docs(model);
    CREATE TABLE IF NOT EXISTS doc_meta ( k TEXT PRIMARY KEY, v TEXT NOT NULL );
  `);
  return _db;
}

// ── WHAT GETS READ ───────────────────────────────────────────
const TEXT_EXTS = new Set([".md", ".txt", ".csv", ".json", ".html", ".htm"]);
const RICH_EXTS = new Set([".pdf", ".docx"]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;    // 2 MB for plain text
const MAX_RICH_BYTES = 20 * 1024 * 1024;   // 20 MB for pdf/docx
const MAX_CHARS_PER_FILE = 60_000;         // clip monster files
const CHUNK_CHARS = 1200;
const MIN_CHUNK_CHARS = 60;
const EMBED_BATCH = 32;

// Index-level fingerprint of the DERIVATION inputs that aren't the file content: the chunking
// params (and, at runtime, the embedder model). If either changes, the mtime+size per-file skip
// would keep serving vectors made by the OLD chunking/model — a silent stale HIT, the one
// unacceptable outcome. A change here BUSTS the whole index and forces a re-embed. Bump the
// leading version when chunkText's logic changes in a way that alters output for the same params.
const CHUNK_FP = `v1:${MAX_CHARS_PER_FILE}:${CHUNK_CHARS}:${MIN_CHUNK_CHARS}`;

// Never descend into these — system junk, caches, other apps' guts.
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", "vendor", "target",
  "__MACOSX", "Library", "Applications", "System",
]);
const skipDir = (name: string) => name.startsWith(".") || name.startsWith("_") || SKIP_DIRS.has(name);
const supported = (ext: string) => TEXT_EXTS.has(ext) || RICH_EXTS.has(ext);

export async function extractText(path: string, ext: string): Promise<string> {
  if (ext === ".pdf") {
    const pdfParse = require("pdf-parse");
    return (await pdfParse(await readFile(path)))?.text || "";
  }
  if (ext === ".docx") {
    const mammoth = require("mammoth");
    return (await mammoth.extractRawText({ buffer: await readFile(path) }))?.value || "";
  }
  let text = await readFile(path, "utf8");
  if (ext === ".html" || ext === ".htm") {
    text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  return text;
}

// Pack paragraphs into ~CHUNK_CHARS chunks (hard-split anything huge).
export function chunkText(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, MAX_CHARS_PER_FILE);
  if (text.length < MIN_CHUNK_CHARS) return [];
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  const flush = () => { if (cur.trim().length >= MIN_CHUNK_CHARS) chunks.push(cur.trim()); cur = ""; };
  for (const p of paras) {
    if (p.length > CHUNK_CHARS) {                       // one giant paragraph → hard-split
      flush();
      for (let i = 0; i < p.length; i += CHUNK_CHARS) chunks.push(p.slice(i, i + CHUNK_CHARS));
      continue;
    }
    if (cur.length + p.length + 1 > CHUNK_CHARS) flush();
    cur += (cur ? "\n" : "") + p;
  }
  flush();
  return chunks;
}

// ── WALK ─────────────────────────────────────────────────────
async function* walk(dir: string, depth = 0): AsyncGenerator<{ path: string; size: number; mtime: number }> {
  if (depth > 12) return;
  let names: string[] = [];
  try { names = await readdir(dir); } catch { return; }
  for (const name of names) {
    const full = join(dir, name);
    let s: Awaited<ReturnType<typeof stat>>;
    try { s = await stat(full); } catch { continue; }
    if (s.isDirectory()) {
      if (!skipDir(name)) yield* walk(full, depth + 1);
      continue;
    }
    if (name.startsWith(".")) continue;
    const ext = extname(name).toLowerCase();
    if (!supported(ext)) continue;
    if (s.size > (RICH_EXTS.has(ext) ? MAX_RICH_BYTES : MAX_TEXT_BYTES)) continue;
    yield { path: full, size: s.size, mtime: Math.floor(s.mtimeMs) };
  }
}

// ── INGEST ───────────────────────────────────────────────────
export interface IngestReport {
  root: string; scanned: number; ingested: number; unchanged: number;
  failed: number; chunks: number; remaining: number; evicted: number; busted?: string; note?: string;
}

export async function ingestFolder(rootPath: string, maxFiles = 300): Promise<IngestReport> {
  const root = resolve((rootPath || "").replace(/^~(?=$|\/)/, homedir()));
  const d = db();
  const report: IngestReport = { root, scanned: 0, ingested: 0, unchanged: 0, failed: 0, chunks: 0, remaining: 0, evicted: 0 };

  const known = d.prepare("SELECT mtime, size FROM doc_files WHERE path = ?");
  const delChunks = d.prepare("DELETE FROM docs WHERE path = ?");
  const delFile = d.prepare("DELETE FROM doc_files WHERE path = ?");
  const putFile = d.prepare("INSERT OR REPLACE INTO doc_files (path, mtime, size, chunks, ts) VALUES (?, ?, ?, ?, ?)");
  const putChunk = d.prepare("INSERT INTO docs (id, path, idx, text, vec, model, ts) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const getMeta = (k: string) => (d.prepare("SELECT v FROM doc_meta WHERE k = ?").get(k) as { v: string } | undefined)?.v || "";
  const setMeta = d.prepare("INSERT OR REPLACE INTO doc_meta (k, v) VALUES (?, ?)");

  // ── BUST on a derivation-input change ──
  // The per-file skip below trusts mtime+size for CONTENT. But the embedder model and chunk params
  // are index-wide inputs: if they changed since last run, every "unchanged" file would keep stale
  // vectors. Detect that up front (before the skip) and wipe the index so it all re-embeds. The
  // model is the vault's pinned embedder — switching it is the real-world trigger. A wrong HIT is
  // unacceptable, so when unsure we bust: a false bust just recomputes (safe); a missed one serves
  // stale results (the failure we refuse).
  const wantModel = pinnedModel() || "";
  const storedModel = getMeta("model");
  const storedChunk = getMeta("chunkfp");
  const modelChanged = !!storedModel && !!wantModel && storedModel !== wantModel;
  const chunkChanged = !!storedChunk && storedChunk !== CHUNK_FP;
  if (modelChanged || chunkChanged) {
    d.exec("DELETE FROM docs; DELETE FROM doc_files;");
    invalidateDocCache();
    report.busted = modelChanged ? `embedder changed (${storedModel} → ${wantModel}) — re-embedding all` : `chunking changed (${storedChunk} → ${CHUNK_FP}) — re-embedding all`;
  }

  let embedModel: string | null = null;   // set by the first successful batch; pinned thereafter

  for await (const f of walk(root)) {
    report.scanned++;
    const prev = known.get(f.path) as { mtime: number; size: number } | undefined;
    if (prev && prev.mtime === f.mtime && prev.size === f.size) { report.unchanged++; continue; }
    if (report.ingested >= maxFiles) { report.remaining++; continue; }

    try {
      const chunks = chunkText(await extractText(f.path, extname(f.path).toLowerCase()));
      if (!chunks.length) { putFile.run(f.path, f.mtime, f.size, 0, Date.now()); report.ingested++; continue; }

      const vectors: { vec: number[]; model: string }[] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        const e = await embed(batch, false, embedModel || pinnedModel());   // pin docs to the vault's model
        if (!e || e.vectors.length !== batch.length) throw new Error("embeddings unavailable");
        embedModel = e.model;
        for (const v of e.vectors) vectors.push({ vec: v, model: e.model });
      }

      const tx = d.transaction(() => {
        delChunks.run(f.path);   // re-ingest cleanly when a file changed
        chunks.forEach((text, idx) => {
          const vec = vectors[idx].vec.map((v) => Math.round(v * 1e4) / 1e4);   // 4 dp — same cosine, smaller disk
          putChunk.run(`${Date.now().toString(36)}-${idx}-${Math.floor(Math.random() * 1e6)}`, f.path, idx, text, JSON.stringify(vec), vectors[idx].model, Date.now());
        });
        putFile.run(f.path, f.mtime, f.size, chunks.length, Date.now());
      });
      tx();
      report.ingested++;
      report.chunks += chunks.length;
    } catch (e: any) {
      report.failed++;
      if (/embeddings unavailable/.test(String(e?.message))) {
        report.note = "Stopped: no embedding provider is reachable (add a free Jina/Gemini key or start Ollama).";
        break;
      }
    }
  }

  // ── EVICT deletes ──
  // A file removed from disk must leave the index — otherwise its chunks answer searches forever
  // (a stale hit of a different kind). Only evict files UNDER this root that no longer exist: a file
  // beyond the maxFiles cap, or under a different indexed root, is absent from this walk but must NOT
  // be dropped. existsSync is the source of truth, so the cap can't cause a wrong eviction.
  for (const row of d.prepare("SELECT path FROM doc_files").all() as { path: string }[]) {
    if (row.path.startsWith(root) && !existsSync(row.path)) {
      d.transaction(() => { delChunks.run(row.path); delFile.run(row.path); })();
      report.evicted++;
    }
  }

  // Persist the derivation fingerprint for next run's bust check. Use the model actually embedded
  // with (authoritative) when we did work, else the intended/stored one.
  setMeta.run("model", embedModel || wantModel || storedModel);
  setMeta.run("chunkfp", CHUNK_FP);

  if (report.ingested || report.evicted || report.busted) invalidateDocCache();   // index changed → rebuild on next search
  if (report.remaining) report.note = `${report.note ? report.note + " " : ""}Hit the ${maxFiles}-file cap — run again to continue (already-done files are skipped).`;
  return report;
}

// ── SEARCH ───────────────────────────────────────────────────
// In-memory Float32 index per model: each doc chunk's vector is parsed ONCE, then
// search iterates typed arrays instead of JSON.parse-ing every chunk each query.
// Ingestion/deletion is infrequent, so we just drop the cache on any write.
type DocVec = { id: string; path: string; vec: Float32Array };
const _docCache = new Map<string, DocVec[]>();
export function invalidateDocCache() { _docCache.clear(); }
function docIndex(model: string): DocVec[] {
  let idx = _docCache.get(model);
  if (idx) return idx;
  idx = [];
  const rows = db().prepare("SELECT id, path, vec FROM docs WHERE model = ?").all(model) as { id: string; path: string; vec: string }[];
  for (const r of rows) { try { idx.push({ id: r.id, path: r.path, vec: Float32Array.from(JSON.parse(r.vec)) }); } catch { /* skip corrupt */ } }
  _docCache.set(model, idx);
  return idx;
}
export function searchDocsWith(e: { model: string; vec: number[] } | null, k = 4, floor = 0.32): { text: string; source: string; score: number }[] {
  if (!e) return [];
  const index = docIndex(e.model);
  if (!index.length) return [];
  const scored: { id: string; path: string; score: number }[] = [];
  for (const row of index) {
    const score = cosine(row.vec, e.vec);
    if (score >= floor) scored.push({ id: row.id, path: row.path, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const get = db().prepare("SELECT text FROM docs WHERE id = ?");
  return scored.slice(0, k).map((t) => ({ text: (get.get(t.id) as { text: string }).text, source: t.path, score: t.score }));
}

// Convenience: embed the query then search (when you don't already have a vector).
export async function searchDocs(query: string, k = 6, floor = 0.28): Promise<{ text: string; source: string; score: number }[]> {
  return searchDocsWith(await embedOne(query, true, pinnedModel()), k, floor);
}

export function docsStats(): { files: number; chunks: number } {
  try {
    const files = (db().prepare("SELECT COUNT(*) AS c FROM doc_files").get() as { c: number }).c;
    const chunks = (db().prepare("SELECT COUNT(*) AS c FROM docs").get() as { c: number }).c;
    return { files, chunks };
  } catch { return { files: 0, chunks: 0 }; }
}

export function recentDocs(limit = 12): { path: string; chunks: number; ts: number }[] {
  return db().prepare("SELECT path, chunks, ts FROM doc_files ORDER BY ts DESC LIMIT ?").all(limit) as any[];
}

export function forgetDoc(pathLike: string): number {
  const p = resolve((pathLike || "").replace(/^~(?=$|\/)/, homedir()));
  const d = db();
  const tx = d.transaction(() => {
    const chunks = d.prepare("DELETE FROM docs WHERE path = ? OR path LIKE ?").run(p, p + "/%").changes;
    const files = d.prepare("DELETE FROM doc_files WHERE path = ? OR path LIKE ?").run(p, p + "/%").changes;
    return chunks || files;
  });
  const n = tx();
  if (n) invalidateDocCache();
  return n;
}

// Human summary for the tool result / chat.
export function reportText(r: IngestReport): string {
  const bits = [
    `Indexed ${r.ingested} file(s) (${r.chunks} chunks) from ${r.root}.`,
    r.unchanged ? `${r.unchanged} unchanged — skipped.` : "",
    r.failed ? `${r.failed} unreadable — skipped.` : "",
    r.remaining ? `${r.remaining} still to do.` : "",
    r.note || "",
  ].filter(Boolean);
  const s = docsStats();
  bits.push(`Library now: ${s.files} files, ${s.chunks} searchable chunks.`);
  return bits.join(" ");
}
