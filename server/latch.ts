// ─────────────────────────────────────────────────────────────
//  S.A.M. · LATCH  — advisory mutual-exclusion for shared mutable artifacts.
//
//  A single-writer latch for SAM's shared mutable files. SAM's
//  shared files (.env, the vault JSON stores, the board) are all read-modify-write with NO
//  mutual exclusion: two sessions writing the same file → last one wins, silently, and a
//  `.replace()` that matched nothing still writes an unchanged file. This closes that class.
//
//  Mechanism: an atomic O_EXCL lock file (writeFileSync flag "wx"). The OS guarantees exactly
//  one of N racing creators succeeds; everyone else gets EEXIST and fails LOUDLY with who holds
//  it and since when. Never a silent overwrite.
//
//  LIMIT, stated not hidden: this only guards writes that go THROUGH acquire/withLatch. It cannot
//  stop a hand-edit or another program (e.g. a second AI agent) writing the file raw. O_EXCL is
//  reliable on local disks; some network filesystems weaken it.
// ─────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LATCH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "vault", ".locks");

// A lock older than this whose owner process is still alive is "stale by age" — reported, but only
// an EXPLICIT takeover reclaims it (we never steal from a process that might genuinely be mid-write).
const STALE_AGE_MS = 60_000;

// `token` is a random nonce unique to each acquire — it's how release knows a lock is STILL
// ours (pid+timestamp collide when one process acquires twice in the same millisecond).
export interface LatchInfo { resource: string; owner: string; pid: number; host: string; at: string; token: string }
export interface LatchHandle { resource: string; path: string; info: LatchInfo }

/** Thrown when a lock is held. Carries who holds it + whether it looks stale, so the caller can
 *  decide to take over EXPLICITLY (never automatic). */
export class LatchHeld extends Error {
  readonly info: LatchInfo;
  readonly stale: boolean;
  constructor(info: LatchInfo, stale: boolean) {
    super(
      `the latch is held by ${info.owner} (pid ${info.pid} on ${info.host}) since ${info.at}` +
        (stale ? " — looks STALE; take over explicitly with { takeover: true }" : ""),
    );
    this.name = "LatchHeld";
    this.info = info;
    this.stale = stale;
  }
}

function latchPath(resource: string): string {
  // The resource name becomes a filename, so keep it to a safe slug (no traversal).
  return join(LATCH_DIR, `${resource.replace(/[^A-Za-z0-9_.-]/g, "_")}.lock`);
}

// process.kill(pid, 0) doesn't send a signal — it just probes existence. ESRCH = no such process
// (dead); EPERM = alive but owned by someone else (still alive, so NOT stale).
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

function readLatch(path: string): LatchInfo | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as LatchInfo; } catch { return null; }
}

/** A lock is stale if its owner process is gone, or it's alive but older than the age threshold. */
export function isStale(info: LatchInfo, now = Date.now()): boolean {
  return !pidAlive(info.pid) || now - Date.parse(info.at) > STALE_AGE_MS;
}

export interface AcquireOpts {
  owner?: string;
  /** Reclaim the lock ONLY if it is stale. Never steals a live, fresh lock — that always throws. */
  takeover?: boolean;
  now?: number;
}

/**
 * Acquire the lock for `resource`, or throw LatchHeld. Atomic: exactly one of N concurrent
 * callers wins. Default (no takeover) refuses any held lock and reports whether it's stale.
 */
export function claim(resource: string, opts: AcquireOpts = {}): LatchHandle {
  mkdirSync(LATCH_DIR, { recursive: true });
  const path = latchPath(resource);
  const now = opts.now ?? Date.now();
  const info: LatchInfo = {
    resource,
    owner: opts.owner || process.env.SAM_SESSION || "sam",
    pid: process.pid,
    host: hostname(),
    at: new Date(now).toISOString(),
    token: randomBytes(8).toString("hex"),
  };
  try {
    writeFileSync(path, JSON.stringify(info), { flag: "wx" }); // O_CREAT|O_EXCL — the atomic win/lose
    return { resource, path, info };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    // Someone holds it. A corrupt/empty lock file counts as stale.
    const held = readLatch(path) ?? { resource, owner: "unknown", pid: 0, host: "?", at: new Date(0).toISOString(), token: "" };
    const stale = readLatch(path) ? isStale(held, now) : true;
    if (!opts.takeover || !stale) throw new LatchHeld(held, stale); // never take over a FRESH lock, even with takeover
    // EXPLICIT takeover of a stale lock: replace it and log the reclaim loudly.
    console.warn(`  🔒 latch: taking over STALE lock on "${resource}" (was ${held.owner} pid ${held.pid} @ ${held.at})`);
    writeFileSync(path, JSON.stringify(info));
    return { resource, path, info };
  }
}

/** Release a lock we hold. No-op if a takeover has since reassigned it — we only delete our own. */
export function release(h: LatchHandle): void {
  const held = readLatch(h.path);
  if (held && held.token === h.info.token) {
    try { unlinkSync(h.path); } catch { /* already gone — fine */ }
  }
}

/** Inspect the current holder without acquiring (for status UIs). null = free. */
export function latchStatus(resource: string): (LatchInfo & { stale: boolean }) | null {
  const path = latchPath(resource);
  if (!existsSync(path)) return null;
  const held = readLatch(path);
  return held ? { ...held, stale: isStale(held) } : null;
}

/** Resource names of lock files left by a crashed process (dead pid) or past the age threshold.
 *  Read-only — a live, fresh latch is never listed. */
export function staleLatches(now = Date.now()): string[] {
  const stale: string[] = [];
  let files: string[];
  try { files = readdirSync(LATCH_DIR); } catch { return stale; }
  for (const f of files) {
    if (!f.endsWith(".lock")) continue;
    const held = readLatch(join(LATCH_DIR, f));
    if (!held || isStale(held, now)) stale.push(f.replace(/\.lock$/, ""));
  }
  return stale;
}

/** Remove the stale latches — a corpse sweep, safe to run unattended (the Keeper does), unlike
 *  taking over a lock that might still be live. Returns the resource names cleared. */
export function sweepStaleLatches(now = Date.now()): string[] {
  const cleared: string[] = [];
  for (const name of staleLatches(now)) {
    try { unlinkSync(join(LATCH_DIR, `${name}.lock`)); cleared.push(name); } catch { /* already gone — fine */ }
  }
  return cleared;
}

/** Acquire → run → release (always). The ergonomic wrapper every mutating write should use. */
export async function withLatch<T>(resource: string, fn: () => T | Promise<T>, opts?: AcquireOpts): Promise<T> {
  const h = claim(resource, opts);
  try { return await fn(); } finally { release(h); }
}

/** Synchronous variant for sync writers (e.g. writeEnv), same acquire→run→release guarantee. */
export function withLatchSync<T>(resource: string, fn: () => T, opts?: AcquireOpts): T {
  const h = claim(resource, opts);
  try { return fn(); } finally { release(h); }
}
