import { describe, it, expect, afterAll, beforeAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { registerAntigravityRoutes } from "./routes.antigravity.ts";

describe("S.A.M. Antigravity Cognitive Brain REST Routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerAntigravityRoutes(app);

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

  it("POST /api/brain/cognition/execute executes speculative multi-branch cognition", async () => {
    const res = await fetch(`${baseUrl}/api/brain/cognition/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskPrompt: "Design an automated trading hedging strategy", maxBranches: 3 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskId).toMatch(/^antigravity-/);
    expect(body.candidateHypotheses.length).toBe(3);
    expect(body.optimalStrategy).toBeDefined();
    expect(body.synthesizedConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it("POST /api/brain/cognition/ground validates factual claims", async () => {
    const res = await fetch(`${baseUrl}/api/brain/cognition/ground`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Referenced server/agent.ts and server/tools.ts" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isFullyGrounded).toBe(true);
    expect(body.score).toBe(100);
    expect(body.verifiedFilePaths).toContain("server/agent.ts");
  });

  it("POST /api/brain/cognition/symbol inspects symbol declarations", async () => {
    const res = await fetch(`${baseUrl}/api/brain/cognition/symbol`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "server/antigravity-brain.ts", symbolName: "getCognitiveTelemetry" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.exported).toBe(true);
    expect(body.line).toBeGreaterThan(0);
  });

  it("POST /api/brain/cognition/reflect executes self-correction reflection", async () => {
    const res = await fetch(`${baseUrl}/api/brain/cognition/reflect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "We achieved 10 out of 20 (95%) completion rate." }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.converged).toBe(true);
    expect(body.finalScore).toBe(100);
    expect(body.reflectedText).toContain("10 out of 20 (50%)");
  });

  it("GET /api/brain/cognition/telemetry returns metrics report", async () => {
    const res = await fetch(`${baseUrl}/api/brain/cognition/telemetry`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalInvocations).toBeDefined();
    expect(body.totalGroundingChecks).toBeDefined();
    expect(body.averageGroundingScore).toBeDefined();
  });
});
