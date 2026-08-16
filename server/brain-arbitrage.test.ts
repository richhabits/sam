import { describe, it, expect } from "vitest";
import { getBrainPerformanceMatrix, rankOptimalProvider } from "./brain-arbitrage.ts";
import { brainPerformanceMatrixTool } from "./tools.ts";

describe("Brain Performance & Latency Arbitrage Engine", () => {
  it("compiles performance matrix with benchmarks across providers", () => {
    const matrix = getBrainPerformanceMatrix();
    expect(matrix.totalConfiguredProviders).toBeGreaterThan(0);
    expect(matrix.freeTierCount).toBeGreaterThanOrEqual(1);
    expect(matrix.benchmarks.length).toBeGreaterThanOrEqual(4);
    expect(matrix.benchmarks[0].tokensPerSecond).toBeGreaterThan(100);
  });

  it("ranks optimal providers accurately by task specialization", () => {
    const fastRank = rankOptimalProvider("fast");
    expect(fastRank.recommendedId).toBe("groq");
    expect(fastRank.tier).toBe("free");

    const visionRank = rankOptimalProvider("vision");
    expect(visionRank.recommendedId).toBe("gemini");

    const reasonRank = rankOptimalProvider("reasoning");
    expect(reasonRank.recommendedId).toBe("deepseek");
  });

  it("brainPerformanceMatrixTool outputs formatted latency matrix", async () => {
    const out = await brainPerformanceMatrixTool();
    expect(out).toContain("SAM Brain Performance & Provider Arbitrage Matrix");
    expect(out).toContain("Fastest Interactive Streamer");
  });
});
