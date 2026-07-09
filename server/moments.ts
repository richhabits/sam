// ─────────────────────────────────────────────────────────────
//  S.A.M. · SHARE MOMENTS  (v1.5 Phase 3 — the growth loop)
//
//  Subtle, one-tap "share this" prompts at the moments the user is happiest —
//  after a streak of instant cache hits, a forged tool that worked, a task done
//  entirely on the local brain, or their 10th successful task (the Star-SAM
//  card). NEVER nagging: every moment is one-tap dismissible FOREVER, and a
//  dismissed moment never returns. No telemetry — counters are local only.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const FILE = join(VAULT_DIR, "moments.json");
const REPO = "https://github.com/richhabits/sam";

interface State { tasks: number; cacheHits: number; cacheStreak: number; forged: number; localTasks: number; shown: string[]; dismissed: string[] }
const FRESH: State = { tasks: 0, cacheHits: 0, cacheStreak: 0, forged: 0, localTasks: 0, shown: [], dismissed: [] };

let state: State | null = null;
function load(): State { if (state) return state; try { state = existsSync(FILE) ? { ...FRESH, ...JSON.parse(readFileSync(FILE, "utf8")) } : { ...FRESH }; } catch { state = { ...FRESH }; } return state!; }
function save() { try { if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(load())); } catch { /* best-effort */ } }

export type SuccessKind = "task" | "cache-hit" | "local" | "forged";
export function recordSuccess(kind: SuccessKind): void {
  const s = load();
  if (kind === "cache-hit") { s.cacheHits++; s.cacheStreak++; } else s.cacheStreak = 0;
  if (kind === "local") s.localTasks++;
  if (kind === "forged") s.forged++;
  if (kind !== "cache-hit") s.tasks++;   // a served-from-memory hit isn't a "task", but keeps a streak
  else s.tasks++;
  save();
}

export interface Moment { id: string; kind: "star" | "share"; title: string; snippet: string; url: string }

// The next moment to surface, or null. One at a time; never a dismissed one; each shown once.
export function nextMoment(): Moment | null {
  const s = load();
  const seen = (id: string) => s.shown.includes(id) || s.dismissed.includes(id);
  const emit = (m: Moment) => { s.shown.push(m.id); save(); return m; };

  if (s.tasks >= 10 && !seen("star-10")) return emit({
    id: "star-10", kind: "star",
    title: "SAM's done 10 things for you 🎉",
    snippet: `SAM has quietly handled 10 tasks for me — free, private, on my own machine. If you'd like a free AI that actually does the work: ${REPO}`,
    url: REPO,
  });
  if (s.cacheStreak >= 3 && !seen(`share-cache-${Math.floor(s.cacheHits / 3)}`)) return emit({
    id: `share-cache-${Math.floor(s.cacheHits / 3)}`, kind: "share",
    title: "Answered from memory — instant + free ⚡",
    snippet: `SAM just answered 3 in a row straight from memory — 0 tokens, ~2ms. Local-first AI hits different. ${REPO}`,
    url: REPO,
  });
  if (s.forged >= 1 && !seen("share-forged")) return emit({
    id: "share-forged", kind: "share",
    title: "SAM built its own tool 🛠️",
    snippet: `Asked SAM for something it couldn't do — so it wrote the tool, sandbox-tested it, and did it. ${REPO}`,
    url: REPO,
  });
  if (s.localTasks >= 5 && !seen("share-local")) return emit({
    id: "share-local", kind: "share",
    title: "5 tasks, $0, nothing left your Mac 🔒",
    snippet: `5 tasks done entirely on my local brain — no cloud, no cost, fully private. ${REPO}`,
    url: REPO,
  });
  return null;
}

export function dismiss(id: string): void { const s = load(); if (!s.dismissed.includes(id)) s.dismissed.push(id); save(); }
export function momentStats() { const s = load(); return { tasks: s.tasks, cacheHits: s.cacheHits, forged: s.forged, localTasks: s.localTasks }; }

// Test-only: drop the in-memory singleton so a suite can start from a clean slate.
export function __resetForTest(): void { state = { ...FRESH, shown: [], dismissed: [] }; }
