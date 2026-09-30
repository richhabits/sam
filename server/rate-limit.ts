// ─────────────────────────────────────────────────────────────
//  S.A.M. · PER-IP RATE LIMITER
//
//  One small fixed-window limiter shared by every route that touches the disk, spawns a process
//  or checks a credential (CodeQL js/missing-rate-limiting). It lives in its own module so the
//  extracted routes.*.ts files can use it without importing index.ts — and because no new
//  dependency is needed for what is a counter and a clock.
//
//  Keyed on req.ip, falling back to the socket address. Each limiter keeps its OWN table, so a
//  busy media route cannot starve the speech route of its budget.
// ─────────────────────────────────────────────────────────────
import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Window length in ms. */
  windowMs?: number;
  /** Requests allowed per IP per window. */
  max?: number;
  /** Error text returned with the 429. */
  message?: string;
}

export function createRateLimiter(opts: RateLimitOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 30;
  const message = opts.message ?? "Too many requests to this route. Please slow down.";
  const hits = new Map<string, { count: number; windowStart: number }>();
  let lastSweep = Date.now();

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();

    // Drop expired windows once per window so the table cannot grow without bound under a
    // spray of spoofed/rotating addresses.
    if (now - lastSweep > windowMs) {
      lastSweep = now;
      for (const [k, v] of hits) if (now - v.windowStart > windowMs) hits.delete(k);
    }

    const record = hits.get(ip);
    if (!record || now - record.windowStart > windowMs) {
      hits.set(ip, { count: 1, windowStart: now });
      return next();
    }
    if (record.count >= max) {
      return res.status(429).json({ error: message });
    }
    record.count++;
    next();
  };
}
