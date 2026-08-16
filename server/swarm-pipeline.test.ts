import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the model so tests run fast and offline without network or keys
vi.mock("./models.ts", () => ({
  runModel: vi.fn(async (_tier, _sys, prompt) => {
    if (typeof prompt === "string" && prompt.includes("Pipeline Goal:")) {
      return { text: "Synthesis: Pipeline successfully executed end-to-end.", provider: "test", tier: "local" };
    }
    if (typeof prompt === "string" && prompt.includes("Scout the architecture")) {
      return { text: "Scout Report: Architecture is clean.", provider: "test", tier: "local" };
    }
    if (typeof prompt === "string" && prompt.includes("Implement the fix")) {
      return { text: "Coder Report: Changes applied.", provider: "test", tier: "local" };
    }
    return { text: "Stage completed output.", provider: "test", tier: "local" };
  }),
  streamModel: vi.fn(async (_t, _s, _p, onChunk) => {
    onChunk?.("done");
    return { text: "done", provider: "test", tier: "local" };
  }),
  grammarReaches: vi.fn(async () => false),
}));

import { swarmPipeline, type PipelineStage } from "./swarm.ts";
import { swarmPipelineTool } from "./tools.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-pipeline-test-"));
  process.env.VAULT_DIR = dir;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("Swarm Multi-Stage Pipeline", () => {
  it("executes sequential stages passing previous output through {{previous}}", async () => {
    const stages: PipelineStage[] = [
      { name: "Scouting", specialistId: "scout", taskTemplate: "Scout the architecture." },
      { name: "Implementation", specialistId: "coder", taskTemplate: "Implement the fix based on: {{previous}}" },
    ];

    const res = await swarmPipeline(stages, {
      initialInput: "Initial context",
      synthesize: true,
      goal: "Architecture refactor",
    });

    expect(res.status).toBe("done");
    expect(res.stages.length).toBe(2);
    expect(res.stages[0].status).toBe("done");
    expect(res.stages[1].status).toBe("done");
    expect(res.stages[1].input).toContain("Scout Report: Architecture is clean.");
    expect(res.synthesis).toContain("Synthesis:");
  });

  it("formats pipeline tool output cleanly", async () => {
    const out = await swarmPipelineTool({
      stages: [
        { name: "Analyze", specialist: "scout", task: "Scout the architecture." },
        { name: "Build", specialist: "coder", task: "Implement the fix." },
      ],
      synthesize: true,
      goal: "Full build",
    });

    expect(out).toContain("Swarm Pipeline");
    expect(out).toContain("Step \"Analyze\" (scout) [DONE]");
    expect(out).toContain("Step \"Build\" (coder) [DONE]");
    expect(out).toContain("## Pipeline Synthesis:");
  });

  it("handles empty stages array gracefully", async () => {
    const out = await swarmPipelineTool({ stages: [] });
    expect(out).toContain("Error: stages array is required");
  });
});
