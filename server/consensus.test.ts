import { describe, it, expect } from "vitest";
import { runMultiModelConsensus } from "./consensus.ts";

describe("MULTI-MODEL CONSENSUS ENGINE", () => {
  it("queries panel in parallel with customRunner and synthesizes consensus", async () => {
    const report = await runMultiModelConsensus("What is the speed of light in vacuum?", {
      modelsCount: 3,
      customRunner: async (provider, prompt) => {
        return `[${provider}] The speed of light in vacuum is exactly 299,792,458 metres per second.`;
      },
    });

    expect(report.participatingCount).toBe(3);
    expect(report.confidenceScorePct).toBeGreaterThanOrEqual(70);
    expect(report.consensusAnswer).toContain("299,792,458");
    expect(report.opinions.length).toBe(3);
  });

  it("handles model failure gracefully when one provider fails", async () => {
    const report = await runMultiModelConsensus("Explain Dijkstra algorithm", {
      modelsCount: 2,
      customRunner: async (provider) => {
        if (provider === "cerebras") throw new Error("Rate limit 429");
        return "Dijkstra algorithm finds shortest paths in weighted graphs.";
      },
    });

    expect(report.participatingCount).toBe(1);
    expect(report.opinions.find((o) => o.status === "error")).toBeDefined();
    expect(report.consensusAnswer).toContain("Dijkstra");
  });
});
