import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAsk, raiseAsk } from "./ask.ts";
import { passkey } from "./handshake.ts";
import { registerCompanionRoutes } from "./routes.companion.ts";

describe("S.A.M. Universal Companion & P2P Mesh Routes", () => {
  let server: Server;
  let baseUrl: string;
  const mockResolver = vi.fn();

  const prevHandshake = process.env.SAM_REQUIRE_CONTROL_TOKEN;
  beforeAll(async () => {
    // The pre-existing cases exercise resolution logic, not the guard; the guard has its own case below.
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "0";
    const app = express();
    app.use(express.json());
    registerCompanionRoutes(app, { resolvePending: mockResolver });

    await new Promise<void>((resolve) => {
      server = createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (prevHandshake === undefined) delete process.env.SAM_REQUIRE_CONTROL_TOKEN;
    else process.env.SAM_REQUIRE_CONTROL_TOKEN = prevHandshake;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("returns hardware vitals and audit chain status", async () => {
    const res = await fetch(`${baseUrl}/api/companion/vitals`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.vitals).toBeDefined();
    expect(body.auditChain.valid).toBe(true);
  });

  it("executes injected pending action resolution when approved", async () => {
    mockResolver.mockResolvedValueOnce({
      kind: "final",
      text: "Executed safe:false tool with companion approval",
      trace: ["Ran command safely"],
    });

    const res = await fetch(`${baseUrl}/api/companion/action/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "pending-123", actor: "watch", always: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.resolvedType).toBe("PENDING_TOOL_EXECUTION");
    expect(mockResolver).toHaveBeenCalledWith("pending-123", true, true);
    expect(body.result.text).toContain("Executed safe:false tool");
    expect(body.auditEntry).toBeDefined();
  });

  it("returns 410 when injected pending action is expired", async () => {
    mockResolver.mockResolvedValueOnce({
      expired: true,
      text: "That approval expired — ask me again and I'll re-propose it.",
    });

    const res = await fetch(`${baseUrl}/api/companion/action/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "expired-456", actor: "watch" }),
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("expired");
  });

  it("still resolves an unattended Ask when resolvePending is injected but finds no pending record", async () => {
    // Real production wiring always injects resolvePending (index.ts → registerCompanionRoutes).
    // If step 1 stopped at "expired" instead of falling through, Ask resolution would be
    // unreachable outside of the separate no-resolver test app below.
    const askRecord = raiseAsk({
      pending: { tool: "run_shell", input: { cmd: "echo hi" } },
      tier: "dangerous",
      source: "test",
    });
    const askId = askRecord.id;
    expect(getAsk(askId)).toBeDefined();

    mockResolver.mockResolvedValueOnce({ expired: true, text: "no such pending action" });

    const res = await fetch(`${baseUrl}/api/companion/action/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: askId, actor: "watch" }),
    });

    expect(mockResolver).toHaveBeenCalledWith(askId, true, false);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.resolvedType).toBe("UNATTENDED_ASK_RESOLUTION");
    expect(body.tool).toBe("run_shell");
  });

  it("returns 410 when neither a pending record nor an Ask exists for the id, even with resolvePending injected", async () => {
    mockResolver.mockResolvedValueOnce({ expired: true, text: "no such pending action" });

    const res = await fetch(`${baseUrl}/api/companion/action/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "totally-unknown-id", actor: "watch" }),
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("resolves unattended Ask escalation when no pending action exists", async () => {
    const askRecord = raiseAsk({
      pending: { tool: "delete_file", input: { path: "scratch.tmp" } },
      tier: "dangerous",
      source: "test",
    });
    const askId = askRecord.id;
    expect(getAsk(askId)).toBeDefined();

    // Create app without resolvePending to test ask branch
    const appAsk = express();
    appAsk.use(express.json());
    registerCompanionRoutes(appAsk);

    const sAsk = createServer(appAsk);
    await new Promise<void>((resolve) => sAsk.listen(0, "127.0.0.1", () => resolve()));
    const port = (sAsk.address() as any).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/companion/action/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: askId, actor: "watch" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.resolvedType).toBe("UNATTENDED_ASK_RESOLUTION");
      expect(body.tool).toBe("delete_file");
    } finally {
      sAsk.close();
    }
  });

  it("serves P2P mesh topology and broadcast endpoints", async () => {
    const nodesRes = await fetch(`${baseUrl}/api/p2p/mesh/nodes`);
    expect(nodesRes.status).toBe(200);
    const nodesBody = await nodesRes.json();
    expect(nodesBody.topology.localNodeId).toBeTruthy();

    const broadcastRes = await fetch(`${baseUrl}/api/p2p/mesh/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "vault_sync", payload: { note: "test" } }),
    });

    expect(broadcastRes.status).toBe(200);
    const broadcastBody = await broadcastRes.json();
    expect(broadcastBody.success).toBe(true);
    expect(broadcastBody.result.accepted).toBe(true);
  });

  it("serves real-time voice agent session status", async () => {
    const res = await fetch(`${baseUrl}/api/voice/status?sessionId=test-voice-status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.session.sessionId).toBe("test-voice-status");
    expect(body.session.state).toBe("IDLE");
  });

  it("approval needs the passkey or a paired session once the Handshake is enforced (same bar as /api/confirm)", async () => {
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "1";
    try {
      mockResolver.mockResolvedValue({ kind: "final", text: "ok" });
      const post = (headers: Record<string, string>) =>
        fetch(`${baseUrl}/api/companion/action/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ actionId: "pending-guard", actor: "watch" }),
        });
      expect((await post({})).status).toBe(401);
      expect((await post({ "x-sam-token": "wrong" })).status).toBe(401);
      expect((await post({ "x-sam-token": passkey() })).status).toBe(200);
    } finally {
      process.env.SAM_REQUIRE_CONTROL_TOKEN = "0";
    }
  });
});
