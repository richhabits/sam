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

  // AUDIT FIX: grep_search shipped safe:true (auto-runs, no approval, ever) with zero
  // credential-path awareness — confirmed exploitable against the real filesystem before this
  // was added: grepSearchTool({ path: "~/.ssh" }) returned real content out of known_hosts with
  // no bypass needed, just pointing `path` at the directory. read_file and run_safe_command both
  // already refuse credential paths; this is the same protection, extended here.
  describe("credential safety — must never surface secrets, even with no approval gate", () => {
    it("refuses outright when the search root itself is a credential path", async () => {
      const res = await grepSearchTool({ query: "anything", path: "~/.ssh" });
      expect(res).toContain("Blocked");
      expect(res).toContain("credentials");
    });

    it("scrubs an individual credential-file match even inside an otherwise legitimate search", async () => {
      // A dotfile like .env is skipped by ripgrep's own default hidden-file filter before the
      // scrub logic ever runs — proves the overall result is safe, but not that THIS fix is
      // what's doing it. server.pem isn't hidden, so it's genuinely found by the search
      // backend, which is what actually exercises scrubCredentialMatches().
      writeFileSync(join(tempDir, "server.pem"), "API_SECRET=sk-shouldnotleak12345\n", "utf8");
      writeFileSync(join(tempDir, "normal.ts"), "const API_SECRET_LABEL = 'placeholder';\n", "utf8");

      const res = await grepSearchTool({ query: "API_SECRET", path: tempDir });

      expect(res).not.toContain("sk-shouldnotleak12345");
      expect(res).not.toContain("server.pem:");
      expect(res).toContain("normal.ts");
      expect(res).toContain("withheld");
    });
  });
});
