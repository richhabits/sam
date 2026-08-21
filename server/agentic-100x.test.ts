import { describe, it, expect, vi } from "vitest";
import { buildExecutionWaves, execute100xAgenticWorkflow, type TaskNode } from "./agentic-100x.ts";

describe("100X ANTIGRAVITY AGENTIC SUPER-ENGINE", () => {
  it("buildExecutionWaves separates independent and dependent tasks into topological waves", () => {
    const nodes: TaskNode[] = [
      { id: "A", title: "Task A", task: "Do A", specialistId: "coder", dependencies: [], status: "pending" },
      { id: "B", title: "Task B", task: "Do B", specialistId: "coder", dependencies: [], status: "pending" },
      { id: "C", title: "Task C", task: "Do C", specialistId: "coder", dependencies: ["A"], status: "pending" },
      { id: "D", title: "Task D", task: "Do D", specialistId: "coder", dependencies: ["A", "B"], status: "pending" },
      { id: "E", title: "Task E", task: "Do E", specialistId: "security", dependencies: ["C", "D"], status: "pending" },
    ];

    const waves = buildExecutionWaves(nodes);
    expect(waves.length).toBe(3);
    // Wave 1: A and B can run concurrently
    expect(waves[0]).toContain("A");
    expect(waves[0]).toContain("B");
    // Wave 2: C and D run concurrently once A & B finish
    expect(waves[1]).toContain("C");
    expect(waves[1]).toContain("D");
    // Wave 3: E runs once C & D finish
    expect(waves[2]).toEqual(["E"]);
  });

  it("buildExecutionWaves handles circular or unreachable nodes gracefully without crashing", () => {
    const cyclicNodes: TaskNode[] = [
      { id: "X", title: "Task X", task: "Do X", specialistId: "coder", dependencies: ["Y"], status: "pending" },
      { id: "Y", title: "Task Y", task: "Do Y", specialistId: "coder", dependencies: ["X"], status: "pending" },
    ];

    const waves = buildExecutionWaves(cyclicNodes);
    expect(waves.length).toBeGreaterThanOrEqual(1);
    expect(waves.flat()).toContain("X");
    expect(waves.flat()).toContain("Y");
  });

  it("execute100xAgenticWorkflow executes pre-planned DAG and returns artifacts and metrics", async () => {
    const graph = {
      goal: "Build High Performance Microservice",
      nodes: [
        { id: "n1", title: "Database Schema", task: "Design PostgreSQL schema", specialistId: "architect", dependencies: [], status: "pending" as const },
        { id: "n2", title: "API Endpoints", task: "Write Express handlers", specialistId: "coder", dependencies: ["n1"], status: "pending" as const },
      ],
    };

    const res = await execute100xAgenticWorkflow(graph, {
      synthesize: false,
      generateArtifacts: true,
      subAgentRunner: async (task, specialist) => ({
        status: "done",
        output: `Completed task [${task}] by specialist [${specialist}] with optimal schema.`,
      }),
    });

    expect(res.workflowId).toMatch(/^100x-/);
    expect(res.totalNodes).toBe(2);
    expect(res.completedNodes).toBe(2);
    expect(res.waves.length).toBe(2);
    expect(res.artifacts.length).toBe(2);
    expect(res.speedupFactor).toBeGreaterThanOrEqual(1);
  });
});
