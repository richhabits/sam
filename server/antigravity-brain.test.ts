import { describe, it, expect } from "vitest";
import {
  verifyFactualGrounding,
  executeAntigravityCognition,
  runAntigravitySilentVerifier,
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

  it("executes speculative multi-branch cognition and returns optimal strategy", () => {
    const cognition = executeAntigravityCognition("Refactor and fix compiler errors in server/p2p-mesh.ts", {
      maxBranches: 3,
    });

    expect(cognition.taskId).toMatch(/^antigravity-/);
    expect(cognition.candidateHypotheses.length).toBe(3);
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
});
