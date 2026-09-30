import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limit.ts";

function run(limiter: ReturnType<typeof createRateLimiter>, ip: string) {
  const req = { ip, socket: { remoteAddress: ip } } as unknown as Request;
  let status = 200;
  let body: unknown;
  const res = {
    status(c: number) { status = c; return this; },
    json(b: unknown) { body = b; return this; },
  } as unknown as Response;
  const next = vi.fn();
  limiter(req, res, next);
  return { status, body, passed: next.mock.calls.length === 1 };
}

describe("createRateLimiter", () => {
  afterEach(() => vi.useRealTimers());

  it("allows up to max per IP, then answers 429", () => {
    const l = createRateLimiter({ max: 3, message: "slow" });
    expect([1, 2, 3].every(() => run(l, "1.1.1.1").passed)).toBe(true);
    const blocked = run(l, "1.1.1.1");
    expect(blocked.passed).toBe(false);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "slow" });
  });

  it("counts each IP separately", () => {
    const l = createRateLimiter({ max: 1 });
    expect(run(l, "1.1.1.1").passed).toBe(true);
    expect(run(l, "2.2.2.2").passed).toBe(true);
    expect(run(l, "1.1.1.1").passed).toBe(false);
  });

  it("starts a fresh window after windowMs", () => {
    vi.useFakeTimers();
    const l = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(run(l, "1.1.1.1").passed).toBe(true);
    expect(run(l, "1.1.1.1").passed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(run(l, "1.1.1.1").passed).toBe(true);
  });

  it("keeps a separate table per limiter", () => {
    const a = createRateLimiter({ max: 1 });
    const b = createRateLimiter({ max: 1 });
    expect(run(a, "1.1.1.1").passed).toBe(true);
    expect(run(b, "1.1.1.1").passed).toBe(true);
  });
});
