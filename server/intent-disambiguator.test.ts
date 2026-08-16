import { describe, it, expect } from "vitest";
import { disambiguateUserIntent } from "./intent-disambiguator.ts";
import { intentAutoDisambiguatorTool } from "./tools.ts";

describe("Intent Auto-Disambiguator ('Knows What\\'s What')", () => {
  it("disambiguates 'audit' to brain performance matrix", () => {
    const res = disambiguateUserIntent("audit");
    expect(res.recommendedTool).toBe("brain_performance_matrix");
    expect(res.confidencePct).toBeGreaterThan(90);
  });

  it("disambiguates 'clean' to space consumption optimizer", () => {
    const res = disambiguateUserIntent("clean up memory");
    expect(res.recommendedTool).toBe("space_consumption_optimizer");
    expect(res.inferredArgs.mode).toBe("compact");
  });

  it("disambiguates 'status' to master operations dashboard", () => {
    const res = disambiguateUserIntent("status");
    expect(res.recommendedTool).toBe("sam_master_dashboard");
    expect(res.confidencePct).toBeGreaterThan(90);
  });

  it("uses active file context when user says 'refactor'", () => {
    const res = disambiguateUserIntent("refactor this code", { activeFile: "/workspace/server/engine.ts" });
    expect(res.recommendedTool).toBe("ast_replace_symbol");
    expect(res.inferredArgs.filePath).toBe("/workspace/server/engine.ts");
  });

  it("intentAutoDisambiguatorTool formats result with confidence score", async () => {
    const out = await intentAutoDisambiguatorTool({ prompt: "research quantum memory" });
    expect(out).toContain("Disambiguated Intent");
    expect(out).toContain("deep_research_synthesizer");
  });
});
