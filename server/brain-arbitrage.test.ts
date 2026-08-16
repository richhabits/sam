import { describe, it, expect, vi } from "vitest";

// AUDIT FIX: status was hardcoded "ONLINE" for every entry, regardless of whether a key was
// ever configured — a user with zero Groq/Cerebras keys would still be confidently told those
// lanes were online. Mocking keys.ts directly (rather than relying on ambient env state, which
// varies by machine/CI and wouldn't deterministically prove anything) to pin the three real
// outcomes: a healthy key → ONLINE, a configured-but-all-cooling key → DEGRADED, no key at all
// → NO_KEY.
const mockKeyStatus = vi.fn(() => [
  { provider: "groq", total: 2, healthy: 2, cooling: 0, uses: 5, coolingUntil: 0 },
  { provider: "deepseek", total: 1, healthy: 0, cooling: 1, uses: 3, coolingUntil: Date.now() + 60000 },
  // cerebras/anthropic: no entry at all — never configured
]);
vi.mock("./keys.ts", () => ({ keyStatus: mockKeyStatus }));

const { getBrainPerformanceMatrix, rankOptimalProvider } = await import("./brain-arbitrage.ts");
const { brainPerformanceMatrixTool } = await import("./tools.ts");

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

  it("status reflects real key state instead of a hardcoded ONLINE literal", () => {
    const matrix = getBrainPerformanceMatrix();
    const byId = Object.fromEntries(matrix.benchmarks.map((b) => [b.id, b]));

    expect(byId.groq.status).toBe("ONLINE");        // healthy key configured
    expect(byId.deepseek.status).toBe("DEGRADED");   // key configured, but cooling from failures
    expect(byId.cerebras.status).toBe("NO_KEY");     // never configured, not keyless
    expect(byId.anthropic.status).toBe("NO_KEY");    // never configured, not keyless
    expect(byId.pollinations.status).toBe("ONLINE"); // genuinely keyless, even though absent from PROVIDER_REGISTRY
  });

  it("only recommends a fastest/reasoning provider that's actually online", () => {
    const matrix = getBrainPerformanceMatrix();
    // deepseek is DEGRADED in this fixture, so the reasoning recommendation must fall through
    // to something else that's actually online, not just report the DEGRADED entry anyway.
    expect(matrix.bestReasoningProvider).not.toContain("DeepSeek");
  });
});
