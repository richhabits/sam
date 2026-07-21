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

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type JobState, type FailureKind, assertTransition, isClaimForfeit,
  isRetryable, backoffMs, overBudget, HEARTBEAT_GRACE_MS,
} from "./state.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export function yardDir(): string {
  return process.env.YARD_DIR || join(ROOT, "yard");
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
  project TEXT
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
  };
}

export class JobStore {
  readonly db: Database.Database;

  constructor(file?: string) {
    const path = file ?? join(yardDir(), "jobs.db");
    if (path !== ":memory:") { const d = dirname(path); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
    this.db = new Database(path);
    // WAL lets the reader (server) and the writer (worker) coexist without either
    // stalling the other; busy_timeout covers the brief overlaps that remain.
    if (path !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (${COLUMNS});
                  CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, run_after);`);
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
  claim(now = Date.now(), logPath?: (id: string) => string): Job | null {
    const row: any = this.db.prepare(
      `SELECT id FROM jobs WHERE state='queued' AND run_after <= ? AND cancel_requested = 0
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

  private transition(id: string, to: JobState, patch: Record<string, any> = {}, now = Date.now()): Job {
    const job = this.get(id);
    if (!job) throw new Error(`the yard: no job ${id}`);
    assertTransition(job.state, to);
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
    return this.transition(id, "queued", { run_after: now + backoffMs(job.attempts), heartbeat_at: null, started_at: null }, now);
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

  // What the ops tile reads.
  summary(now = Date.now()) {
    const count = (s: JobState) => (this.db.prepare("SELECT COUNT(*) c FROM jobs WHERE state=?").get(s) as any).c as number;
    const running = this.list("running", 5);
    const live = running[0] ?? null;
    return {
      queued: count("queued"), running: count("running"), done: count("done"),
      failed: count("failed"), cancelled: count("cancelled"),
      depth: this.queueDepth(now),
      current: live && {
        id: live.id, kind: live.kind, project: live.project,
        costTokens: live.costTokens, costBudget: live.costBudget,
        startedAt: live.startedAt, heartbeatAt: live.heartbeatAt,
        stale: isClaimForfeit(live, now),
      },
      lastFailure: this.list("failed", 1)[0]
        ? { id: this.list("failed", 1)[0].id, error: this.list("failed", 1)[0].lastError, kind: this.list("failed", 1)[0].failureKind }
        : null,
    };
  }
}
