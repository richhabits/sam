import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerAdminRoutes } from "./routes.admin.ts";

// Audit finding: /api/admin/keys and /api/admin/config wrote whatever the body held (up to the 30mb
// JSON limit) into .env. Bounded now; a missing body is a 400, not a TypeError.

describe("admin key/config writes — input bounds", () => {
  let server: Server;
  let base: string;
  let dir: string;
  const saved = { dotenv: process.env.DOTENV_CONFIG_PATH, vault: process.env.VAULT_DIR };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sam-admin-"));
    process.env.DOTENV_CONFIG_PATH = join(dir, ".env");
    process.env.VAULT_DIR = dir;
    const app = express();
    app.use(express.json());
    registerAdminRoutes(app);
    await new Promise<void>((r) => { server = createServer(app).listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    if (saved.dotenv === undefined) delete process.env.DOTENV_CONFIG_PATH; else process.env.DOTENV_CONFIG_PATH = saved.dotenv;
    if (saved.vault === undefined) delete process.env.VAULT_DIR; else process.env.VAULT_DIR = saved.vault;
    delete process.env.GROQ_API_KEYS; delete process.env.GROQ_API_KEY; delete process.env.DEFAULT_TIER;
    rmSync(dir, { recursive: true, force: true });
    await new Promise<void>((r) => server.close(() => r()));
  });

  const post = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("rejects an absurdly long key and writes nothing", async () => {
    const res = await post("/api/admin/keys", { provider: "groq", keys: ["gsk_" + "a".repeat(100_000)] });
    expect(res.status).toBe(400);
  });

  it("rejects a pool with far too many keys", async () => {
    const res = await post("/api/admin/keys", { provider: "groq", keys: Array.from({ length: 500 }, (_, i) => `gsk_key${i}`) });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized config value", async () => {
    const res = await post("/api/admin/config", { key: "defaultTier", value: "x".repeat(100_000) });
    expect(res.status).toBe(400);
  });

  it("answers 400 (not a crash) when the body is missing entirely", async () => {
    expect((await post("/api/admin/keys")).status).toBe(400);
    expect((await post("/api/admin/config")).status).toBe(400);
  });

  it("still saves a normal value, atomically and 0600", async () => {
    const res = await post("/api/admin/config", { key: "defaultTier", value: "free" });
    expect(res.status).toBe(200);
    const envPath = join(dir, ".env");
    expect(readFileSync(envPath, "utf8")).toContain("DEFAULT_TIER=free");
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });
});
