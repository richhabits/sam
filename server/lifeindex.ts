// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE LIFE INDEX  (Phase 3 — SAM indexes your world)
//
//  Cursor indexes your repo; SAM indexes the folders YOU choose. The user
//  explicitly picks folders (Documents, Desktop, a projects dir, the vault) —
//  NOTHING is indexed without selection. Each folder is embedded on-device
//  (reusing ingest.ts) and kept fresh by a debounced file-watcher, so edits
//  flow into recall automatically. Every answer can cite the source file.
//
//  Guardrails baked in:
//   • LOCAL ONLY — vectors live in the vault, never leave the machine.
//   • PAUSE ON BATTERY — no background re-index while unplugged (macOS).
//   • LOW PRIORITY — debounced, one folder at a time, bounded by ingest caps.
//   • EXPLICIT — folders are added by the user; we never scan the whole disk.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, watch, FSWatcher } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ingestFolder, forgetDoc, searchDocs, IngestReport } from "./ingest.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const STORE = join(VAULT_DIR, "life_index.json");
const DEBOUNCE_MS = 4000;         // batch a burst of edits into one re-index
const REINDEX_COOLDOWN_MS = 60_000;   // never re-index the same folder more than once a minute

export interface WatchedFolder { path: string; addedAt: number; lastIndexedAt?: number; files?: number; chunks?: number }
interface Store { folders: WatchedFolder[]; watching: boolean }

function expand(p: string): string { return resolve((p || "").replace(/^~(?=$|\/)/, homedir())); }

function load(): Store {
  try { if (existsSync(STORE)) return JSON.parse(readFileSync(STORE, "utf8")); } catch { /* fresh */ }
  return { folders: [], watching: true };
}
function save(s: Store): void {
  try { if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(STORE, JSON.stringify(s, null, 2)); } catch { /* best-effort */ }
}

export function listFolders(): WatchedFolder[] { return load().folders; }

// ── BATTERY AWARENESS (macOS) — don't chew battery re-indexing on the go ──
let _acPower: boolean | null = null, _acAt = 0;
export function onACPower(): Promise<boolean> {
  const now = Date.now();
  if (_acPower !== null && now - _acAt < 30_000) return Promise.resolve(_acPower);
  _acAt = now;
  if (process.platform !== "darwin") { _acPower = true; return Promise.resolve(true); }   // only gate on macOS
  return new Promise((res) => {
    execFile("/usr/bin/pmset", ["-g", "batt"], { timeout: 2000 }, (err, out) => {
      _acPower = err ? true : /AC Power/.test(out || "");   // unknown → assume plugged (don't block on error)
      res(_acPower);
    });
  });
}

// ── INDEXING ─────────────────────────────────────────────────
let _busy = false;
async function indexOne(folder: string, maxFiles = 300): Promise<IngestReport | null> {
  if (_busy) return null;                    // one folder at a time — low CPU footprint
  if (!(await onACPower())) return null;     // paused on battery
  _busy = true;
  try {
    const r = await ingestFolder(folder, maxFiles);
    const s = load();
    const f = s.folders.find((x) => x.path === folder);
    if (f) { f.lastIndexedAt = Date.now(); f.files = (f.files || 0) + r.ingested; f.chunks = (f.chunks || 0) + r.chunks; save(s); }
    return r;
  } finally { _busy = false; }
}

// Add a folder the user chose → index it now and start watching it.
export async function addFolder(path: string): Promise<{ folder: WatchedFolder; report: IngestReport | null }> {
  const full = expand(path);
  const s = load();
  let folder = s.folders.find((f) => f.path === full);
  if (!folder) { folder = { path: full, addedAt: Date.now() }; s.folders.push(folder); save(s); }
  const report = await indexOne(full);
  if (s.watching) startWatching();   // pick up the new folder
  return { folder: load().folders.find((f) => f.path === full)!, report };
}

// Remove a folder → stop watching + purge its chunks from the library.
export function removeFolder(path: string): { removed: boolean; forgotten: number } {
  const full = expand(path);
  const s = load();
  const before = s.folders.length;
  s.folders = s.folders.filter((f) => f.path !== full);
  save(s);
  stopWatcher(full);
  const forgotten = forgetDoc(full);
  return { removed: s.folders.length < before, forgotten };
}

// Re-index everything the user selected (manual "refresh now").
export async function reindexAll(): Promise<IngestReport[]> {
  const out: IngestReport[] = [];
  for (const f of load().folders) { const r = await indexOne(f.path); if (r) out.push(r); }
  return out;
}

// ── FILE-WATCHERS ────────────────────────────────────────────
const watchers = new Map<string, FSWatcher>();
const reindexTimers = new Map<string, NodeJS.Timeout>();
const lastReindex = new Map<string, number>();

function scheduleReindex(folder: string): void {
  const prev = reindexTimers.get(folder);
  if (prev) clearTimeout(prev);
  const t = setTimeout(async () => {
    reindexTimers.delete(folder);
    const last = lastReindex.get(folder) || 0;
    if (Date.now() - last < REINDEX_COOLDOWN_MS) { scheduleReindex(folder); return; }   // cooldown — try later
    lastReindex.set(folder, Date.now());
    try { await indexOne(folder); } catch { /* incremental re-index is best-effort */ }
  }, DEBOUNCE_MS);
  if (typeof t.unref === "function") t.unref();
  reindexTimers.set(folder, t);
}

function watchOne(folder: string): void {
  if (watchers.has(folder)) return;
  try {
    const w = watch(folder, { recursive: process.platform !== "linux" }, (_ev, file) => {
      if (file && /^\./.test(String(file))) return;   // ignore dotfiles/temp
      scheduleReindex(folder);
    });
    w.on("error", () => stopWatcher(folder));   // folder deleted/unmounted → drop the watcher
    watchers.set(folder, w);
  } catch { /* folder unreadable — skip; user can re-add */ }
}

function stopWatcher(folder: string): void {
  watchers.get(folder)?.close();
  watchers.delete(folder);
  const t = reindexTimers.get(folder); if (t) { clearTimeout(t); reindexTimers.delete(folder); }
}

export function startWatching(): void {
  const s = load();
  if (!s.watching) return;
  for (const f of s.folders) watchOne(f.path);
}

export function stopWatching(): void { for (const p of [...watchers.keys()]) stopWatcher(p); }

export function setWatching(on: boolean): void {
  const s = load(); s.watching = on; save(s);
  if (on) startWatching(); else stopWatching();
}

// ── SCOPED Q&A ── answer grounded in ONE file/folder, with citations. ──
export async function askAbout(pathScope: string, question: string, k = 6): Promise<{ answer: string; sources: string[]; hits: { text: string; source: string; score: number }[] }> {
  const scope = expand(pathScope);
  const all = await searchDocs(question || pathScope, k * 3, 0.2);
  const inScope = all.filter((h) => h.source === scope || h.source.startsWith(scope + "/") || h.source.startsWith(scope));
  const hits = (inScope.length ? inScope : all).slice(0, k);
  const sources = [...new Set(hits.map((h) => h.source))];
  const answer = hits.length
    ? hits.map((h) => `- [${h.source.split("/").pop()}] ${h.text.slice(0, 400)}`).join("\n")
    : `Nothing indexed under ${scope} matches that yet. Add the folder to the life index (or run ingest) first.`;
  return { answer, sources, hits };
}

export function lifeIndexStats() {
  const s = load();
  return { folders: s.folders.length, watching: s.watching, watchers: watchers.size, paths: s.folders.map((f) => f.path) };
}
