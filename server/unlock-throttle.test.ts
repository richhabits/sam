import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUnlockThrottle, runThrottledUnlock } from "./unlock-throttle.ts";

describe("createUnlockThrottle", () => {
  it("allows 5 failures, then locks out with exponential backoff capped at 15 min", () => {
    let t = 1_000_000;
    const th = createUnlockThrottle({ now: () => t });
    for (let i = 0; i < 4; i++) { th.recordFailure("ip"); expect(th.retryAfterSeconds("ip")).toBe(0); }
    th.recordFailure("ip");
    expect(th.retryAfterSeconds("ip")).toBe(30);
    t += 31_000;
    expect(th.retryAfterSeconds("ip")).toBe(0);
    th.recordFailure("ip");
    expect(th.retryAfterSeconds("ip")).toBe(60);
    for (let i = 0; i < 30; i++) { t += 16 * 60_000; th.recordFailure("ip"); }
    expect(th.retryAfterSeconds("ip")).toBe(15 * 60);
  });
  it("is per key, and a success clears the slate", () => {
    const th = createUnlockThrottle();
    for (let i = 0; i < 5; i++) th.recordFailure("a");
    expect(th.retryAfterSeconds("a")).toBeGreaterThan(0);
    expect(th.retryAfterSeconds("b")).toBe(0);
    th.recordSuccess("a");
    expect(th.retryAfterSeconds("a")).toBe(0);
  });
});

describe("runThrottledUnlock over HTTP", () => {
  let server: Server;
  let base: string;
  let attempts = 0;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const th = createUnlockThrottle();
    app.post("/unlock", (req, res) => {
      const ok = runThrottledUnlock(th, req, res, () => { attempts++; return req.body?.pass === "right"; });
      if (ok === "throttled") return;
      res.status(ok ? 200 : 401).json({ ok });
    });
    await new Promise<void>((r) => { server = createServer(app).listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const go = (pass: string) => fetch(`${base}/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pass }) });

  it("answers the 6th wrong attempt with 429 and never evaluates it", async () => {
    for (let i = 0; i < 5; i++) expect((await go("nope")).status).toBe(401);
    const sixth = await go("nope");
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    // Even the right passphrase is refused while locked, so the lockout cannot be used as an oracle.
    expect((await go("right")).status).toBe(429);
    expect(attempts).toBe(5);
  });
});

describe("index.ts wiring", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
  it("both unlock routes run under the shared throttle", () => {
    for (const route of ['app.post("/api/encryption/unlock"', 'app.post("/api/safe/unlock"']) {
      const a = src.indexOf(route);
      expect(a, route).toBeGreaterThan(-1);
      expect(src.slice(a, a + 1400)).toContain("runThrottledUnlock(unlockThrottle");
    }
  });
});
