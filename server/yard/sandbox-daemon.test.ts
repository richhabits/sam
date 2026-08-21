import { describe, it, expect } from "vitest";
import {
  findOpenPort,
  startSandboxApp,
  stopSandboxApp,
  getSandboxSession,
  listSandboxSessions,
} from "./sandbox-daemon.ts";

describe("S.A.M. Yard Live App Sandbox Daemon", () => {
  it("finds an available dynamic loopback port", async () => {
    const port = await findOpenPort(49152);
    expect(port).toBeGreaterThanOrEqual(49152);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it("spawns a sandbox process, logs stdout, and stops cleanly", async () => {
    const session = await startSandboxApp({
      projectId: "test-app",
      cwd: process.cwd(),
      command: "node -e \"console.log('App started on port ' + process.env.PORT); setInterval(() => {}, 1000);\"",
    });

    expect(session.status).toBe("RUNNING");
    expect(session.port).toBeGreaterThan(0);
    expect(session.pid).toBeGreaterThan(0);

    // Verify session retrieval
    const retrieved = getSandboxSession(session.sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.projectId).toBe("test-app");

    // Wait a brief moment for output
    await new Promise((r) => setTimeout(r, 100));

    // Stop process
    const stopRes = stopSandboxApp(session.sessionId);
    expect(stopRes.success).toBe(true);
  });

  it("handles non-existent sandbox session stop gracefully", () => {
    const res = stopSandboxApp("non-existent-session");
    expect(res.success).toBe(false);
    expect(res.message).toContain("No active sandbox session found");
  });
});
