// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the job table
//
//  One SQLite file, its own, in write-ahead mode so the server and the worker can
//  both hold it open: the server enqueues and reads, the worker claims and reports.
//  They never share memory and never block each other — which is the whole point,
//  because a build that pegs a core must not make the assistant stop answering.
//
//  Claiming is a single conditional UPDATE rather than a read-then-write. Two workers
//  racing for the same job is not a hypothetical once a supervisor restarts one, and
//  the database is the only thing that can settle it honestly.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { openDb } from "../db.ts";
import {
  assertTransition,
  backoffMs,
  type FailureKind,
  HEARTBEAT_GRACE_MS,
  isClaimForfeit,
  isRetryable,
  type JobState,
  overBudget,
} from "./state.ts";

const MODULE = fileURLToPath(import.meta.url);

// join() NORMALISES, so a ROOT computed purely from this module's own path is only correct when
// the module sits exactly two directories below the checkout root — true for unbundled
// server/yard/store.ts, false the moment this file is bundled into a single dist/server.mjs
// sitting only ONE level down: the daemon (which always runs dist/server.mjs — see
// sam-server-supervisor.sh) then computes yardDir() one directory too high, while its own worker
// (spawned unbundled, so its guess is unaffected) computes the correct one. Two processes, same
// source, different answers — jobs enqueued via the real running daemon silently piled up
// unclaimed in the wrong file forever, and nothing errored because both paths are perfectly
// valid, writable directories. Same bug class isPackagedPath already fixes for app.asar; this is
// the parallel case for a bundled-but-unpacked checkout, which is how the daemon always runs.
//
// Verified against this exact file, not guessed: existsSync confirms whether the module-relative
// walk actually landed on a real checkout. process.cwd() is the fallback because the daemon
// always cd's into the repo root before starting (sam-server-supervisor.sh) — a second real
// signal, not another guess. modulePath/cwd/exists are injected so the bundled-vs-unbundled
// scenario is directly testable — the real bug only reproduces under a bundler, which a normal
// (unbundled) test run can never trigger by simply importing this file and calling the function.
export function guessRoot(
  modulePath: string = MODULE,
  cwd: string = process.cwd(),
  exists: (p: string) => boolean = existsSync,
): string {
  const fromModule = join(dirname(modulePath), "..", "..");
  if (exists(join(fromModule, "server", "yard", "store.ts"))) return fromModule;
  if (exists(join(cwd, "server", "yard", "store.ts"))) return cwd;
  return fromModule; // last resort — at least matches the old (buggy) behaviour, not silently different
}
const ROOT = guessRoot();

/**
 * Is this module running from inside a packaged app bundle?
 *
 * Asked of the MODULE path, never of ROOT, and that distinction is the entire bug this function
 * exists to record. ROOT is `join(dirname(module), "..", "..")`, and join() NORMALISES — so for
 * bundled code two levels deep, the `app.asar` segment is the thing the `..` eats:
 *
 *   app.asar/server/yard/store.ts  → ROOT = …/Resources/app.asar   ✅ contains "app.asar"
 *   app.asar/dist/server.mjs       → ROOT = …/Resources            ❌ does not
 *   app.asar/dist-electron/x.js    → ROOT = …/Resources            ❌ does not
 *
 * A packaged app only ever runs the bundled layouts, so the check that was written against ROOT
 * was false in exactly the case it was written for, and the yard went on resolving to
 * `…/SAM.app/Contents/Resources/yard` — inside the read-only bundle. It looked fine in CI, where
 * the app under `dist-app/` sits in a writable workspace and the database was quietly created
 * INSIDE the .app; it fails in /Applications, which is the only place a user has one.
 *
 * Exported so the three layouts above can be asserted directly, because a runtime that only
 * exists inside a DMG is not otherwise reachable from a test.
 */
export function isPackagedPath(modulePath: string): boolean {
  return modulePath.includes("app.asar");
}

export function yardDir(): string {
  if (process.env.YARD_DIR) return process.env.YARD_DIR;
  // A PACKAGED APP'S MODULES LIVE INSIDE app.asar, WHICH IS A READ-ONLY ARCHIVE.
  //
  // ROOT is derived from this module's own path, which is right for a checkout and wrong for
  // the desktop build: there it resolves to a directory inside the asar that cannot be created
  // or written. Everything under yardDir() — jobs.db, paired.json, worker.lock, logs/ — then
  // fails to open, and /api/yard answers 500 to a phone that is correctly paired. The yard has
  // therefore only ever worked when the server ran from a checkout, which is why the launchd
  // daemon could serve it and SAM.app never could.
  //
  // managed.ts's yardRoot() already had the right instinct — it anchors the projects tree on a
  // writable home directory rather than on the module. This does the same for the yard's own
  // state, and ONLY when packaged, so a checkout keeps using its repo-local yard/ and no
  // existing jobs move.
  if (isPackagedPath(MODULE)) {
    return join(process.env.SAMYARD_DIR || join(homedir(), "SAMYard"), "state");
  }
  return join(ROOT, "yard");
}

// A step the job itself declared as it ran — never a model guessing after the fact.
// "stopped" is distinct from "failed": a cancel or a budget stop is a decision, not a
// fault, same distinction the job's own failureKind already draws.
export interface JobStep {
  label: string;
  state: "running" | "done" | "failed" | "stopped";
  at: number;
  error?: string;
}

export interface Job {
  id: string;
  kind: string;
  payload: any;
  state: JobState;
  attempts: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  heartbeatAt: number | null;
  costTokens: number;
  costBudget: number | null;
  lastError: string | null;
  failureKind: FailureKind | null;
  cancelRequested: boolean;
  runAfter: number;
  logPath: string | null;
  project: string | null;
  steps: JobStep[];
  tier: string | null;   // the model tier actually used ("free"/"local"/"premium"/…), for A6's free-vs-paid split
}

const COLUMNS = `
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  heartbeat_at INTEGER,
  cost_tokens INTEGER NOT NULL DEFAULT 0,
  cost_budget INTEGER,
  last_error TEXT,
  failure_kind TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL DEFAULT 0,
  log_path TEXT,
  project TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]',
  tier TEXT
`;

function hydrate(r: any): Job {
  return {
    id: r.id, kind: r.kind,
    payload: (() => { try { return JSON.parse(r.payload); } catch { return {}; } })(),
    state: r.state, attempts: r.attempts,
    createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
    heartbeatAt: r.heartbeat_at, costTokens: r.cost_tokens, costBudget: r.cost_budget,
    lastError: r.last_error, failureKind: r.failure_kind,
    cancelRequested: !!r.cancel_requested, runAfter: r.run_after,
    logPath: r.log_path, project: r.project,
    steps: (() => { try { return JSON.parse(r.steps_json ?? "[]"); } catch { return []; } })(),
    tier: r.tier ?? null,
  };
}

export class JobStore {
  readonly db: Database.Database;

  constructor(file?: string) {
    const path = file ?? join(yardDir(), "jobs.db");
    if (path !== ":memory:") { const d = dirname(path); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
    // openDb, NOT `new Database` — and the difference is the whole of whether the yard works
    // from SAM.app. In a packaged build the electron bundler ignores `external`, so
    // better-sqlite3 is bundled and its own resolver looks for the native binary INSIDE the
    // read-only app.asar. preboot.ts finds the real one under app.asar.unpacked and puts the
    // path in SAM_SQLITE_BINDING; openDb is the one place that passes it. This line constructed
    // the database directly and so ignored all of that, and the packaged app died with
    // "Cannot find module .../app.asar/build/Release/better_sqlite3.node" the moment the yard
    // was switched on — while every test, typecheck and lint stayed green, because none of them
    // run the packaged app. That is the same failure v3.2.0 shipped, in the one file that had
    // not been moved onto the shared opener.
    this.db = openDb(path);
    // WAL lets the reader (server) and the writer (worker) coexist without either
    // stalling the other; busy_timeout covers the brief overlaps that remain.
    if (path !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (${COLUMNS});
                  CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, run_after);`);
    // A jobs.db from before A3 has no steps_json column — CREATE TABLE IF NOT EXISTS
    // doesn't add columns to an existing table. Same pattern as memory.ts's migration.
    try { this.db.exec(`ALTER TABLE jobs ADD COLUMN steps_json TEXT NOT NULL DEFAULT '[]'`); } catch { /* already there */ }
    try { this.db.exec(`ALTER TABLE jobs ADD COLUMN tier TEXT`); } catch { /* already there */ }
  }

  close() { try { this.db.close(); } catch { /* already closed — the desired end state */ } }

  enqueue(kind: string, payload: any = {}, opts: { budget?: number | null; project?: string | null; id?: string; now?: number } = {}): Job {
    const now = opts.now ?? Date.now();
    // Time-ordered id: sorting by id sorts by age, which makes the queue readable by eye.
    const id = opts.id ?? `job_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(
      `INSERT INTO jobs (id, kind, payload, state, created_at, cost_budget, project, run_after)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, 0)`,
    ).run(id, kind, JSON.stringify(payload ?? {}), now, opts.budget ?? null, opts.project ?? null);
    return this.get(id)!;
  }

  get(id: string): Job | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return r ? hydrate(r) : null;
  }

  list(state?: JobState, limit = 50): Job[] {
    const rows = state
      ? this.db.prepare("SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC LIMIT ?").all(state, limit)
      : this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map(hydrate);
  }

  queueDepth(now = Date.now()): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM jobs WHERE state='queued' AND run_after <= ?").get(now) as any).c;
  }

  // Claim the oldest ready job. The WHERE clause carries the state test, so if two
  // workers call this at once exactly one gets a row and the other gets nothing —
  // settled by the database rather than by hoping.
  //
  // Excludes a project that already has a job running: concurrency (more than one job
  // in flight at once, see workerLoop) means "no other worker is touching this project"
  // is no longer true by construction, and two jobs racing git commits or file writes in
  // the same working tree is real corruption, not a hypothetical. A NULL project (nothing
  // to collide over) is never excluded. This makes claim() itself the single place that
  // guarantees per-project single-flight, so it holds regardless of how many concurrent
  // slots — or, later, how many separate worker processes — call it.
  claim(now = Date.now(), logPath?: (id: string) => string): Job | null {
    const row: any = this.db.prepare(
      `SELECT id FROM jobs j WHERE state='queued' AND run_after <= ? AND cancel_requested = 0
       AND (j.project IS NULL OR NOT EXISTS (
         SELECT 1 FROM jobs r WHERE r.state='running' AND r.project = j.project
       ))
       ORDER BY created_at ASC LIMIT 1`,
    ).get(now);
    if (!row) return null;
    const res = this.db.prepare(
      `UPDATE jobs SET state='running', started_at=?, heartbeat_at=?, attempts=attempts+1, log_path=COALESCE(log_path, ?)
       WHERE id=? AND state='queued'`,
    ).run(now, now, logPath ? logPath(row.id) : null, row.id);
    if (res.changes === 0) return null;   // lost the race — the other worker has it
    return this.get(row.id);
  }

  heartbeat(id: string, now = Date.now()): void {
    this.db.prepare("UPDATE jobs SET heartbeat_at=? WHERE id=? AND state='running'").run(now, id);
  }

  // Metadata, not a state transition — can be called any number of times while a job
  // runs, unlike the state-machine methods below which each move the row exactly once.
  setSteps(id: string, steps: JobStep[]): void {
    this.db.prepare("UPDATE jobs SET steps_json=? WHERE id=?").run(JSON.stringify(steps.slice(-200)), id);
  }

  // Which tier actually ran, for A6's free-vs-paid split — recorded once, at first spend,
  // not reset on every subsequent spend() call within the same job.
  setTier(id: string, tier: string): void {
    this.db.prepare("UPDATE jobs SET tier=? WHERE id=? AND tier IS NULL").run(tier, id);
  }

  // The only columns a state transition may carry with it — the union of what the eight callers
  // actually set. Anything else is a mistake worth failing loudly on rather than writing.
  private static readonly PATCHABLE = new Set([
    "last_error", "failure_kind", "run_after", "heartbeat_at", "started_at", "steps_json", "cost_budget",
  ]);

  private transition(id: string, to: JobState, patch: Record<string, any> = {}, now = Date.now()): Job {
    const job = this.get(id);
    if (!job) throw new Error(`the yard: no job ${id}`);
    assertTransition(job.state, to);
    // Every key is checked against the columns this function is allowed to set. The keys are
    // interpolated straight into SQL, and all eight call sites pass literals — so this is not
    // reachable today. It is safe by CONVENTION rather than by construction, and the convention
    // holds only until someone forwards a patch from outside this file. Making it structural costs
    // one line; discovering it later costs considerably more.
    for (const k of Object.keys(patch)) {
      if (!JobStore.PATCHABLE.has(k)) throw new Error(`the yard: refusing to set unknown column "${k}"`);
    }
    const sets = ["state=@state", ...Object.keys(patch).map((k) => `${k}=@${k}`)];
    if (["done", "failed", "cancelled"].includes(to)) sets.push("finished_at=@finished_at");
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id=@id`)
      .run({ id, state: to, finished_at: now, ...patch });
    return this.get(id)!;
  }

  finish(id: string, now = Date.now()): Job { return this.transition(id, "done", {}, now); }

  fail(id: string, error: string, kind: FailureKind = "transient", now = Date.now()): Job {
    return this.transition(id, "failed", { last_error: String(error).slice(0, 2000), failure_kind: kind }, now);
  }

  // Cancel is a REQUEST while a job runs: the worker is mid-step and must be allowed to
  // stop cleanly rather than be shot. A queued job has nobody to ask, so it goes straight
  // across. Either way the operator's intent is recorded immediately.
  cancel(id: string, now = Date.now()): Job {
    const job = this.get(id);
    if (!job) throw new Error(`the yard: no job ${id}`);
    this.db.prepare("UPDATE jobs SET cancel_requested=1 WHERE id=?").run(id);
    if (job.state === "queued") return this.transition(id, "cancelled", {}, now);
    return this.get(id)!;
  }

  // Called by the worker once it notices the request between steps.
  acknowledgeCancel(id: string, now = Date.now()): Job { return this.transition(id, "cancelled", {}, now); }

  isCancelRequested(id: string): boolean {
    const r: any = this.db.prepare("SELECT cancel_requested c FROM jobs WHERE id=?").get(id);
    return !!r?.c;
  }

  // Spend against the job's own ceiling. Returns whether the ceiling has now been
  // crossed so the caller can stop BEFORE spending more, rather than reporting it after.
  addCost(id: string, tokens: number, now = Date.now()): { spent: number; stopped: boolean } {
    this.db.prepare("UPDATE jobs SET cost_tokens = cost_tokens + ? WHERE id=?").run(Math.max(0, Math.round(tokens)), id);
    const job = this.get(id)!;
    const stopped = overBudget(job.costTokens, job.costBudget);
    if (stopped && job.state === "running") {
      this.transition(id, "failed", { last_error: `stopped at its budget of ${job.costBudget} tokens`, failure_kind: "budget" }, now);
    }
    return { spent: job.costTokens, stopped };
  }

  // Retry a failed job — only where retrying is honest. A budget stop and an operator
  // cancel are decisions, not faults, and the machine does not overrule them.
  retry(id: string, now = Date.now()): Job | null {
    const job = this.get(id);
    if (job?.state !== "failed") return null;
    if (!isRetryable(job.failureKind ?? "permanent", job.attempts)) return null;
    // Fresh attempt, fresh checklist — last attempt's failed step staying on screen next
    // to a job that's running again would read as still-broken.
    return this.transition(id, "queued", { run_after: now + backoffMs(job.attempts), heartbeat_at: null, started_at: null, steps_json: "[]" }, now);
  }

  // Raising the ceiling is the operator's way to resume a budget stop. Deliberately
  // separate from retry(): it requires a new number, so nobody resumes by reflex.
  raiseBudgetAndRequeue(id: string, newBudget: number, now = Date.now()): Job | null {
    const job = this.get(id);
    if (job?.state !== "failed" || job.failureKind !== "budget") return null;
    if (newBudget <= job.costTokens) return null;   // wouldn't survive its first step
    return this.transition(id, "queued", { cost_budget: newBudget, run_after: now, heartbeat_at: null, started_at: null }, now);
  }

  // Recovery. A worker that was killed leaves its job `running` with a clock that stopped;
  // nothing else would ever move it. Run at startup and periodically: an abandoned job
  // fails honestly and becomes eligible for retry, instead of haunting the queue.
  reapAbandoned(now = Date.now()): Job[] {
    const reaped: Job[] = [];
    for (const job of this.list("running", 500)) {
      if (!isClaimForfeit(job, now)) continue;
      reaped.push(this.transition(job.id, "failed", {
        last_error: `the worker stopped reporting (no heartbeat for over ${Math.round(HEARTBEAT_GRACE_MS / 1000)}s)`,
        failure_kind: "abandoned",
      }, now));
    }
    return reaped;
  }

  // What the ops tile reads. Concurrency means "running" is no longer at most one job —
  // `current` stays for callers that only ever showed a single job (the oldest still
  // running, same as before concurrency existed), and `running` is the full list so a
  // panel can show every job actually in flight instead of silently hiding the rest.
  summary(now = Date.now()) {
    const count = (s: JobState) => (this.db.prepare("SELECT COUNT(*) c FROM jobs WHERE state=?").get(s) as any).c as number;
    const runningJobs = this.list("running", 20).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    const live = runningJobs[0] ?? null;
    const brief = (j: Job) => ({
      id: j.id, kind: j.kind, project: j.project,
      costTokens: j.costTokens, costBudget: j.costBudget,
      startedAt: j.startedAt, heartbeatAt: j.heartbeatAt,
      stale: isClaimForfeit(j, now),
    });
    return {
      queued: count("queued"), running: count("running"), done: count("done"),
      failed: count("failed"), cancelled: count("cancelled"),
      depth: this.queueDepth(now),
      current: live && brief(live),
      runningJobs: runningJobs.map(brief),
      lastFailure: this.list("failed", 1)[0]
        ? { id: this.list("failed", 1)[0].id, error: this.list("failed", 1)[0].lastError, kind: this.list("failed", 1)[0].failureKind }
        : null,
    };
  }

  // A6's meter. Queried over the WHOLE table, not the capped recent-jobs list — a "this
  // week" total computed from only the last 20 jobs would silently undercount on a busy
  // week, and "no invented currency" cuts both ways: an honest total or none at all.
  // Today/week are local calendar days (this runs on the operator's own machine).
  meter(now = Date.now()) {
    const d = new Date(now);
    const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;   // rolling 7 days, today included
    const sumSince = (since: number) =>
      (this.db.prepare("SELECT COALESCE(SUM(cost_tokens),0) c FROM jobs WHERE created_at >= ?").get(since) as any).c as number;
    const rows = this.db.prepare("SELECT tier, COALESCE(SUM(cost_tokens),0) c FROM jobs WHERE created_at >= ? GROUP BY tier")
      .all(weekStart) as { tier: string | null; c: number }[];
    const byTier: Record<string, number> = {};
    for (const r of rows) byTier[r.tier ?? "unattributed"] = r.c;
    return { todayTokens: sumSince(todayStart), weekTokens: sumSince(weekStart), byTier };
  }

  // Rung 3 (The Ledger) — real elapsed wall-clock minutes of agent work this calendar
  // month, from jobs that actually finished. Same "whole table, not the recent-20 list"
  // and "local calendar boundary" discipline as meter() above — this number feeds a public
  // cost claim, so it gets no less rigour than the token meter does.
  taskMinutesThisMonth(now = Date.now()): number {
    const d = new Date(now);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(finished_at - started_at), 0) ms FROM jobs WHERE state='done' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND started_at >= ?",
    ).get(monthStart) as { ms: number };
    return row.ms / 60_000;
  }
}
