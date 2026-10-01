import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerPeopleRoutes } from "./routes.people.ts";

// Audit finding: GET /api/phone-link returns a URL carrying SAM_REMOTE_TOKEN. It was guarded by
// bare isLoopback, and the global Handshake gate only covers mutations — so any local process
// with no passkey and no pairing could read the one secret that opens SAM to the LAN.

// Generated per run: no secret-shaped literal in a public repo (and gitleaks stays quiet).
const PASSKEY = randomBytes(32).toString("hex");
const TOKEN = randomBytes(20).toString("hex");

describe("GET /api/phone-link", () => {
  let server: Server;
  let base: string;
  let fakeRemote: string | null = null;
  const saved = { ...process.env };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    // Lets a test present a non-loopback peer address without a second network interface.
    app.use((req, _res, next) => {
      // Always set (never only when faking): keep-alive reuses the socket, so an earlier test fake address would stick.
      Object.defineProperty(req.socket, "remoteAddress", { value: fakeRemote ?? "127.0.0.1", configurable: true });
      next();
    });
    registerPeopleRoutes(app, 8787);
    await new Promise<void>((r) => { server = createServer(app).listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    process.env = saved;
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => {
    fakeRemote = null;
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "1";
    process.env.SAM_CONTROL_TOKEN = PASSKEY;
    process.env.SAM_REMOTE = "1";
    process.env.SAM_REMOTE_TOKEN = TOKEN;
  });

  it("refuses a loopback caller that holds neither the passkey nor a pairing, and leaks nothing", async () => {
    const res = await fetch(`${base}/api/phone-link`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(TOKEN);
  });

  it("serves the desktop app, which carries the passkey", async () => {
    const res = await fetch(`${base}/api/phone-link`, { headers: { "x-sam-token": PASSKEY } });
    expect(res.status).toBe(200);
    expect((await res.json()).remoteOn).toBe(true);
  });

  it("still refuses an off-machine caller even with the passkey (this-machine-only is unchanged)", async () => {
    fakeRemote = "192.168.1.50";
    const res = await fetch(`${base}/api/phone-link`, { headers: { "x-sam-token": PASSKEY } });
    expect(res.status).toBe(403);
  });

  it("with the Handshake opted out (SAM_REQUIRE_CONTROL_TOKEN=0) loopback is trusted, as before", async () => {
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "0";
    const res = await fetch(`${base}/api/phone-link`);
    expect(res.status).toBe(200);
  });
});
