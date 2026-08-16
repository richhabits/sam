import { describe, it, expect } from "vitest";
import { decomposeResearchQuery, calculateConsensusScore, conductDeepResearch } from "./deep-research.ts";
import { deepResearchSynthesizerTool } from "./tools.ts";

describe("Autonomous Deep Research Synthesizer", () => {
  it("decomposes queries into multi-angle research subqueries", () => {
    const subqueries = decomposeResearchQuery("quantum computing algorithms");
    expect(subqueries.length).toBe(4);
    expect(subqueries[0]).toContain("quantum computing algorithms overview");
    expect(subqueries[1]).toContain("benchmarks");
  });

  it("handles empty query gracefully", () => {
    const sub = decomposeResearchQuery("");
    expect(sub.length).toBeGreaterThan(0);
  });

  it("calculates multi-source consensus confidence score bounded properly", () => {
    const score = calculateConsensusScore(3, 3);
    expect(score).toBeGreaterThanOrEqual(50);
    expect(score).toBeLessThanOrEqual(100);

    const emptyScore = calculateConsensusScore(0, 0);
    expect(emptyScore).toBe(0);
  });

  it("synthesizes grounded deep research report with citations and consensus metrics", () => {
    const report = conductDeepResearch("hybrid swarm architectures", { depth: "deep" });
    expect(report.topic).toBe("hybrid swarm architectures");
    expect(report.keyFindings.length).toBeGreaterThanOrEqual(1);
    expect(report.consensusConfidencePct).toBeGreaterThan(50);
    expect(report.sources.length).toBeGreaterThanOrEqual(1);
  });

  it("deepResearchSynthesizerTool produces formatted executive brief", async () => {
    const out = await deepResearchSynthesizerTool({ query: "distributed vector memory" });
    expect(out).toContain("SAM Deep Research Brief");
    expect(out).toContain("Executive Summary");
    expect(out).toContain("Consensus Score");
  });
});
