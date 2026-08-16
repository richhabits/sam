import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grepSearchTool } from "./tools.ts";

describe("grep_search tool — fast codebase search", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sam-grep-test-"));
    process.env.VAULT_DIR = tempDir;

    // Create a few files to search in
    writeFileSync(join(tempDir, "alpha.ts"), `export const ALPHA_FLAG = "enabled";\nconst helper = () => true;\n`, "utf8");
    writeFileSync(join(tempDir, "beta.ts"), `import { ALPHA_FLAG } from "./alpha";\nexport function betaRunner() {\n  return ALPHA_FLAG;\n}\n`, "utf8");
    writeFileSync(join(tempDir, "gamma.txt"), `Some plain text with alpha in lowercase.\n`, "utf8");
  });

  afterEach(() => {
    delete process.env.VAULT_DIR;
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("finds matches and outputs file:line: content format", async () => {
    const res = await grepSearchTool({
      query: "betaRunner",
      path: tempDir,
    });

    expect(res).toContain("Found");
    expect(res).toContain("beta.ts:2:");
    expect(res).toContain("export function betaRunner()");
  });

  it("performs case-insensitive search by default", async () => {
    const res = await grepSearchTool({
      query: "ALPHA",
      path: tempDir,
    });

    expect(res).toContain("Found");
    expect(res).toContain("alpha.ts");
    expect(res).toContain("beta.ts");
    expect(res).toContain("gamma.txt");
  });

  it("respects caseInsensitive: false", async () => {
    const res = await grepSearchTool({
      query: "ALPHA_FLAG",
      path: tempDir,
      caseInsensitive: false,
    });

    expect(res).toContain("alpha.ts");
    expect(res).toContain("beta.ts");
    expect(res).not.toContain("gamma.txt"); // gamma has "alpha" in lowercase
  });

  it("supports regular expression search with isRegex: true", async () => {
    const res = await grepSearchTool({
      query: "export (const|function)",
      path: tempDir,
      isRegex: true,
    });

    expect(res).toContain("alpha.ts");
    expect(res).toContain("beta.ts");
  });

  it("caps matches at maxResults", async () => {
    const res = await grepSearchTool({
      query: "a",
      path: tempDir,
      maxResults: 2,
    });

    expect(res).toContain("Found");
    // Should show matches capped at 2
    const matchLines = res.split("\n").filter((l) => l.includes(".ts:") || l.includes(".txt:"));
    expect(matchLines.length).toBeLessThanOrEqual(2);
  });

  it("returns clean message when no matches are found", async () => {
    const res = await grepSearchTool({
      query: "NONEXISTENT_SYMBOL_XYZ_12345",
      path: tempDir,
    });

    expect(res).toContain("No matches found");
  });

  it("prompts for query when empty", async () => {
    const res = await grepSearchTool({
      query: "",
      path: tempDir,
    });

    expect(res).toContain("Please provide a query");
  });
});
