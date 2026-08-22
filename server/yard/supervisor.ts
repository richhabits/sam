// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the supervisor
//
//  Keeps a POOL of worker processes alive alongside the server, each an independent
//  slot restarted on its own backoff when it dies — one slow-to-start worker never
//  holds the others back. Job claims are settled by the job store itself (a race-safe
//  conditional UPDATE under WAL + busy_timeout, see yard/store.ts), so any number of
//  workers can pull from the same queue safely; the supervisor doesn't coordinate that.
//
//  Pool size defaults to CPU cores minus one, leaving a core free so background jobs
//  can never make the desktop UI/main process lag. Override with SAM_YARD_WORKERS.
//
//  The supervisor never does the work and never inspects a job. It only owns the
//  processes, so that a crash in a build is a crash in something disposable.
// ─────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

// CPU cores minus one, floor of 1 — never zero even on a single-core box, never so many
// that the pool crowds out the process actually answering the user.
export function defaultPoolSize(): number {
  const override = Number(process.env.SAM_YARD_WORKERS);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  return Math.max(1, cpus().length - 1);
}

// The bundled worker when SAM is built, the source when running from a checkout.
//
// This LOOKS for the entrypoint instead of deriving one path from this module's
// location, because that derivation is not stable: from source this file sits at
// server/yard/, but once bundled it becomes part of dist/server.mjs and the same
// relative walk lands somewhere else entirely (it resolved to the user's home
// directory, and the yard silently stayed down). Candidates are cheap; a wrong
// single guess costs the whole feature.
//
// Returning null rather than guessing means the yard stays down AND says so.
export function workerEntry(): { cmd: string; args: string[] } | null {
  const cwd = process.cwd();

  // SOURCE FIRST when this is a checkout, because `dist/` goes stale silently and nothing
  // else notices. A worker built before the last edit still starts, still claims jobs, and
  // still reports success — while running code nobody has written for hours. That cost a
  // whole debugging session: a build loop ran the PREVIOUS bundle, so a feature's writes
  // never happened and its model routing ignored DEFAULT_TIER, both looking like new bugs
  // in current code that was in fact never executed.
  //
  // A checkout is the pair (worker.ts, node_modules/.bin/tsx): a packaged SAM ships neither,
  // so it falls through to the bundle exactly as before. Preferring source costs a tsx
  // compile at spawn; being wrong about which code is running costs an afternoon.
  const sources = [join(HERE, "worker.ts"), join(ROOT, "server", "yard", "worker.ts"), join(cwd, "server", "yard", "worker.ts")];
  const source = sources.find((s) => existsSync(s));
  // ON WINDOWS THE EXTENSIONLESS `.bin/tsx` IS NOT SPAWNABLE.
  //
  // npm writes three files into node_modules/.bin: `tsx` (a POSIX shell script), `tsx.cmd` and
  // `tsx.ps1`. existsSync finds the first on every platform, but CreateProcess cannot execute a
  // shell script, so Windows got `spawn ...\.bin\tsx ENOENT` — the yard worker never started,
  // and because the supervisor backs off rather than throwing, it looked like a yard that was
  // simply idle. Ask for the launcher this platform can actually run.
  const tsxNames = process.platform === "win32" ? ["tsx.cmd", "tsx.exe", "tsx"] : ["tsx"];
  const tsx = [ROOT, cwd]
    .flatMap((base) => tsxNames.map((name) => join(base, "node_modules", ".bin", name)))
    .find((t) => existsSync(t));
  if (source && tsx) return { cmd: tsx, args: [source] };

  const bundles = [
    join(HERE, "yard-worker.mjs"),               // bundled: sits beside server.mjs
    join(HERE, "dist", "yard-worker.mjs"),
    // PACKAGED: the electron main bundle lives in app.asar/dist-electron while the worker is
    // built to app.asar/dist, so the two are SIBLINGS and every other candidate here misses by
    // exactly one level. ROOT is join(HERE, "..", "..") — from dist-electron that normalises
    // past app.asar to Resources, which does not contain dist/ at all. The result was
    // "the yard · no worker entrypoint — staying down" in the packaged app: the store opened,
    // the API answered, and no job ever ran. It stayed hidden because a checkout-cwd made the
    // supervisor prefer the source worker long before it reached this list.
    join(HERE, "..", "dist", "yard-worker.mjs"),
    join(ROOT, "dist", "yard-worker.mjs"),       // from source
    join(cwd, "dist", "yard-worker.mjs"),
  ];
  for (const b of bundles) if (existsSync(b)) return { cmd: process.execPath, args: [b] };

  // A checkout with no tsx installed still has its source — better a bundle-less run than
  // no yard, so this is the last resort rather than an error.
  return source ? { cmd: process.execPath, args: [source] } : null;
}

// One independently-restarted slot in the pool. Its own backoff so a single worker
// that keeps crashing (bad job, corrupt state) never throttles its healthy siblings.
class Slot {
  child: ChildProcess | null = null;
  stopping = false;
  backoff = MIN_BACKOFF_MS;
  timer: NodeJS.Timeout | null = null;
  starts = 0;
  lastExit: string | null = null;

  spawn(entry: { cmd: string; args: string[] }) {
    if (this.stopping) return;
    this.starts++;
    // ELECTRON_RUN_AS_NODE keeps process.execPath behaving as node inside the packaged
    // app; harmless under plain node. The worker inherits nothing else it doesn't need.
    const child = spawn(entry.cmd, entry.args, {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SAM_YARD_WORKER: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout?.on("data", (d) => console.log(`  yard · ${String(d).trim()}`));
    child.stderr?.on("data", (d) => console.error(`  yard · ${String(d).trim()}`));
    child.on("exit", (code, signal) => {
      this.child = null;
      this.lastExit = signal ? `signal ${signal}` : `code ${code}`;
      if (this.stopping) return;
      // A clean exit still gets restarted: the worker standing down because another
      // holds the lock is normal, and the delay stops that becoming a tight loop.
      this.timer = setTimeout(() => this.spawn(entry), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    });
    // A worker that survives a while is healthy; forget the previous trouble.
    setTimeout(() => { if (this.child === child) this.backoff = MIN_BACKOFF_MS; }, 15_000);
  }

  stop() {
    this.stopping = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const c = this.child;
    this.child = null;
    if (!c) return;
    // Ask first so the worker can record its job's outcome; insist only if it won't go.
    try { c.kill("SIGTERM"); } catch { /* already gone */ }
    setTimeout(() => { try { c.kill("SIGKILL"); } catch { /* already gone */ } }, 5000).unref?.();
  }
}

export class Supervisor {
  private slots: Slot[] = [];

  start(poolSize = defaultPoolSize()): boolean {
    const entry = workerEntry();
    if (!entry) {
      const empty = new Slot();
      empty.lastExit = "no worker entrypoint found";
      this.slots = [empty];
      return false;
    }
    this.slots = Array.from({ length: Math.max(1, poolSize) }, () => new Slot());
    for (const slot of this.slots) slot.spawn(entry);
    return true;
  }

  stop() {
    for (const slot of this.slots) slot.stop();
  }

  status() {
    const up = this.slots.filter((s) => s.child);
    // up/pid stay single-value for the existing dashboard dot (any worker alive, first pid);
    // pids/count/poolSize are the pool-aware view for anything that wants the full picture.
    return {
      up: up.length > 0,
      pid: up[0]?.child?.pid ?? null,
      starts: this.slots.reduce((n, s) => n + s.starts, 0),
      lastExit: this.slots.find((s) => s.lastExit)?.lastExit ?? null,
      poolSize: this.slots.length,
      pids: up.map((s) => s.child!.pid),
    };
  }
}

export const supervisor = new Supervisor();
