// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE THRESHOLD  — the boundary SAM crosses at session start and stop.
//
//  SAM boots with world/swarm/crash restoration but has NO structured stop, and nothing carries
//  "what was I doing" across sessions. The Threshold adds two hook points: CROSS OUT persists a
//  durable, redacted session summary (recent activity + open threads); CROSS IN restores the last one
//  so the next session resumes with context. All LOCAL — nothing leaves the machine.
//
//  The cardinal rule here is the app's: NO SILENT FAILURE. Silent CONTEXT LOSS is the enemy — a
//  persist that fails is captured to the Black Box and RETURNED as an error (Outcome), never swallowed.
//  Storage is bounded (last KEEP sessions) so it can't grow without limit. Secrets are redacted before
//  anything is written.
// ─────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { capture, recentTrail, redact } from "./issues.ts";
import { pendingCommit } from "./preview-commit.ts";
import { loadSwarms } from "./swarm.ts";
import { err, ok, type Outcome } from "./outcome.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = () => join(process.env.VAULT_DIR || join(HERE, "..", "vault"), "threshold");
const FILE = () => join(dir(), "sessions.jsonl");
const KEEP = 20;   // bound storage growth — only the last KEEP sessions are retained

export interface SessionSummary {
  at: string;
  note: string;             // one-line human summary of the session
  openThreads: string[];    // what's unfinished (interrupted commit, active swarms)
  activity: string[];       // a few recent Trail lines (already redacted, redacted again defensively)
}
export type ThresholdError = { kind: "persist-failed"; detail: string };

/** On by default now the round-trip is proven; SAM_THRESHOLD=0 is the kill-switch (boot/stop hooks
 *  go inert). Both hooks are safe: CROSS IN only reads+logs; CROSS OUT is fail-loud and bounded. */
export function thresholdEnabled(): boolean { return process.env.SAM_THRESHOLD !== "0"; }

/** Assemble a session summary from the live signals — open threads + the recent Trail. Everything is
 *  run through redact() before it can be persisted. `at` is injected so this stays pure + testable. */
export function buildSummary(note = "session ended", at = new Date().toISOString()): SessionSummary {
  const openThreads: string[] = [];
  if (pendingCommit()) openThreads.push("an interrupted Preview → Commit awaiting recovery");
  const swarms = loadSwarms().length;
  if (swarms) openThreads.push(`${swarms} tracked agent swarm(s)`);
  const activity = recentTrail().slice(-8).map((t) => redact(`${t.kind}: ${t.msg}`));
  return { at, note: redact(note), openThreads, activity };
}

function readSessions(): SessionSummary[] {
  try {
    if (!existsSync(FILE())) return [];
    return readFileSync(FILE(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as SessionSummary);
  } catch { return []; }   // a corrupt log must not block a boot — start fresh, the loss is bounded
}

/**
 * CROSS OUT — persist a session summary. FAIL-LOUD: any write failure is captured to the Black Box
 * and RETURNED as an error; the session is NEVER reported saved when it wasn't (silent context loss
 * is the enemy). Bounded to the last KEEP sessions.
 */
export function crossOut(summary: SessionSummary): Outcome<{ persisted: string; kept: number }, ThresholdError> {
  try {
    mkdirSync(dir(), { recursive: true });
    const next = [...readSessions(), summary].slice(-KEEP);
    writeFileSync(FILE(), `${next.map((s) => JSON.stringify(s)).join("\n")}\n`);
    return ok({ persisted: FILE(), kept: next.length });
  } catch (e) {
    capture(e, { threshold: "crossOut" });   // LOUD — recorded, never swallowed
    return err({ kind: "persist-failed", detail: e instanceof Error ? e.message : String(e) });
  }
}

/** CROSS IN — the last session's summary, so SAM resumes with context. Null if there's none. */
export function crossIn(): SessionSummary | null {
  const all = readSessions();
  return all.length ? all[all.length - 1] : null;
}

/** All retained sessions (for inspection / the Console). */
export function sessions(): SessionSummary[] { return readSessions(); }
