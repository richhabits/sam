import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { astReplaceSymbolTool } from "./tools.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-ast-test-"));
  process.env.VAULT_DIR = dir;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("astReplaceSymbolTool", () => {
  it("replaces exact symbol identifiers across declaration and usages", async () => {
    const file = join(dir, "calculator.ts");
    writeFileSync(
      file,
      `export function calculateTotal(items: any[]) {\n  const total = items.length;\n  return total;\n}`
    );

    const out = await astReplaceSymbolTool({
      path: file,
      oldSymbol: "calculateTotal",
      newSymbol: "computeGrandTotal",
      dryRun: false,
    });

    expect(out).toContain("AST Symbol Refactor Applied");
    expect(out).toContain("computeGrandTotal");

    const updated = readFileSync(file, "utf8");
    expect(updated).toContain("export function computeGrandTotal(items: any[])");
  });

  it("supports dry-run mode without modifying file", async () => {
    const file = join(dir, "user.ts");
    const original = `export interface UserProfile {\n  userId: string;\n}`;
    writeFileSync(file, original);

    const out = await astReplaceSymbolTool({
      path: file,
      oldSymbol: "UserProfile",
      newSymbol: "AccountProfile",
      dryRun: true,
    });

    expect(out).toContain("AST Symbol Refactor (Dry Run)");
    expect(out).toContain("AccountProfile");

    const content = readFileSync(file, "utf8");
    expect(content).toBe(original);
  });

  it("handles missing symbol or nonexistent file gracefully", async () => {
    const file = join(dir, "empty.ts");
    writeFileSync(file, "const a = 1;");

    const outNoMatch = await astReplaceSymbolTool({
      path: file,
      oldSymbol: "nonexistentSymbol",
      newSymbol: "newSymbol",
    });
    expect(outNoMatch).toContain("No identifier occurrences");

    const outMissing = await astReplaceSymbolTool({
      path: join(dir, "missing.ts"),
      oldSymbol: "a",
      newSymbol: "b",
    });
    expect(outMissing).toContain("not found");
  });
});
