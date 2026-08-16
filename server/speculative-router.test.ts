import { describe, it, expect } from "vitest";
import { classifyPromptTier, resolveOptimalRoute } from "./speculative-router.ts";
import { speculativeRouteIntentTool } from "./tools.ts";

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

  it("resolveOptimalRoute picks 0-cost fast LPU for Tier 0 and provides failover chain", () => {
    const route = resolveOptimalRoute("how are you doing?");
    expect(route.tier).toBe("TIER_0_INSTANT");
    expect(route.isZeroCostLane).toBe(true);
    expect(route.primaryProvider).toBe("cerebras");
    expect(route.failoverChain.length).toBeGreaterThan(1);
  });

  it("speculativeRouteIntentTool formats plan cleanly", async () => {
    const out = await speculativeRouteIntentTool({ prompt: "build a multi-agent swarm architecture" });
    expect(out).toContain("Speculative Difficulty Route Plan");
    expect(out).toContain("Complexity Tier: [TIER_2_DEEP_REASON]");
  });
});
