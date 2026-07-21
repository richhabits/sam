// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the worker
//
//  A SEPARATE OS PROCESS. This is the entire reason the yard exists: a build that
//  saturates a core has to be unable to make the assistant stop answering, and the
//  only honest way to guarantee that is to not run it on the same event loop. The
//  server enqueues and reads; this process claims and does the work. They meet only
//  in the job table.
//
//  The loop is deliberately dull: take one job, renew the claim while working, check
//  between steps whether the operator has asked it to stop, and record the outcome —
//  including the outcomes nobody enjoys. A worker that exits without recording why is
//  a worker that leaves a phantom in the queue, so every path here ends in a write.
// ─────────────────────────────────────────────────────────────

import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { JobStore, yardDir } from "./store.ts";
import { HEARTBEAT_MS, type FailureKind } from "./state.ts";

const IDLE_POLL_MS = 1000;
const LOCK_STALE_MS = 60_000;

// ── Single flight ───────────────────────────────────────────────────────────
// Two workers would both make progress and both be right, but the operator would
// see interleaved logs and double spend. A lock file with a pid is enough: a stale
// one (dead pid, or simply too old) is taken over rather than deferred to for ever.
export function lockPath(): string { return join(yardDir(), "worker.lock"); }

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function claimLock(now = Date.now()): boolean {
  const dir = yardDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = lockPath();
  if (existsSync(p)) {
    try {
      const held = JSON.parse(readFileSync(p, "utf8"));
      const fresh = now - Number(held.at || 0) < LOCK_STALE_MS;
      if (fresh && held.pid !== process.pid && pidAlive(Number(held.pid))) return false;
    } catch { /* unreadable lock is a dead lock — take it */ }
  }
  writeFileSync(p, JSON.stringify({ pid: process.pid, at: now }));
  return true;
}
export function refreshLock(now = Date.now()) {
  try { writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, at: now })); } catch { /* best effort */ }
}
export function releaseLock() {
  try {
    const held = JSON.parse(readFileSync(lockPath(), "utf8"));
    if (held.pid === process.pid) unlinkSync(lockPath());
  } catch { /* not ours, or already gone */ }
}

// ── Job logs ────────────────────────────────────────────────────────────────
const LOG_CAP = 2 * 1024 * 1024;

export function jobLogPath(id: string): string { return join(yardDir(), "logs", `${id}.log`); }

export class JobLog {
  private written = 0;
  private capped = false;
  constructor(private path: string) {
    const dir = join(this.path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  write(line: string) {
    if (this.capped) return;
    const text = `[${new Date().toISOString()}] ${line}\n`;
    if (this.written + text.length > LOG_CAP) {
      this.capped = true;
      try { appendFileSync(this.path, "\n— log truncated: this job produced more output than the yard keeps —\n"); } catch { /* disk gone */ }
      return;
    }
    this.written += text.length;
    try { appendFileSync(this.path, text); } catch { /* a job must not die because its log did */ }
  }
  tail(lines = 20): string[] {
    try { return readFileSync(this.path, "utf8").trim().split("\n").slice(-lines); } catch { return []; }
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────
// A handler receives the tools it is allowed to use and nothing else. `checkStop`
// is how a long handler stays interruptible: it throws when the operator has asked
// the job to stop, or when the meter has run out.

// `lost` means the job's row moved out from under the handler — reaped as abandoned,
// or stopped by the meter. It is NOT a synonym for a budget stop: reporting one as the
// other sent the operator hunting a spending limit that had nothing to do with it.
export class JobStopped extends Error {
  constructor(readonly why: "cancelled" | "budget" | "lost", readonly state?: string) {
    super(`job stopped: ${why}${state ? ` (now ${state})` : ""}`);
  }
}

export interface JobContext {
  id: string;
  payload: any;
  project: string | null;
  log: (line: string) => void;
  spend: (tokens: number) => void;
  checkStop: () => void;
}
export type Handler = (ctx: JobContext) => Promise<string | void>;

export const HANDLERS: Record<string, Handler> = {
  // A job that does nothing, slowly, while reporting — the honest way to prove the
  // spine keeps the rest of SAM responsive under load.
  sleep: async (ctx) => {
    // `|| 5` here would turn an explicit 0 into 5 — a zero-length job is a legitimate
    // thing to ask for, and silently lengthening it would make the spine untestable.
    const asked = Number(ctx.payload?.seconds);
    const seconds = Math.min(Math.max(Number.isFinite(asked) ? asked : 5, 0), 600);
    const burn = !!ctx.payload?.burn;
    ctx.log(`sleeping ${seconds}s${burn ? " while burning a core" : ""}`);
    for (let i = 0; i < seconds; i++) {
      ctx.checkStop();
      if (burn) { const until = Date.now() + 1000; while (Date.now() < until) { /* deliberate load */ } }
      else await new Promise((r) => setTimeout(r, 1000));
      ctx.log(`tick ${i + 1}/${seconds}`);
    }
    return `slept ${seconds}s`;
  },
};

export function registerHandler(kind: string, fn: Handler) { HANDLERS[kind] = fn; }

// ── The loop ────────────────────────────────────────────────────────────────

export async function runOneJob(store: JobStore, now = () => Date.now()): Promise<string | null> {
  const job = store.claim(now(), jobLogPath);
  if (!job) return null;

  const log = new JobLog(job.logPath ?? jobLogPath(job.id));
  const beat = setInterval(() => { store.heartbeat(job.id); refreshLock(); }, HEARTBEAT_MS);

  const ctx: JobContext = {
    id: job.id, payload: job.payload, project: job.project,
    log: (line) => log.write(line),
    spend: (tokens) => { if (store.addCost(job.id, tokens).stopped) throw new JobStopped("budget"); },
    checkStop: () => {
      // Renew the claim HERE, not only on a timer. A handler that pegs a core blocks
      // this process's own timers, so the interval below never fires, the claim goes
      // stale and the reaper kills a job that was working perfectly. Tying the renewal
      // to the stop-check makes the two disciplines one: a handler that can be
      // interrupted is, by the same act, a handler that proves it is alive.
      store.heartbeat(job.id);
      if (store.isCancelRequested(job.id)) throw new JobStopped("cancelled");
      const j = store.get(job.id);
      if (j && j.state !== "running") throw new JobStopped(j.state === "cancelled" ? "cancelled" : "lost", j.state);
    },
  };

  try {
    log.write(`claimed ${job.kind} (attempt ${job.attempts})`);
    const handler = HANDLERS[job.kind];
    if (!handler) throw Object.assign(new Error(`the yard has no handler for "${job.kind}"`), { kind: "permanent" as FailureKind });
    const result = await handler(ctx);
    ctx.checkStop();
    log.write(`done: ${result ?? "ok"}`);
    store.finish(job.id);
    return job.id;
  } catch (e: any) {
    if (e instanceof JobStopped) {
      log.write(`stopped: ${e.why}${e.state ? ` — the job is now ${e.state}` : ""}`);
      // A budget stop has already been recorded by the meter; only a cancel still
      // needs acknowledging. Guarded because the state may already have moved.
      if (e.why === "cancelled" && store.get(job.id)?.state === "running") store.acknowledgeCancel(job.id);
      return job.id;
    }
    const kind: FailureKind = e?.kind === "permanent" ? "permanent" : "transient";
    log.write(`failed (${kind}): ${e?.message || e}`);
    if (store.get(job.id)?.state === "running") store.fail(job.id, String(e?.message || e), kind);
    return job.id;
  } finally {
    clearInterval(beat);
  }
}

export async function workerLoop(store: JobStore, opts: { stop?: () => boolean } = {}) {
  const stop = opts.stop ?? (() => false);
  while (!stop()) {
    store.reapAbandoned();
    const did = await runOneJob(store);
    if (!did && !stop()) await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
  }
}

// ── Entrypoint ──────────────────────────────────────────────────────────────
// Only when run directly. Importing this module (the server does, for its handlers)
// must never start a second worker.
// Matches BOTH shapes this file is launched as: `server/yard/worker.ts` from source and
// `dist/yard-worker.mjs` once bundled. Missing the bundled name meant the built worker
// loaded, started nothing, and exited 0 — which the supervisor dutifully retried for ever.
export function isWorkerEntrypoint(argv1: string | undefined): boolean {
  if (!argv1) return false;
  return /yard[/\\]worker\.(ts|mjs|js)$/.test(argv1) || /[/\\]yard-worker\.mjs$/.test(argv1);
}
const runDirectly = isWorkerEntrypoint(process.argv[1]);
if (runDirectly) {
  if (!claimLock()) {
    console.log("the yard: another worker already holds the lock — standing down");
    process.exit(0);
  }
  const store = new JobStore();
  let stopping = false;
  const shutdown = () => { stopping = true; releaseLock(); store.close(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(`the yard: worker up (pid ${process.pid})`);
  workerLoop(store, { stop: () => stopping }).catch((e) => {
    console.error("the yard: worker loop died —", e?.message || e);
    releaseLock();
    process.exit(1);
  });
}
