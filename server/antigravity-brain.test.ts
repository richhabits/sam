import { describe, it, expect } from "vitest";
import {
  verifyFactualGrounding,
  executeAntigravityCognition,
  runAntigravitySilentVerifier,
  verifySymbolDeclaration,
  runCognitiveReflectionLoop,
  getCognitiveTelemetry,
  generatePremiumDesignSystem,
} from "./antigravity-brain.ts";

describe("S.A.M. Antigravity Cognitive Brain & Factual Grounding Engine", () => {
  it("verifies factual file references against active workspace", () => {
    // Valid real files in repo
    const textWithRealFiles = `I examined server/agent.ts and verified server/tools.ts along with server/index.ts.`;
    const reportValid = verifyFactualGrounding(textWithRealFiles);

    expect(reportValid.isFullyGrounded).toBe(true);
    expect(reportValid.score).toBe(100);
    expect(reportValid.verifiedFilePaths).toContain("server/agent.ts");
    expect(reportValid.verifiedFilePaths).toContain("server/tools.ts");
    expect(reportValid.discrepancies.length).toBe(0);

    // Text with nonexistent/hallucinated file path
    const textWithFakeFile = `Check the logic in server/nonexistent-fake-module-12345.ts for details.`;
    const reportInvalid = verifyFactualGrounding(textWithFakeFile);

    expect(reportInvalid.isFullyGrounded).toBe(false);
    expect(reportInvalid.score).toBeLessThan(100);
    expect(reportInvalid.discrepancies.some((d) => d.category === "FILE_NONEXISTENT")).toBe(true);
  });

  it("detects and corrects mathematical claim inconsistencies", () => {
    // Correct claim: 15 out of 20 (75%)
    const correctText = `Result: 15 out of 20 (75%) passed.`;
    const reportCorrect = verifyFactualGrounding(correctText);
    expect(reportCorrect.discrepancies.filter((d) => d.category === "MATH_INCONSISTENCY").length).toBe(0);

    // Inconsistent claim: 10 out of 50 (80%) -> actual is 20%
    const badMathText = `We processed 10 out of 50 (80%) transactions successfully.`;
    const reportBad = verifyFactualGrounding(badMathText);
    expect(reportBad.discrepancies.some((d) => d.category === "MATH_INCONSISTENCY")).toBe(true);
    expect(reportBad.score).toBeLessThanOrEqual(75);
  });

  it("verifies symbol declarations in real TypeScript files", () => {
    // Real exported function in server/antigravity-brain.ts
    const symValid = verifySymbolDeclaration("server/antigravity-brain.ts", "verifyFactualGrounding");
    expect(symValid.found).toBe(true);
    expect(symValid.exported).toBe(true);
    expect(symValid.line).toBeGreaterThan(0);

    // Non-existent symbol
    const symInvalid = verifySymbolDeclaration("server/antigravity-brain.ts", "fakeNonExistentSymbol12345");
    expect(symInvalid.found).toBe(false);
    expect(symInvalid.exported).toBe(false);
  });

  it("refuses to read files outside the workspace root — no arbitrary-file-read via ../ or absolute paths", () => {
    // Reachable from three unauthenticated routes/tools; must fail closed the same way "not found" does.
    const traversal = verifySymbolDeclaration("../../../../../../etc/passwd", "root");
    expect(traversal.found).toBe(false);
    expect(traversal.exported).toBe(false);

    const absolute = verifySymbolDeclaration("/etc/passwd", "root");
    expect(absolute.found).toBe(false);
    expect(absolute.exported).toBe(false);
  });

  it("executes autonomous cognitive reflection loop and auto-repairs discrepancies", () => {
    const textWithFlawedMath = `During benchmark evaluation, 10 out of 50 (80%) tests passed in server/agent.ts.`;
    const reflection = runCognitiveReflectionLoop(textWithFlawedMath, { maxIterations: 3 });

    expect(reflection.iterationsExecuted).toBeGreaterThanOrEqual(1);
    expect(reflection.repairsApplied.length).toBeGreaterThan(0);
    expect(reflection.reflectedText).toContain("10 out of 50 (20%)");
    expect(reflection.finalScore).toBe(100);
    expect(reflection.converged).toBe(true);
  });

  it("tracks and accumulates real-time cognitive telemetry", () => {
    const telemetry = getCognitiveTelemetry();
    expect(telemetry.totalInvocations).toBeGreaterThanOrEqual(0);
    expect(telemetry.totalGroundingChecks).toBeGreaterThan(0);
    expect(telemetry.averageGroundingScore).toBeGreaterThan(0);
    expect(telemetry.reflectionsExecuted).toBeGreaterThan(0);
  });

  it("executes speculative multi-branch cognition and returns optimal strategy", () => {
    const cognition = executeAntigravityCognition("Refactor and fix compiler errors in server/p2p-mesh.ts", {
      maxBranches: 4,
    });

    expect(cognition.taskId).toMatch(/^antigravity-/);
    expect(cognition.candidateHypotheses.length).toBe(4);
    expect(cognition.synthesizedConfidence).toBeGreaterThanOrEqual(0.9);
    expect(cognition.recommendedToolSequence).toContain("edit_file");
    expect(cognition.groundingReport).toBeDefined();
  });

  it("handles silent verifier during testing without throwing", () => {
    const res = runAntigravitySilentVerifier(
      "write_file",
      { path: "server/temp-test.ts", content: "export const x = 1;" },
      "File written successfully."
    );
    expect(res).toBe("File written successfully.");
  });

  it("compiles 100x ultra-premium design system tokens, glassmorphism CSS, and blueprints", () => {
    const ds = generatePremiumDesignSystem({ brandName: "OmniCraft", theme: "obsidian" });
    expect(ds.brandName).toBe("OmniCraft");
    expect(ds.theme).toBe("obsidian");
    expect(ds.colorTokens.bg).toBe("#0B0F19");
    expect(ds.glassmorphismCss).toContain("--border-glass");
    expect(ds.heroComponentHtml).toContain("OmniCraft");
    expect(ds.cardComponentHtml).toContain("glass-card");
  });

  it("queries the Antigravity knowledge graph in stats and query modes", async () => {
    const { antigravityKnowledgeGraphTool } = await import("./tools.ts");
    const stats = await antigravityKnowledgeGraphTool({ mode: "stats" });
    expect(stats).toBeDefined();

    const query = await antigravityKnowledgeGraphTool({ query: "agent", mode: "query" });
    expect(query).toBeDefined();
  });

  it("executes the Antigravity self-heal diagnostic tool", async () => {
    const { antigravitySelfHealTool } = await import("./tools.ts");
    const report = await antigravitySelfHealTool();
    expect(report).toContain("Antigravity Self-Healing Diagnostic Scan");
  });
});

