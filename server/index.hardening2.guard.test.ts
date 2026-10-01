import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { passkey } from "./handshake.ts";
import { registerAdminRoutes } from "./routes.admin.ts";

// index.ts boots a server on import, so its handlers cannot be mounted here. Like the other
// *.guard.test.ts files, these pin the route guards by reading the source: a revert fails here.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
const routeBody = (start: string) => {
  const a = src.indexOf(start);
  expect(a, `${start} not found`).toBeGreaterThan(-1);
  // up to the next top-level app.<verb>( registration
  const next = src.slice(a + start.length).search(/\napp\.(get|post|put|delete|use)\(|\nregister[A-Z]/);
  return src.slice(a, next === -1 ? undefined : a + start.length + next);
};

describe("/api/schedules writes", () => {
  for (const route of ['app.post("/api/schedules"', 'app.delete("/api/schedules/:id"', 'app.post("/api/schedules/:id/toggle"']) {
    it(`${route} requires isTrustedLocal`, () => {
      const body = routeBody(route);
      expect(body).toContain("!isTrustedLocal(req)");
      expect(body).toContain("403");
    });
  }
  it("POST bounds command and cron before storing", () => {
    expect(routeBody('app.post("/api/schedules"')).toContain("scheduleInputError(command, cron)");
  });
});

describe("/api/life-index writes", () => {
  for (const route of ['app.post("/api/life-index"', 'app.delete("/api/life-index"', 'app.post("/api/life-index/reindex"', 'app.post("/api/life-index/watch"']) {
    it(`${route} requires isTrustedLocal`, () => {
      expect(routeBody(route)).toContain("!isTrustedLocal(req)");
    });
  }
  it("POST refuses root / home / key dirs", () => {
    expect(routeBody('app.post("/api/life-index"')).toContain("indexRefusal(path)");
  });
});

describe("/api/keys", () => {
  it("is not an anonymous read", () => {
    expect(routeBody('app.get("/api/keys"')).toContain("canReadOwnContent(req)");
  });
});

describe("GET /api/admin/config (identity fields)", () => {
  let server: Server;
  let base: string;
  const prev = process.env.SAM_REQUIRE_CONTROL_TOKEN;
  beforeAll(async () => {
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "1";
    const app = express();
    app.use(express.json());
    registerAdminRoutes(app);
    await new Promise<void>((r) => { server = createServer(app).listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.SAM_REQUIRE_CONTROL_TOKEN; else process.env.SAM_REQUIRE_CONTROL_TOKEN = prev;
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("401s an anonymous local caller, and serves the app (passkey)", async () => {
    const anon = await fetch(`${base}/api/admin/config`);
    expect(anon.status).toBe(401);
    expect((await anon.json()).locked).toBe(true);
    const app = await fetch(`${base}/api/admin/config`, { headers: { "x-sam-token": passkey() } });
    expect(app.status).toBe(200);
    expect((await app.json()).apple).toBeDefined();
  });
});
