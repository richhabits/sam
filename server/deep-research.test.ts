import { describe, it, expect } from "vitest";
import { decomposeResearchQuery, calculateConsensusScore, conductDeepResearch } from "./deep-research.ts";

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

  it("synthesizes grounded deep research report with citations and consensus metrics", async () => {
    const mockDeps = {
      search: async (q: string) => `• Research Paper Title — Key findings on ${q}\n  https://example.com/paper-1`,
      synthesize: async (_sys: string, _prompt: string) => ({
        text: JSON.stringify({
          executiveSummary: "Hybrid swarm architectures enable resilient distributed processing.",
          keyFindings: [{ claim: "Decentralized consensus minimizes latency overhead.", sourceIndex: 1, confidence: 0.92 }],
          dissentingOrConflictingViews: ["Network partitions can degrade synchronization throughput."],
          suggestedFollowups: ["Benchmark token throughput under fault injection."],
        }),
      }),
    };
    const report = await conductDeepResearch("hybrid swarm architectures", mockDeps, { depth: "quick" });
    expect(report.topic).toBe("hybrid swarm architectures");
    expect(report.keyFindings.length).toBeGreaterThanOrEqual(1);
    expect(report.consensusConfidencePct).toBeGreaterThan(0);
    expect(report.sources.length).toBeGreaterThanOrEqual(1);
  });
});
