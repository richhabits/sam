// ─────────────────────────────────────────────────────────────
//  S.A.M. · UNLOCK ATTEMPT THROTTLE
//
//  /api/safe/unlock and /api/encryption/unlock check a passphrase, and each guess costs the
//  attacker one request. A fixed-window limiter (rate-limit.ts) is the wrong shape for that: it
//  forgets after a minute and charges the legitimate operator for successes too. This counts
//  FAILURES only, per IP: the first few typos are free, then each further failure doubles the
//  lockout (30s, 1m, 2m … capped at 15 min). A correct passphrase clears the slate.
//
//  In-memory on purpose: a restart resets it, which costs an attacker nothing they could not do by
//  restarting SAM (they would need to be the operator to do that).
// ─────────────────────────────────────────────────────────────

export interface UnlockThrottleOptions {
  /** Failures tolerated before the first lockout. */
  freeFailures?: number;
  baseLockMs?: number;
  maxLockMs?: number;
  now?: () => number;
}

interface Entry { failures: number; lockedUntil: number }

export function createUnlockThrottle(opts: UnlockThrottleOptions = {}) {
  const free = opts.freeFailures ?? 5;
  const base = opts.baseLockMs ?? 30_000;
  const max = opts.maxLockMs ?? 15 * 60_000;
  const now = opts.now ?? Date.now;
  const table = new Map<string, Entry>();

  return {
    /** Seconds the caller must wait, or 0 if an attempt is allowed now. */
    retryAfterSeconds(key: string): number {
      const e = table.get(key);
      if (!e) return 0;
      const left = e.lockedUntil - now();
      return left > 0 ? Math.ceil(left / 1000) : 0;
    },
    recordFailure(key: string): void {
      const e = table.get(key) ?? { failures: 0, lockedUntil: 0 };
      e.failures += 1;
      if (e.failures >= free) {
        // Exponent capped so 2 ** n cannot overflow into Infinity on a very long run of failures.
        const lock = Math.min(max, base * 2 ** Math.min(e.failures - free, 20));
        e.lockedUntil = now() + lock;
      }
      table.set(key, e);
      // Bound memory: forget entries whose lock has long expired once the table grows.
      if (table.size > 1000) for (const [k, v] of table) if (v.lockedUntil < now() - max) table.delete(k);
    },
    recordSuccess(key: string): void { table.delete(key); },
  };
}

type Req = { ip?: string; socket: { remoteAddress?: string | null } };
export const throttleKey = (req: Req): string => req.ip || req.socket.remoteAddress || "unknown";

/** Shared by the two unlock routes: one table, so alternating between them does not reset the count. */
export const unlockThrottle = createUnlockThrottle();

/**
 * Runs one unlock attempt under the throttle. Returns "throttled" (a 429 has already been sent and
 * `attempt` was NOT called, so a locked-out caller cannot even test a guess), else the attempt's result.
 */
export function runThrottledUnlock(
  throttle: ReturnType<typeof createUnlockThrottle>,
  req: Req,
  res: { setHeader(k: string, v: string): unknown; status(c: number): { json(b: unknown): unknown } },
  attempt: () => boolean,
): boolean | "throttled" {
  const key = throttleKey(req);
  const wait = throttle.retryAfterSeconds(key);
  if (wait > 0) {
    res.setHeader("Retry-After", String(wait));
    res.status(429).json({ error: "Too many failed unlock attempts. Try again later.", retryAfterSeconds: wait });
    return "throttled";
  }
  const ok = attempt();
  if (ok) throttle.recordSuccess(key); else throttle.recordFailure(key);
  return ok;
}
