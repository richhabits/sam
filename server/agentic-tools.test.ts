import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-test-"));
  process.env.VAULT_DIR = dir;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

import { astOutlineTool, runTestsTool } from "./tools.ts";
import * as shMod from "./tools.ts";

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
      expect(out).toContain("[Line 18] export const arrowFunc => { ... }");
      expect(out).toContain("[Line 22] export const someVal = ...");
    });

    it("handles missing files gracefully", async () => {
      const out = await astOutlineTool({ path: join(dir, "missing.ts") });
      expect(out).toContain("not found");
    });
  });

  describe("runTestsTool", () => {
    it("reports success when all tests pass", async () => {
      vi.spyOn(shMod, "sh").mockResolvedValue({
        stdout: JSON.stringify({
          success: true,
          numPassedTests: 10,
          numPassedTestSuites: 2
        }),
        stderr: ""
      });

      const out = await runTestsTool({ path: "some/path" });
      expect(out).toBe("Success: All 10 tests passed in 2 suites.");
    });

    it("reports exact failures concisely when tests fail", async () => {
      vi.spyOn(shMod, "sh").mockResolvedValue({
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
                  failureMessages: ["Error: Expected 1 to equal 2"]
                }
              ]
            }
          ]
        }),
        stderr: ""
      });

      const out = await runTestsTool({ path: "some/path" });
      expect(out).toContain("Tests Failed!");
      expect(out).toContain("My Suite > should do thing");
      expect(out).toContain("src/bad.test.ts");
      expect(out).toContain("Expected 1 to equal 2");
    });
    
    it("handles parsing errors gracefully", async () => {
      vi.spyOn(shMod, "sh").mockResolvedValue({
        stdout: "This is not JSON",
        stderr: "Fatal error"
      });
      const out = await runTestsTool({});
      expect(out).toContain("Failed to parse test output");
      expect(out).toContain("Fatal error");
    });
  });
});
