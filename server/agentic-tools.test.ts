import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// runTestsTool shells out via execFile("npx", ["vitest", ...]). Mocking it here isn't optional:
// without this, these tests spawn a REAL nested `npx vitest run` from inside a vitest run every
// time the suite executes — which is exactly how a load-average-100 process storm happened in
// practice (every re-run of the suite kept spawning more real recursive vitest processes). The
// earlier version of this file spied on the unrelated `sh` export, which runTestsTool doesn't
// call at all anymore, so the mock silently did nothing.
//
// Uses the well-known symbol name directly (rather than importing `promisify` from node:util)
// because this whole block runs inside vi.hoisted(), above where import bindings are live.
const { mockExecFile } = vi.hoisted(() => {
  const fn: any = vi.fn(async () => ({ stdout: "", stderr: "" }));
  fn[Symbol.for("nodejs.util.promisify.custom")] = (...args: any[]) => fn(...args);
  return { mockExecFile: fn };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, execFile: mockExecFile };
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-test-"));
  process.env.VAULT_DIR = dir;
  mockExecFile.mockReset();
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

import { astOutlineTool, runTestsTool } from "./tools.ts";

describe("Agentic Tools", () => {
  describe("astOutlineTool", () => {
    it("extracts classes, interfaces, types, and functions from a TS file", async () => {
      const p = join(dir, "test.ts");
      writeFileSync(p, `
import { stuff } from "fs";

export class MyClass {
  hello() {}
}

interface MyInterface {
  id: string;
}

export type StringType = string;

export function doThing(a: string) {
  return a;
}

export const arrowFunc = () => {
  console.log("arrow");
};

export const someVal = 123;
      `);

      const out = await astOutlineTool({ path: p });
      expect(out).toContain("[Line 4] export class MyClass");
      expect(out).toContain("[Line 8] interface MyInterface");
      expect(out).toContain("[Line 12] export type StringType = string;");
      expect(out).toContain("[Line 14] export function doThing(a: string)");
      expect(out).toContain("[Line 18] export const arrowFunc = () => { ... }");
      expect(out).toContain("[Line 22] export const someVal = ...");
    });

    it("handles missing files gracefully", async () => {
      const out = await astOutlineTool({ path: join(dir, "missing.ts") });
      expect(out).toContain("not found");
    });
  });

  describe("runTestsTool", () => {
    it("reports success when all tests pass", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          success: true,
          numPassedTests: 10,
          numPassedTestSuites: 2,
        }),
        stderr: "",
      });

      const p = join(dir, "some.test.ts");
      writeFileSync(p, "");
      const out = await runTestsTool({ path: p });
      expect(out).toBe("Success: All 10 tests passed in 2 suites.");
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it("reports exact failures concisely when tests fail", async () => {
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          success: false,
          testResults: [
            {
              name: "src/bad.test.ts",
              status: "failed",
              assertionResults: [
                {
                  status: "failed",
                  ancestorTitles: ["My Suite"],
                  title: "should do thing",
                  failureMessages: ["Error: Expected 1 to equal 2"],
                },
              ],
            },
          ],
        }),
        stderr: "",
      });

      const p = join(dir, "bad.test.ts");
      writeFileSync(p, "");
      const out = await runTestsTool({ path: p });
      expect(out).toContain("Tests Failed!");
      expect(out).toContain("My Suite > should do thing");
      expect(out).toContain("src/bad.test.ts");
      expect(out).toContain("Expected 1 to equal 2");
    });

    it("handles parsing errors gracefully", async () => {
      mockExecFile.mockResolvedValue({
        stdout: "This is not JSON",
        stderr: "Fatal error",
      });
      const out = await runTestsTool({});
      expect(out).toContain("Failed to parse test output");
      expect(out).toContain("Fatal error");
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it("refuses a test path that does not exist, without ever shelling out", async () => {
      const out = await runTestsTool({ path: "some/nonexistent/path" });
      expect(out).toContain("not found");
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });
});
