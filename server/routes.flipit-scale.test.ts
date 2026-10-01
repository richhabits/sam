import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { passkey } from "./handshake.ts";

const clob = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("./flipit-execution.ts", async (orig) => ({ ...(await orig<typeof import("./flipit-execution.ts")>()), submitPolymarketClobOrder: clob }));

import { MAX_ORDER_SIZE, parseOrderParams, registerFlipItScaleRoutes } from "./routes.flipit-scale.ts";

describe("parseOrderParams", () => {
  it("defaults only omitted fields", () => {
    expect(parseOrderParams(undefined, undefined)).toEqual({ ok: true, price: 0.5, size: 10 });
    expect(parseOrderParams(0.25, 5)).toEqual({ ok: true, price: 0.25, size: 5 });
  });
  it("rejects non-finite, negative, zero and oversized values (0 is not silently 0.5)", () => {
    for (const price of [0, 1, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "abc", "1e999"]) {
      expect(parseOrderParams(price, 10).ok, `price ${String(price)}`).toBe(false);
    }
    for (const size of [0, -1, MAX_ORDER_SIZE + 1, Number.NaN, Number.POSITIVE_INFINITY, "x"]) {
      expect(parseOrderParams(0.5, size).ok, `size ${String(size)}`).toBe(false);
    }
    expect(parseOrderParams(0.5, MAX_ORDER_SIZE).ok).toBe(true);
  });
});

describe("POST /api/flipit/execute", () => {
  let server: Server;
  let base: string;
  const prev = process.env.SAM_REQUIRE_CONTROL_TOKEN;
  beforeAll(async () => {
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "1";
    const app = express();
    app.use(express.json());
    registerFlipItScaleRoutes(app);
    await new Promise<void>((r) => { server = createServer(app).listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.SAM_REQUIRE_CONTROL_TOKEN; else process.env.SAM_REQUIRE_CONTROL_TOKEN = prev;
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => clob.mockClear());

  const post = (body: unknown, token?: string) =>
    fetch(`${base}/api/flipit/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { "x-sam-token": token } : {}) },
      body: JSON.stringify(body),
    });

  it("refuses a loopback caller that has no passkey", async () => {
    expect((await post({ tokenId: "t", price: 0.4, size: 5 })).status).toBe(403);
    expect((await post({ tokenId: "t", price: 0.4, size: 5 }, "wrong")).status).toBe(403);
    expect(clob).not.toHaveBeenCalled();
  });

  it("rejects bad size/price with 400 before any order is built", async () => {
    for (const body of [
      { tokenId: "t", price: 0.4, size: 1_000_000 },
      { tokenId: "t", price: 0.4, size: -5 },
      { tokenId: "t", price: 2, size: 5 },
      { tokenId: "t", price: 0, size: 5 },
      { tokenId: "t", price: 0.4, size: "Infinity" },
    ]) {
      expect((await post(body, passkey())).status, JSON.stringify(body)).toBe(400);
    }
    expect(clob).not.toHaveBeenCalled();
  });

  it("passes a valid order through with the passkey", async () => {
    const res = await post({ tokenId: "t", price: 0.4, size: 5, side: "SELL" }, passkey());
    expect(res.status).toBe(200);
    expect(clob).toHaveBeenCalledWith({ tokenId: "t", price: 0.4, size: 5, side: "SELL" });
  });
});
