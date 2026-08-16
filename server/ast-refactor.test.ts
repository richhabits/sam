import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// astReplaceSymbolTool validates renames by running `npx tsc --noEmit` against the WHOLE
// project (cwd: process.cwd()), which never actually inspects files living outside the
// project's tsconfig include set — such as this suite's own mkdtemp() fixtures. Confirmed by
// running the same command directly against a temp-dir collision file: zero mention of it in
// the output. So a real compile error is mocked here rather than relied upon, to actually
// exercise the revert-on-failure path rather than silently no-op through it.
vi.mock("node:child_process", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, execSync: vi.fn(actual.execSync) };
});
import { execSync } from "node:child_process";
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

  // AUDIT FIX: the rename applied and wrote to disk BEFORE tsc validation ran, and never
  // reverted on failure — a "TypeScript errors detected" result still left broken code on disk.
  // Since this is a word-boundary text replace, not a real scope-aware AST rename, a broken
  // rename is a realistic outcome (e.g. renaming into a name that collides with an existing
  // declaration), not a hypothetical edge case.
  it("reverts the file to its original content when the rename breaks compilation", async () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("tsc failed"), { stdout: "error TS2393: Duplicate function implementation." });
    });

    const file = join(dir, "collision.ts");
    const original = `export function alpha(): number {\n  return 1;\n}\n`;
    writeFileSync(file, original);

    const out = await astReplaceSymbolTool({
      path: file,
      oldSymbol: "alpha",
      newSymbol: "beta",
      dryRun: false,
    });

    expect(out).toContain("REVERTED");
    expect(out).toContain("Duplicate function implementation");
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
