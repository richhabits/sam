import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.ts";

// Real HTTP through a real Express app: express-rate-limit is async middleware that sets headers,
// so a fake req/res would test the fake, not the limiter.
const servers: Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

async function serve(...limiters: ReturnType<typeof createRateLimiter>[]) {
  const app = express();
  limiters.forEach((l, i) => app.get(`/r${i}`, l, (_req, res) => { res.json({ ok: true }); }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  return async (i = 0) => {
    const res = await fetch(`http://127.0.0.1:${port}/r${i}`);
    return { status: res.status, body: await res.json() };
  };
}

describe("createRateLimiter", () => {
  it("allows up to max per IP, then answers 429 with the route's message", async () => {
    const hit = await serve(createRateLimiter({ max: 3, message: "slow" }));
    for (let i = 0; i < 3; i++) expect((await hit()).status).toBe(200);
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: "slow" });
  });

  it("starts a fresh window after windowMs", async () => {
    const hit = await serve(createRateLimiter({ max: 1, windowMs: 300 }));
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
    await new Promise((r) => setTimeout(r, 350));
    expect((await hit()).status).toBe(200);
  });

  it("keeps a separate budget per limiter", async () => {
    const hit = await serve(createRateLimiter({ max: 1 }), createRateLimiter({ max: 1 }));
    expect((await hit(0)).status).toBe(200);
    expect((await hit(1)).status).toBe(200);
    expect((await hit(0)).status).toBe(429);
  });

  it("uses the default message when none is given", async () => {
    const hit = await serve(createRateLimiter({ max: 0 }));
    const r = await hit();
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: "Too many requests to this route. Please slow down." });
  });
});
