// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the supervisor
//
//  Keeps exactly one worker process alive alongside the server. Restarts it when it
//  dies, backing off so a worker that cannot start does not become a spawn loop that
//  costs more than the work would have.
//
//  The supervisor never does the work and never inspects a job. It only owns the
//  process, so that a crash in a build is a crash in something disposable.
// ─────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

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
  const tsx = [join(ROOT, "node_modules", ".bin", "tsx"), join(cwd, "node_modules", ".bin", "tsx")].find((t) => existsSync(t));
  if (source && tsx) return { cmd: tsx, args: [source] };

  const bundles = [
    join(HERE, "yard-worker.mjs"),               // bundled: sits beside server.mjs
    join(HERE, "dist", "yard-worker.mjs"),
    join(ROOT, "dist", "yard-worker.mjs"),       // from source
    join(cwd, "dist", "yard-worker.mjs"),
  ];
  for (const b of bundles) if (existsSync(b)) return { cmd: process.execPath, args: [b] };

  // A checkout with no tsx installed still has its source — better a bundle-less run than
  // no yard, so this is the last resort rather than an error.
  return source ? { cmd: process.execPath, args: [source] } : null;
}

export class Supervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private backoff = MIN_BACKOFF_MS;
  private timer: NodeJS.Timeout | null = null;
  private starts = 0;
  private lastExit: string | null = null;

  start(): boolean {
    const entry = workerEntry();
    if (!entry) { this.lastExit = "no worker entrypoint found"; return false; }
    this.stopping = false;
    this.spawnOnce(entry);
    return true;
  }

  private spawnOnce(entry: { cmd: string; args: string[] }) {
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
      this.timer = setTimeout(() => this.spawnOnce(entry), this.backoff);
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

  status() {
    return { up: !!this.child, pid: this.child?.pid ?? null, starts: this.starts, lastExit: this.lastExit };
  }
}

export const supervisor = new Supervisor();
