// ─────────────────────────────────────────────────────────────
//  S.A.M. · STATE LOCK  — advisory mutual-exclusion for shared mutable artifacts.
//
//  The Terraform state-lock discipline, TS-native (pattern only — no Terraform code). SAM's
//  shared files (.env, the vault JSON stores, the board) are all read-modify-write with NO
//  mutual exclusion: two sessions writing the same file → last one wins, silently, and a
//  `.replace()` that matched nothing still writes an unchanged file. This closes that class.
//
//  Mechanism: an atomic O_EXCL lock file (writeFileSync flag "wx"). The OS guarantees exactly
//  one of N racing creators succeeds; everyone else gets EEXIST and fails LOUDLY with who holds
//  it and since when. Never a silent overwrite.
//
//  LIMIT, stated not hidden: this only guards writes that go THROUGH acquire/withLock. It cannot
//  stop a hand-edit or another program (e.g. a second AI agent) writing the file raw. O_EXCL is
//  reliable on local disks; some network filesystems weaken it.
// ─────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "vault", ".locks");

// A lock older than this whose owner process is still alive is "stale by age" — reported, but only
// an EXPLICIT takeover reclaims it (we never steal from a process that might genuinely be mid-write).
const STALE_AGE_MS = 60_000;

// `token` is a random nonce unique to each acquire — it's how releaseLock knows a lock is STILL
// ours (pid+timestamp collide when one process acquires twice in the same millisecond).
export interface LockInfo { resource: string; owner: string; pid: number; host: string; at: string; token: string }
export interface LockHandle { resource: string; path: string; info: LockInfo }

/** Thrown when a lock is held. Carries who holds it + whether it looks stale, so the caller can
 *  decide to take over EXPLICITLY (never automatic). */
export class LockedError extends Error {
  readonly info: LockInfo;
  readonly stale: boolean;
  constructor(info: LockInfo, stale: boolean) {
    super(
      `state locked by ${info.owner} (pid ${info.pid} on ${info.host}) since ${info.at}` +
        (stale ? " — looks STALE; take over explicitly with { takeover: true }" : ""),
    );
    this.name = "LockedError";
    this.info = info;
    this.stale = stale;
  }
}

function lockPath(resource: string): string {
  // The resource name becomes a filename, so keep it to a safe slug (no traversal).
  return join(LOCK_DIR, `${resource.replace(/[^A-Za-z0-9_.-]/g, "_")}.lock`);
}

// process.kill(pid, 0) doesn't send a signal — it just probes existence. ESRCH = no such process
// (dead); EPERM = alive but owned by someone else (still alive, so NOT stale).
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

function readLock(path: string): LockInfo | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as LockInfo; } catch { return null; }
}

/** A lock is stale if its owner process is gone, or it's alive but older than the age threshold. */
export function isStaleLock(info: LockInfo, now = Date.now()): boolean {
  return !pidAlive(info.pid) || now - Date.parse(info.at) > STALE_AGE_MS;
}

export interface AcquireOpts {
  owner?: string;
  /** Reclaim the lock ONLY if it is stale. Never steals a live, fresh lock — that always throws. */
  takeover?: boolean;
  now?: number;
}

/**
 * Acquire the lock for `resource`, or throw LockedError. Atomic: exactly one of N concurrent
 * callers wins. Default (no takeover) refuses any held lock and reports whether it's stale.
 */
export function acquireLock(resource: string, opts: AcquireOpts = {}): LockHandle {
  mkdirSync(LOCK_DIR, { recursive: true });
  const path = lockPath(resource);
  const now = opts.now ?? Date.now();
  const info: LockInfo = {
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
    const held = readLock(path) ?? { resource, owner: "unknown", pid: 0, host: "?", at: new Date(0).toISOString(), token: "" };
    const stale = readLock(path) ? isStaleLock(held, now) : true;
    if (!opts.takeover || !stale) throw new LockedError(held, stale); // never take over a FRESH lock, even with takeover
    // EXPLICIT takeover of a stale lock: replace it and log the reclaim loudly.
    console.warn(`  🔒 state lock: taking over STALE lock on "${resource}" (was ${held.owner} pid ${held.pid} @ ${held.at})`);
    writeFileSync(path, JSON.stringify(info));
    return { resource, path, info };
  }
}

/** Release a lock we hold. No-op if a takeover has since reassigned it — we only delete our own. */
export function releaseLock(h: LockHandle): void {
  const held = readLock(h.path);
  if (held && held.token === h.info.token) {
    try { unlinkSync(h.path); } catch { /* already gone — fine */ }
  }
}

/** Inspect the current holder without acquiring (for status UIs). null = free. */
export function lockStatus(resource: string): (LockInfo & { stale: boolean }) | null {
  const path = lockPath(resource);
  if (!existsSync(path)) return null;
  const held = readLock(path);
  return held ? { ...held, stale: isStaleLock(held) } : null;
}

/** Acquire → run → release (always). The ergonomic wrapper every mutating write should use. */
export async function withLock<T>(resource: string, fn: () => T | Promise<T>, opts?: AcquireOpts): Promise<T> {
  const h = acquireLock(resource, opts);
  try { return await fn(); } finally { releaseLock(h); }
}

/** Synchronous variant for sync writers (e.g. writeEnv), same acquire→run→release guarantee. */
export function withLockSync<T>(resource: string, fn: () => T, opts?: AcquireOpts): T {
  const h = acquireLock(resource, opts);
  try { return fn(); } finally { releaseLock(h); }
}
