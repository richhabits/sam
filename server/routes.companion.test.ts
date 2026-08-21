import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { registerCompanionRoutes } from "./routes.companion.ts";
import { raiseAsk, getAsk } from "./ask.ts";

describe("S.A.M. Universal Companion & P2P Mesh Routes", () => {
  let server: Server;
  let baseUrl: string;
  const mockResolver = vi.fn();

  beforeAll(async () => {
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
});
