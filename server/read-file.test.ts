import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTool } from "./tools.ts";

describe("read_file tool — line slicing & line numbers", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sam-read-test-"));
    testFile = join(tempDir, "document.txt");
    process.env.VAULT_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.VAULT_DIR;
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("reads a full file when given a string path", async () => {
    writeFileSync(testFile, "Line 1\nLine 2\nLine 3", "utf8");
    const res = await readFileTool(testFile);
    expect(res).toBe("Line 1\nLine 2\nLine 3");
  });

  it("reads a full file when given an object with only path", async () => {
    writeFileSync(testFile, "Line A\nLine B", "utf8");
    const res = await readFileTool({ path: testFile });
    expect(res).toBe("Line A\nLine B");
  });

  it("slices exact line ranges with 1-indexed line numbers", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Content line ${i + 1}`).join("\n");
    writeFileSync(testFile, lines, "utf8");

    const res = await readFileTool({ path: testFile, startLine: 5, endLine: 8 });
    expect(res).toContain("Showing lines 5 to 8 of 20 in");
    expect(res).toContain("5: Content line 5");
    expect(res).toContain("6: Content line 6");
    expect(res).toContain("7: Content line 7");
    expect(res).toContain("8: Content line 8");
    expect(res).not.toContain("4: Content line 4");
    expect(res).not.toContain("9: Content line 9");
  });

  it("omits line numbers when lineNumbers: false is explicitly set", async () => {
    const lines = "One\nTwo\nThree\nFour\nFive";
    writeFileSync(testFile, lines, "utf8");

    const res = await readFileTool({ path: testFile, startLine: 2, endLine: 4, lineNumbers: false });
    expect(res).toContain("Showing lines 2 to 4 of 5 in");
    expect(res).toContain("Two\nThree\nFour");
    expect(res).not.toContain("2: Two");
  });

  it("clamps startLine and endLine when out of bounds", async () => {
    const lines = "First\nSecond\nThird";
    writeFileSync(testFile, lines, "utf8");

    const res = await readFileTool({ path: testFile, startLine: 1, endLine: 100 });
    expect(res).toContain("Showing lines 1 to 3 of 3 in");
    expect(res).toContain("1: First");
    expect(res).toContain("3: Third");
  });

  it("blocks credential paths from unattended read", async () => {
    const envFile = join(tempDir, ".env");
    writeFileSync(envFile, "SECRET_API_KEY=12345", "utf8");

    const res = await readFileTool(envFile);
    expect(res).toContain("Blocked");
    expect(res).toContain("holds credentials");
    expect(res).not.toContain("12345");
  });

  it("handles non-existent files gracefully", async () => {
    const nonExistent = join(tempDir, "missing.txt");
    const res = await readFileTool(nonExistent);
    expect(res).toContain("Could not read");
    expect(res).toContain("missing.txt");
  });
});
