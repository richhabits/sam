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
    // The old version's fabricated content — must never appear now that this is grounded.
    expect(JSON.stringify(report)).not.toContain("inter-thread contention");
    expect(JSON.stringify(report)).not.toContain("docs.local");
  });

  it("drops a synthesized finding that cites a sourceIndex not present in the real sources — never trusts the model's citation blindly", async () => {
    const search = async () => `• Real Source — a real search result\n  https://example.com/real`;
    const badSynthesize = async () => ({
      text: JSON.stringify({
        executiveSummary: "Summary [1].",
        keyFindings: [
          { claim: "Real finding tied to a real source.", sourceIndex: 1, confidence: 0.9 },
          { claim: "Fabricated finding citing a source that doesn't exist.", sourceIndex: 99, confidence: 0.9 },
        ],
        dissentingOrConflictingViews: [],
        suggestedFollowups: [],
      }),
    });
    const report = await conductDeepResearch("any topic", { search, synthesize: badSynthesize }, { depth: "quick" });
    expect(report.keyFindings.length).toBe(1);
    expect(report.keyFindings[0].claim).toBe("Real finding tied to a real source.");
  });

  it("reports honestly, without fabricating findings, when search returns nothing usable", async () => {
    const noResults = async () => "";
    const synthesize = async () => ({ text: "{}" });
    const report = await conductDeepResearch("an extremely obscure query", { search: noResults, synthesize }, { depth: "quick" });
    expect(report.sources.length).toBe(0);
    expect(report.keyFindings.length).toBe(0);
    expect(report.executiveSummary).toContain("no usable results");
  });
});
