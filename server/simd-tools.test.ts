import { describe, it, expect } from "vitest";
import { executeSimdToolBatch } from "./simd-tools.ts";
import { simdParallelToolBatchTool } from "./tools.ts";

describe("Parallel SIMD Tool Dispatcher", () => {
  it("executes multiple independent tool calls in parallel with measured speedup", async () => {
    const calls = [
      { name: "toolA", args: { x: 1 } },
      { name: "toolB", args: { y: 2 } },
      { name: "toolC", args: { z: 3 } },
    ];

    const mockRunner = async (name: string) => {
      await new Promise(r => setTimeout(r, 20));
      return `Result from ${name}`;
    };

    const report = await executeSimdToolBatch(calls, mockRunner);

    expect(report.totalTools).toBe(3);
    expect(report.completedCount).toBe(3);
    expect(report.failedCount).toBe(0);
    expect(report.speedupFactor).toBeGreaterThan(1.0);
    expect(report.results.length).toBe(3);
  });

  it("handles empty or empty-calls inputs gracefully", async () => {
    const report = await executeSimdToolBatch([], async () => "ok");
    expect(report.totalTools).toBe(0);
    expect(report.completedCount).toBe(0);
  });

  it("captures rejections cleanly without throwing unhandled exceptions", async () => {
    const calls = [{ name: "flakyTool" }];
    const report = await executeSimdToolBatch(calls, async () => {
      throw new Error("Network timeout");
    });

    expect(report.failedCount).toBe(1);
    expect(report.results[0].status).toBe("rejected");
    expect(report.results[0].output).toContain("Network timeout");
  });

  it("simdParallelToolBatchTool formats report and refuses empty input", async () => {
    const bad = await simdParallelToolBatchTool({ calls: [] });
    expect(bad).toContain("Error");

    const good = await simdParallelToolBatchTool({
      calls: [{ name: "sam_master_dashboard", args: {} }]
    });
    expect(good).toContain("SIMD Parallel Tool Batch Executed");
  });
});
