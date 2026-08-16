import { describe, it, expect } from "vitest";
import { prewarmContext, compactContextForFreeLanes } from "./prefetch.ts";
import { prefetchWarmContextTool } from "./tools.ts";

describe("Predictive Context Prefetcher & Compactor", () => {
  it("pre-warms designated context topics in L1 cache", () => {
    const res = prewarmContext(["portfolio_vitals", "live_tickers"]);
    expect(res.l1TotalEntries).toBeGreaterThan(0);
    expect(res.durationMs).toBeGreaterThanOrEqual(1);
  });

  it("compacts historical conversation messages reducing token overhead", () => {
    const messages = [
      { role: "user", content: "Tell me about quantum algorithms and entanglement properties in supercomputers." },
      { role: "assistant", content: "Quantum algorithms leverage superposition and entanglement to solve discrete logarithm problems in polynomial time." },
      { role: "user", content: "How does Shor's algorithm work in detail?" },
      { role: "assistant", content: "Shor's algorithm uses quantum Fourier transform to determine period r of a function f(x) = a^x mod N." },
      { role: "user", content: "What is next?" },
      { role: "assistant", content: "Next we can explore error correction codes." },
    ];

    const result = compactContextForFreeLanes(messages);
    expect(result.originalMessageCount).toBe(6);
    expect(result.compactedText).toContain("Active Dialogue:");
    expect(result.tokenReductionRatioPct).toBeGreaterThanOrEqual(0);
  });

  it("handles empty message array gracefully", () => {
    const res = compactContextForFreeLanes([]);
    expect(res.originalMessageCount).toBe(0);
    expect(res.compactedText).toBe("");
  });

  it("prefetchWarmContextTool outputs formatted prewarm telemetry", async () => {
    const out = await prefetchWarmContextTool({ topics: ["test_feed"] });
    expect(out).toContain("Predictive L1 Cache");
  });
});
