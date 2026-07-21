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
import { execInProject } from "./exec.ts";
import { createProject, checkpoint, restore, projectPath, isManagedProject } from "./managed.ts";

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

// Run a short sequence of confined commands inside one project. Every step goes through
// the executor, so a refusal stops the job rather than being written into its log as if
// it were output. A non-zero exit stops the sequence too: continuing past a failed
// install and reporting success is how a build lies about what it produced.
HANDLERS.run = async (ctx) => {
  // Either an explicit root, or the slug of a managed project — which is the form that
  // gets a checkpoint at the end, because only a managed project has somewhere to put one.
  const slug = String(ctx.payload?.slug || "");
  const root = slug ? projectPath(slug) : String(ctx.payload?.root || "");
  const steps: any[] = Array.isArray(ctx.payload?.steps) ? ctx.payload.steps : [];
  if (!root) throw Object.assign(new Error("a run job needs a project root or a slug"), { kind: "permanent" as FailureKind });
  if (!steps.length) throw Object.assign(new Error("a run job needs at least one step"), { kind: "permanent" as FailureKind });

  let last = "";
  for (const [i, step] of steps.entries()) {
    ctx.checkStop();
    const [command, ...args] = Array.isArray(step) ? step : [step?.command, ...(step?.args ?? [])];
    ctx.log(`step ${i + 1}/${steps.length}: ${command} ${args.join(" ")}`);
    const r = await execInProject(root, String(command), args.map(String), { cwd: ctx.payload?.cwd, env: ctx.payload?.env });
    for (const line of `${r.stdout}${r.stderr}`.split("\n").filter(Boolean).slice(0, 200)) ctx.log(`  ${line}`);
    if (r.truncated) ctx.log("  (output truncated)");
    if (r.code !== 0) throw new Error(`step ${i + 1} (${command}) exited ${r.code}`);
    last = `${command} ok`;
  }

  // A completed iteration checkpoints itself. The undo therefore exists before anyone
  // discovers they need it — which is the only time an undo is worth having. Deliberately
  // AFTER the steps succeeded: checkpointing a half-finished build records a state nobody
  // would ever want to return to.
  let mark = "";
  if (slug && isManagedProject(slug)) {
    const cp = await checkpoint(slug, String(ctx.payload?.message || `${steps.length} step${steps.length === 1 ? "" : "s"}: ${last}`));
    if (cp) { ctx.log(`checkpoint ${cp.sha.slice(0, 8)} — ${cp.message}`); mark = ` · checkpoint ${cp.sha.slice(0, 8)}`; }
    else ctx.log("nothing changed on disk — no checkpoint recorded");
  }
  return `${steps.length} step${steps.length === 1 ? "" : "s"} — ${last}${mark}`;
};

// ── Managed projects as job kinds ───────────────────────────────────────────
// Creating, checkpointing and going back are all work the yard does, so they are jobs
// like any other: queued, logged, cancellable, and visible in the same place.

HANDLERS["project.create"] = async (ctx) => {
  const name = String(ctx.payload?.name || "").trim();
  if (!name) throw Object.assign(new Error("a project needs a name"), { kind: "permanent" as FailureKind });
  const m = await createProject(name, { spec: String(ctx.payload?.spec || "") });
  ctx.log(`created ${m.slug} at ${projectPath(m.slug)}`);
  return `created ${m.slug}`;
};

// The whole first iteration as ONE job: make the project, put something real in it, and
// checkpoint. One job rather than three because the slug does not exist until the first
// step has run, and queueing work that refers to a name nothing has produced yet is how
// a pipeline ends up depending on luck.
HANDLERS["project.build"] = async (ctx) => {
  const name = String(ctx.payload?.name || "").trim();
  if (!name) throw Object.assign(new Error("a build needs a name"), { kind: "permanent" as FailureKind });

  const m = await createProject(name, { spec: String(ctx.payload?.spec || name) });
  ctx.log(`created ${m.slug} at ${projectPath(m.slug)}`);
  ctx.checkStop();

  // A plain page, written directly rather than shelled out for. It is deliberately not a
  // framework: this is the first iteration, it has to actually open in a browser, and a
  // dependency tree is something to add when the project asks for one.
  const dir = projectPath(m.slug);
  const title = m.name.replace(/[<>&]/g, "");
  writeFileSync(join(dir, "index.html"), page(title));
  writeFileSync(join(dir, "README.md"), `# ${title}\n\n${m.spec}\n\nBuilt by SAM. Open index.html.\n`);
  ctx.log("wrote index.html and README.md");

  const cp = await checkpoint(m.slug, `Scaffold ${m.slug}`);
  if (cp) ctx.log(`checkpoint ${cp.sha.slice(0, 8)} — ${cp.message}`);
  return `built ${m.slug}${cp ? ` · checkpoint ${cp.sha.slice(0, 8)}` : ""}`;
};

function page(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: radial-gradient(900px 500px at 50% -10%, rgba(240,130,78,.16), transparent 60%), #100E0C;
    color: #F3EDE4; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
    text-align: center; padding: 24px;
  }
  h1 { font-size: clamp(2rem, 8vw, 4rem); letter-spacing: -.04em; margin: 0 0 .4em; }
  p { color: #B8AFA4; font-size: 1.05rem; margin: 0; }
</style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>Built in the yard. Edit index.html to make it yours.</p>
  </main>
</body>
</html>
`;
}

HANDLERS["project.checkpoint"] = async (ctx) => {
  const slug = String(ctx.payload?.slug || "");
  const cp = await checkpoint(slug, String(ctx.payload?.message || "checkpoint"));
  if (!cp) { ctx.log("nothing had changed — no checkpoint recorded"); return "nothing to record"; }
  ctx.log(`checkpoint ${cp.sha.slice(0, 8)} — ${cp.message}`);
  return `checkpoint ${cp.sha.slice(0, 8)}`;
};

HANDLERS["project.restore"] = async (ctx) => {
  const slug = String(ctx.payload?.slug || "");
  const sha = String(ctx.payload?.sha || "");
  const at = await restore(slug, sha);
  ctx.log(`restored ${slug} to ${at.sha.slice(0, 8)} — ${at.message}`);
  return `restored to ${at.sha.slice(0, 8)}`;
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
