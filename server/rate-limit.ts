// ─────────────────────────────────────────────────────────────
//  S.A.M. · PER-IP RATE LIMITER
//
//  One small fixed-window limiter shared by every route that touches the disk, spawns a process
//  or checks a credential (CodeQL js/missing-rate-limiting). It lives in its own module so the
//  extracted routes.*.ts files can use it without importing index.ts. Built on express-rate-limit
//  (already installed via the MCP SDK, now a direct dependency) so the limiting is the standard,
//  well-tested kind, and CodeQL recognises it as rate limiting.
//
//  Keyed on req.ip, falling back to the socket address. Each limiter keeps its OWN table, so a
//  busy media route cannot starve the speech route of its budget.
// ─────────────────────────────────────────────────────────────
import { rateLimit } from "express-rate-limit";

export interface RateLimitOptions {
  /** Window length in ms. */
  windowMs?: number;
  /** Requests allowed per IP per window. */
  max?: number;
  /** Error text returned with the 429. */
  message?: string;
}

export function createRateLimiter(opts: RateLimitOptions = {}) {
  return rateLimit({
    windowMs: opts.windowMs ?? 60_000,
    limit: opts.max ?? 30,
    message: { error: opts.message ?? "Too many requests to this route. Please slow down." },
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
}
