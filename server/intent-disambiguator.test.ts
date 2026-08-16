import { describe, it, expect } from "vitest";
import { disambiguateUserIntent } from "./intent-disambiguator.ts";
import { intentAutoDisambiguatorTool, TOOLS } from "./tools.ts";

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
    expect(res.inferredArgs.path).toBe("/workspace/server/engine.ts");
  });

  // AUDIT FIX: the "refactor" branch suggested { filePath: ... }, but ast_replace_symbol's real
  // parameter is `path` — a key mismatch the previous version of this test asserted directly, so
  // it never caught the drift; a suggested call built from it would have silently failed to
  // resolve the target file. Cross-checks every branch's suggested arg keys against the real
  // tool's own params string, so a future rename on either side gets caught here instead of
  // failing silently at call time.
  it("every branch's suggested arg keys match the recommended tool's real parameters", () => {
    const prompts: [string, { activeFile?: string }?][] = [
      ["audit"],
      ["clean up memory"],
      ["status"],
      ["research quantum memory"],
      ["refactor this code", { activeFile: "/workspace/server/engine.ts" }],
      ["something entirely unrelated"], // default fallback branch
    ];
    for (const [prompt, hints] of prompts) {
      const res = disambiguateUserIntent(prompt, hints);
      const tool = TOOLS.find((t) => t.name === res.recommendedTool);
      expect(tool, `recommendedTool "${res.recommendedTool}" for prompt "${prompt}" isn't a real registered tool`).toBeDefined();
      for (const key of Object.keys(res.inferredArgs)) {
        expect(tool!.params, `inferredArgs key "${key}" for prompt "${prompt}" isn't in ${res.recommendedTool}'s real params`).toContain(key);
      }
    }
  });

  it("intentAutoDisambiguatorTool formats result with confidence score", async () => {
    const out = await intentAutoDisambiguatorTool({ prompt: "research quantum memory" });
    expect(out).toContain("Disambiguated Intent");
    expect(out).toContain("deep_research_synthesizer");
  });
});
