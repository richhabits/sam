// ─────────────────────────────────────────────────────────────
//  S.A.M. · PREVIEW → COMMIT  — see a batch of changes before it happens, then enact it safely.
//
//  A batch of file writes is first PREVIEWED: each change is resolved to a concrete before/after so
//  the user (via the approval path) can inspect exactly what will change — nothing is touched. Then
//  COMMIT enacts it under the Latch, writing a journal step-by-step so a crash mid-commit leaves a
//  recoverable record, and:
//   • CONVERGENT — a change whose file already equals its `after` is a no-op, so re-committing an
//     already-applied plan does nothing (safe to retry).
//   • ATOMIC-ish — if a write fails partway, the steps already done are ROLLED BACK to their `before`,
//     so a batch never lands half-applied. recover() does the same for a crash-interrupted journal.
//
//  SAM has no transaction rollback of its own (its rollback is version rollback), so this carries the
//  before-state in the journal to undo. No silent failures: a rollback that itself fails is captured.
// ─────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { capture } from "./issues.ts";
import { withLatchSync } from "./latch.ts";

export interface WriteChange { kind: "write"; path: string; after: string }
export type Change = WriteChange;   // slice 1: file writes — concrete, diffable, reversible

export interface PreviewedChange {
  path: string;
  action: "create" | "modify" | "unchanged";
  before: string | null;   // null = the file doesn't exist yet
  after: string;
  addedLines: number;
  removedLines: number;
}
export interface Plan {
  changes: PreviewedChange[];
  summary: { creates: number; modifies: number; unchanged: number };
}
export interface CommitResult { ok: boolean; applied: string[]; skipped: string[]; rolledBack: string[]; error?: string }

const journalPath = () => join(process.env.VAULT_DIR || join(process.cwd(), "vault"), "preview-commit.journal.json");
const readOr = (path: string): string | null => { try { return readFileSync(path, "utf8"); } catch { return null; } };

// A cheap line delta for the preview — how many lines this change adds / removes. Not a full diff;
// enough for the approval view to say "+12 / -3". The UI can render before/after for the real diff.
function lineDelta(before: string | null, after: string): { added: number; removed: number } {
  const b = new Set((before ?? "").split("\n"));
  const a = new Set(after.split("\n"));
  let added = 0;
  let removed = 0;
  for (const l of a) if (!b.has(l)) added++;
  for (const l of b) if (!a.has(l)) removed++;
  return { added, removed };
}

/** Resolve each change against the current files. READ-ONLY — touches nothing. */
export function preview(changes: Change[]): Plan {
  const previewed = changes.map<PreviewedChange>((c) => {
    const before = readOr(c.path);
    const action = before === null ? "create" : before === c.after ? "unchanged" : "modify";
    const { added, removed } = lineDelta(before, c.after);
    return { path: c.path, action, before, after: c.after, addedLines: added, removedLines: removed };
  });
  return {
    changes: previewed,
    summary: {
      creates: previewed.filter((c) => c.action === "create").length,
      modifies: previewed.filter((c) => c.action === "modify").length,
      unchanged: previewed.filter((c) => c.action === "unchanged").length,
    },
  };
}

interface JournalStep { path: string; before: string | null; after: string; status: "pending" | "done" }
interface Journal { at: string; steps: JournalStep[] }

function writeJournal(j: Journal): void {
  const p = journalPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(j));
}
function readJournal(): Journal | null { try { return JSON.parse(readFileSync(journalPath(), "utf8")) as Journal; } catch { return null; } }
function clearJournal(): void { try { unlinkSync(journalPath()); } catch { /* nothing to clear */ } }

function undo(step: JournalStep): void {
  if (step.before === null) { try { unlinkSync(step.path); } catch { /* already gone */ } }
  else writeFileSync(step.path, step.before);
}

/** Enact a plan under the Latch, journalled and convergent. Rolls back completed steps if a write
 *  fails, so a batch never lands half-applied. */
export function commit(plan: Plan): CommitResult {
  return withLatchSync("preview-commit", (): CommitResult => {
    const skipped = plan.changes.filter((c) => c.action === "unchanged").map((c) => c.path);
    const journal: Journal = {
      at: new Date().toISOString(),
      steps: plan.changes.filter((c) => c.action !== "unchanged").map((c) => ({ path: c.path, before: c.before, after: c.after, status: "pending" })),
    };
    if (!journal.steps.length) return { ok: true, applied: [], skipped, rolledBack: [] };
    writeJournal(journal);
    const applied: string[] = [];
    const done: JournalStep[] = []; // ONLY steps we actually wrote this run — the rollback set
    try {
      for (const step of journal.steps) {
        // Convergent: the file already equals `after` (a prior run applied it). Leave it — and do NOT
        // add it to the rollback set, or a later failure would undo a file this run never touched.
        if (readOr(step.path) === step.after) { step.status = "done"; skipped.push(step.path); continue; }
        mkdirSync(dirname(step.path), { recursive: true });
        writeFileSync(step.path, step.after);
        step.status = "done";
        applied.push(step.path);
        done.push(step);
        writeJournal(journal); // persist progress after each step so a crash is recoverable
      }
      clearJournal();
      return { ok: true, applied, skipped, rolledBack: [] };
    } catch (e) {
      const rolledBack: string[] = [];
      for (const step of [...done].reverse()) {
        try { undo(step); rolledBack.push(step.path); } catch (undoErr) { capture(undoErr, { commit: "rollback", path: step.path }); }
      }
      clearJournal();
      capture(e, { commit: "failed", steps: journal.steps.length });
      return { ok: false, applied: [], skipped, rolledBack, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** After a crash: if a commit was interrupted, roll its applied steps back to before-state, so the
 *  batch is all-or-nothing across restarts too. Returns the paths restored. */
export function recover(): { rolledBack: string[] } {
  const j = readJournal();
  if (!j) return { rolledBack: [] };
  const rolledBack: string[] = [];
  for (const step of [...j.steps].reverse()) {
    if (step.status !== "done") continue;         // never applied → nothing to undo
    if (readOr(step.path) !== step.after) continue; // changed since → don't clobber
    try { undo(step); rolledBack.push(step.path); } catch (e) { capture(e, { commit: "recover", path: step.path }); }
  }
  clearJournal();
  return { rolledBack };
}

/** Is there an interrupted commit awaiting recovery? (for the boot check / status) */
export function pendingCommit(): boolean { return existsSync(journalPath()); }
