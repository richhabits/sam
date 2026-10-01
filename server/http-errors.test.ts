import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jsonErrorHandler } from "./http-errors.ts";

// Audit finding: no error middleware was registered, so a throw in any route (or a malformed /
// oversized body rejected by express.json) fell through to Express's default HTML handler — which
// outside NODE_ENV=production includes the stack trace, i.e. absolute paths on the operator's disk.

describe("jsonErrorHandler", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = express();
    app.use(express.json({ limit: "1kb" }));
    app.post("/echo", (req, res) => { res.json(req.body); });
    app.get("/boom", () => { throw new Error("ENOENT open '/Users/alex/sam/vault/keys.json'"); });
    app.get("/reject", async () => { throw new Error("secret detail /Users/alex/.env"); });
    app.get("/partial", (_req, res) => { res.write("data: hi\n\n"); throw new Error("mid-stream"); });
    app.use(jsonErrorHandler);
    await new Promise<void>((r) => { server = createServer(app).listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { vi.restoreAllMocks(); await new Promise<void>((r) => server.close(() => r())); });

  it("answers a malformed JSON body with a 400 JSON error, not an HTML stack page", async () => {
    const res = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(await res.json()).toEqual({ error: "request body is not valid JSON" });
  });

  it("answers an oversized body with 413", async () => {
    const res = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: "x".repeat(5000) }) });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("request body too large");
  });

  it("answers a sync throw with an opaque 500 — no message, no path, no stack", async () => {
    const res = await fetch(`${base}/boom`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "internal error" });
    expect(text).not.toContain("/Users/");
  });

  it("covers a rejected async handler too (Express 5 forwards the rejection)", async () => {
    const res = await fetch(`${base}/reject`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error" });
  });

  it("does not try to write a second response once headers are sent", async () => {
    const res = await fetch(`${base}/partial`).catch(() => null);
    // Express's default handler closes the socket; the point is nothing throws
    // ERR_HTTP_HEADERS_SENT and the server keeps answering afterwards.
    if (res) await res.text().catch(() => "");
    const again = await fetch(`${base}/reject`);
    expect(again.status).toBe(500);
  });
});
