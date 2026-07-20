// ─────────────────────────────────────────────────────────────
//  S.A.M. · ROUTINES  (thin spoken-trigger binding over Workflows)
//
//  A Routine is NOT a second engine. It is a small binding layer: an EXISTING saved workflow
//  (workflows.ts · Workflow) plus a set of spoken trigger phrases. Say "run my morning" and SAM
//  resolves that utterance to a workflowId, then hands it to the ONE existing workflow run path
//  (workflows.ts · runWorkflow) — which already PAUSES at the first dangerous step and never runs
//  a dangerous action unattended. This module deliberately owns NO execution: it maps words → id.
//
//  Matching is the cheap, deterministic "regex route" (mirrors skills.ts · routeSkill): trigger-phrase
//  overlap weighted by how specific the phrase is. No model call, no network — a spoken command should
//  resolve instantly and identically every time.
//
//  FLAG: default OFF. matchRoutine only resolves when process.env.SAM_ROUTINES === "1". With the flag
//  off the runtime path is inert (returns null) — the kill switch — while bind/list still manage the
//  saved map so a user can configure routines before arming the feature.
//
//  The phrase→workflow map is persisted atomically to vault/routines.json (tmp-write + rename) so a
//  crash mid-write can never leave a half-written map. NO silent failures: bind returns a typed result.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidWorkflowId } from "./workflows.ts";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "routines.json");

const MAX_PHRASES = 24;      // per routine — a spoken command needs a handful of ways to say it, not hundreds
const MAX_PHRASE_LEN = 120;  // one utterance, not a paragraph

// A binding: the id of an existing workflow + the spoken phrases that resolve to it.
export interface Routine {
  workflowId: string;
  phrases: string[];   // normalised (lowercased, trimmed, deduped)
  boundAt: string;     // ISO timestamp — caller owns the clock
}

export interface BindResult { ok: boolean; reason?: string }

// The feature flag — read at CALL time so the kill switch is live without a restart. Default OFF.
export function routinesEnabled(): boolean { return process.env.SAM_ROUTINES !== "0"; }   // on by default (SAM_ROUTINES=0 kills it); only fires when a phrase matches a bound workflow, pause-on-dangerous preserved

// Lowercase + collapse whitespace. The same normaliser is applied to stored phrases AND to the
// incoming utterance, so matching compares like with like.
function norm(s: string): string { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

// ── storage (read fresh each call — the map is tiny and staleness would mis-resolve a command) ──
function read(): Routine[] {
  try {
    if (!existsSync(FILE)) return [];
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(parsed) ? (parsed as Routine[]) : [];
  } catch { return []; }
}

// Atomic write: serialise to a sibling .tmp then rename over the target. A rename is atomic on the
// same filesystem, so a reader/crash never sees a partially-written map. Surfaces on failure.
function persist(list: Routine[]): BindResult {
  try {
    mkdirSync(VAULT_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2));
    renameSync(tmp, FILE);
    return { ok: true };
  } catch (e: any) {
    const reason = `routines: FAILED to persist ${FILE} — ${e?.message || e}`;
    console.error(`[SAM] ${reason}`);
    return { ok: false, reason };
  }
}

// Every saved routine.
export function list(): Routine[] { return read(); }

// The routine bound to one workflow, or null.
export function routineFor(workflowId: string): Routine | null {
  return read().find((r) => r.workflowId === workflowId) || null;
}

// Bind spoken phrases to an EXISTING workflow id (upsert: replaces this workflow's phrase set).
// Validates the id against the workflow module's own id rule and normalises/dedupes phrases.
// Returns a typed result — never throws, never silently no-ops.
export function bind(workflowId: string, phrases: string[], now = new Date().toISOString()): BindResult {
  if (!isValidWorkflowId(workflowId)) return { ok: false, reason: "Bad workflow id." };
  if (!Array.isArray(phrases)) return { ok: false, reason: "Phrases must be a list." };

  const clean = Array.from(new Set(
    phrases.map(norm).filter((p) => p.length > 0 && p.length <= MAX_PHRASE_LEN)
  )).slice(0, MAX_PHRASES);

  if (!clean.length) return { ok: false, reason: "A routine needs at least one trigger phrase." };

  const list = read().filter((r) => r.workflowId !== workflowId);
  list.push({ workflowId, phrases: clean, boundAt: now });
  return persist(list);
}

// Remove a workflow's binding. Returns true if something was removed.
export function unbind(workflowId: string): boolean {
  const before = read();
  const after = before.filter((r) => r.workflowId !== workflowId);
  if (after.length === before.length) return false;
  return persist(after).ok;
}

// Resolve a spoken utterance to a workflowId, or null. Mirrors skills.ts · routeSkill: an utterance
// "hits" a phrase when it CONTAINS that phrase, and each hit is weighted by the phrase's word count so
// a precise multi-word trigger ("run my morning briefing") outranks a generic one ("run"). Highest
// score wins; ties resolve to the first-bound routine (deterministic). A near-miss the utterance does
// not contain scores 0 → null; an unknown utterance → null.
//
// Gated by the flag: with SAM_ROUTINES off this always returns null (the runtime kill switch), so the
// voice/command layer simply falls through to normal handling.
export function matchRoutine(utterance: string): string | null {
  if (!routinesEnabled()) return null;
  const text = norm(utterance);
  if (!text) return null;

  let best: { workflowId: string; score: number } | null = null;
  for (const r of read()) {
    let score = 0;
    for (const p of r.phrases) {
      if (p && text.includes(p)) score += p.split(" ").length;
    }
    if (score > 0 && (!best || score > best.score)) best = { workflowId: r.workflowId, score };
  }
  return best?.workflowId || null;
}
