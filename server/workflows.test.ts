import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/tmp/sam-workflows-test";
let W: typeof import("./workflows.ts");
let S: typeof import("./starter-workflows.ts");

beforeAll(async () => {
  process.env.VAULT_DIR = SCRATCH;
  rmSync(SCRATCH, { recursive: true, force: true });
  W = await import("./workflows.ts");
  S = await import("./starter-workflows.ts");
});
beforeEach(() => { rmSync(SCRATCH, { recursive: true, force: true }); });

const NOW = "2026-07-10T09:00:00.000Z";
const mk = (overrides: Partial<import("./workflows.ts").Workflow> = {}) => ({
  id: "wf1", name: "Test flow", description: "d", version: 1, armed: false, createdAt: NOW, runs: [],
  steps: [
    { id: "s1", kind: "tool" as const, label: "read", tool: "read_file", input: { path: "/x" } },
    { id: "s2", kind: "brain" as const, label: "think", prompt: "summarise" },
    { id: "s3", kind: "tool" as const, label: "send", tool: "send_email", input: {} },
  ],
  ...overrides,
});

describe("workflow safety — dangerous steps never run unattended", () => {
  it("dangerousStepsIn flags the send_email step, not the safe ones", () => {
    const d = W.dangerousStepsIn(mk() as any);
    expect(d.map((s) => s.id)).toEqual(["s3"]);
    expect(W.hasDangerousStep(mk() as any)).toBe(true);
  });

  it("a run PAUSES at the dangerous step and NEVER executes it", async () => {
    const execTool = vi.fn(async () => "ok");
    const execBrain = vi.fn(async () => "thought");
    const run = await W.runWorkflow(mk() as any, { now: NOW, execTool, execBrain });
    expect(run.status).toBe("paused");
    expect(run.pausedAtStep).toBe("s3");
    // the safe read + brain ran; the dangerous send did NOT
    expect(execBrain).toHaveBeenCalledTimes(1);
    expect(execTool).toHaveBeenCalledTimes(1);
    expect(execTool).toHaveBeenCalledWith("read_file", { path: "/x" });
    // send_email was never passed to the executor
    expect(execTool.mock.calls.some((c: any[]) => c[0] === "send_email")).toBe(false);
  });

  it("ARMING a workflow does NOT let the dangerous step run — it still pauses", async () => {
    const execTool = vi.fn(async () => "ok");
    const run = await W.runWorkflow(mk({ armed: true }) as any, { now: NOW, execTool, execBrain: async () => "t" });
    expect(run.status).toBe("paused");
    expect(execTool.mock.calls.some((c: any[]) => c[0] === "send_email")).toBe(false);
  });

  it("an all-safe workflow runs to completion", async () => {
    const wf = mk({ steps: [
      { id: "s1", kind: "tool", label: "read", tool: "read_file", input: {} },
      { id: "s2", kind: "brain", label: "think", prompt: "go" },
    ] }) as any;
    const run = await W.runWorkflow(wf, { now: NOW, execTool: async () => "r", execBrain: async () => "b" });
    expect(run.status).toBe("done");
    expect(run.results).toHaveLength(2);
  });

  it("rejects an invalid workflow (bad name / no steps)", () => {
    expect(W.saveWorkflow(mk({ name: "" }) as any).ok).toBe(false);
    expect(W.saveWorkflow(mk({ steps: [] }) as any).ok).toBe(false);
    expect(W.saveWorkflow(mk() as any).ok).toBe(true);
  });
});

describe("starter workflows", () => {
  it("ships 6 with unique ids and at least one step each", () => {
    expect(S.STARTER_WORKFLOWS).toHaveLength(6);
    const ids = S.STARTER_WORKFLOWS.map((w) => w.id);
    expect(new Set(ids).size).toBe(6);
    expect(S.STARTER_WORKFLOWS.every((w) => w.steps.length >= 1)).toBe(true);
  });

  it("the starters that end in a dangerous step are caught by the gate", () => {
    for (const t of S.STARTER_WORKFLOWS) {
      const wf = { ...t, armed: false, createdAt: NOW, runs: [] } as any;
      const dangerous = W.dangerousStepsIn(wf);
      if (t.id === "inbox-triage") expect(dangerous.some((s) => s.tool === "send_email")).toBe(true);
      if (t.id === "release-checklist") expect(dangerous.some((s) => s.tool === "git_push")).toBe(true);
    }
  });
});
