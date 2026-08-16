import { describe, it, expect, vi } from "vitest";

// AUDIT FIX: resolveOptimalRoute used to hardcode primaryProvider/isZeroCostLane per tier
// regardless of whether that provider had ever had a key configured — same bug class as
// brain-arbitrage.ts's hardcoded "ONLINE". Mocking keys.ts directly (rather than relying on
// ambient env state) to prove both real outcomes: a confirmed key → honest zero-cost claim, no
// key anywhere in the chain → honest "best-effort, unconfirmed" rationale instead of a
// confident false claim.
const mockKeyStatus = vi.fn(() => [] as any[]);
vi.mock("./keys.ts", () => ({ keyStatus: mockKeyStatus }));

const { classifyPromptTier, resolveOptimalRoute } = await import("./speculative-router.ts");
const { speculativeRouteIntentTool } = await import("./tools.ts");

describe("Speculative Difficulty Cascade Router", () => {
  it("classifies instant chat and glance cards as TIER_0_INSTANT", () => {
    expect(classifyPromptTier("hello, how is my day today?")).toBe("TIER_0_INSTANT");
    expect(classifyPromptTier("what is the weather?")).toBe("TIER_0_INSTANT");
    expect(classifyPromptTier("")).toBe("TIER_0_INSTANT");
  });

  it("classifies coding, diffs, and tabular analysis as TIER_1_CODE_DATA", () => {
    expect(classifyPromptTier("refactor this typescript function")).toBe("TIER_1_CODE_DATA");
    expect(classifyPromptTier("profile this csv table for missing values")).toBe("TIER_1_CODE_DATA");
    expect(classifyPromptTier("write a unit test for my class")).toBe("TIER_1_CODE_DATA");
  });

  it("classifies swarms, proofs, and multi-stage pipelines as TIER_2_DEEP_REASON", () => {
    expect(classifyPromptTier("run a specialist swarm pipeline for security audit")).toBe("TIER_2_DEEP_REASON");
    expect(classifyPromptTier("construct a formal proof of safety")).toBe("TIER_2_DEEP_REASON");
  });

  it("resolveOptimalRoute claims zero-cost only when a provider in the chain has a confirmed key", () => {
    mockKeyStatus.mockReturnValue([
      { provider: "cerebras", total: 1, healthy: 1, cooling: 0, uses: 0, coolingUntil: 0 },
    ]);
    const route = resolveOptimalRoute("how are you doing?");
    expect(route.tier).toBe("TIER_0_INSTANT");
    expect(route.isZeroCostLane).toBe(true);
    expect(route.primaryProvider).toBe("cerebras");
    expect(route.failoverChain.length).toBeGreaterThan(1);
    mockKeyStatus.mockReturnValue([]);
  });

  it("resolveOptimalRoute is honest — no confident zero-cost claim when nothing in the chain has a confirmed key", () => {
    mockKeyStatus.mockReturnValue([]); // nothing configured at all
    const route = resolveOptimalRoute("how are you doing?");
    expect(route.tier).toBe("TIER_0_INSTANT");
    expect(route.isZeroCostLane).toBe(false);
    expect(route.rationale).toContain("none of these providers have a confirmed configured key");
  });

  it("promotes a genuinely-keyed failover provider over an unconfigured primary, instead of insisting on the unconfigured one", () => {
    mockKeyStatus.mockReturnValue([
      { provider: "groq", total: 1, healthy: 1, cooling: 0, uses: 0, coolingUntil: 0 },
    ]); // cerebras (primary) has no key, but groq (in the failover chain) does
    const route = resolveOptimalRoute("how are you doing?");
    expect(route.primaryProvider).toBe("groq");
    expect(route.isZeroCostLane).toBe(true);
    expect(route.rationale).toContain("promoted groq");
    mockKeyStatus.mockReturnValue([]);
  });

  it("speculativeRouteIntentTool formats plan cleanly", async () => {
    const out = await speculativeRouteIntentTool({ prompt: "build a multi-agent swarm architecture" });
    expect(out).toContain("Speculative Difficulty Route Plan");
    expect(out).toContain("Complexity Tier: [TIER_2_DEEP_REASON]");
  });
});
