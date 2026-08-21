import { describe, it, expect } from "vitest";
import { parseCompilerDiagnostics, generateRepairPlan } from "./code-repair.ts";

describe("AUTONOMOUS CODE REPAIR & AST DIAGNOSTIC PATCHER", () => {
  it("parses compiler errors from tsc / linter output", () => {
    const rawOutput = `
server/models.ts:25:12 - error TS2304: Cannot find name 'mysterySymbol'.
src/App.tsx(102,15): error TS2322: Type 'number' is not assignable to type 'string'.
`;

    const diagnostics = parseCompilerDiagnostics(rawOutput);
    expect(diagnostics.length).toBe(2);

    expect(diagnostics[0].filePath).toBe("server/models.ts");
    expect(diagnostics[0].line).toBe(25);
    expect(diagnostics[0].column).toBe(12);
    expect(diagnostics[0].message).toContain("mysterySymbol");

    expect(diagnostics[1].filePath).toBe("src/App.tsx");
    expect(diagnostics[1].line).toBe(102);
  });

  it("generates repair plan with target lines and candidates", () => {
    const rawOutput = `server/index.ts:45:5 - error TS2554: Expected 2 arguments, but got 1.`;
    const diagnostics = parseCompilerDiagnostics(rawOutput);
    const plan = generateRepairPlan(diagnostics);

    expect(plan.diagnosticsCount).toBe(1);
    expect(plan.repairedFiles).toEqual(["server/index.ts"]);
    expect(plan.candidates.length).toBe(1);
    expect(plan.candidates[0].startLine).toBe(43);
    expect(plan.candidates[0].endLine).toBe(47);
  });

  it("returns clean summary when no diagnostics exist", () => {
    const plan = generateRepairPlan([]);
    expect(plan.diagnosticsCount).toBe(0);
    expect(plan.summary).toContain("100% clean");
  });
});
