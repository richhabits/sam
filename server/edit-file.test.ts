import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editFileTool } from "./tools.ts";

describe("edit_file tool — precision block replacement", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sam-edit-test-"));
    testFile = join(tempDir, "sample.ts");
    process.env.VAULT_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.VAULT_DIR;
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("replaces an exact target string in a file", async () => {
    const initial = `function add(a: number, b: number) {\n  return a + b;\n}\n`;
    writeFileSync(testFile, initial, "utf8");

    const res = await editFileTool({
      path: testFile,
      target: "return a + b;",
      replacement: "const sum = a + b;\n  return sum;",
    });

    expect(res).toContain("Edited");
    expect(res).toContain("1 replacement");
    const updated = readFileSync(testFile, "utf8");
    expect(updated).toBe(`function add(a: number, b: number) {\n  const sum = a + b;\n  return sum;\n}\n`);
  });

  it("preserves exact indentation and multiline formatting", async () => {
    const initial = `class Worker {\n    constructor() {\n        this.id = 1;\n    }\n}`;
    writeFileSync(testFile, initial, "utf8");

    const target = `    constructor() {\n        this.id = 1;\n    }`;
    const replacement = `    constructor(id: number) {\n        this.id = id;\n    }`;

    const res = await editFileTool({ path: testFile, target, replacement });
    expect(res).toContain("Edited");
    const updated = readFileSync(testFile, "utf8");
    expect(updated).toBe(`class Worker {\n    constructor(id: number) {\n        this.id = id;\n    }\n}`);
  });

  it("rejects when target string does not exist in the file", async () => {
    const initial = `const greeting = "hello";\n`;
    writeFileSync(testFile, initial, "utf8");

    const res = await editFileTool({
      path: testFile,
      target: `const greeting = "goodbye";`,
      replacement: `const greeting = "world";`,
    });

    expect(res).toContain("Target content not found");
    const content = readFileSync(testFile, "utf8");
    expect(content).toBe(initial); // Unchanged
  });

  it("rejects when target occurs multiple times without allowMultiple: true", async () => {
    const initial = `const x = 10;\nconst y = 10;\nconst z = 10;\n`;
    writeFileSync(testFile, initial, "utf8");

    const res = await editFileTool({
      path: testFile,
      target: "const",
      replacement: "let",
    });

    expect(res).toContain("Target content found 3 times");
    expect(res).toContain("allowMultiple: true");
    const content = readFileSync(testFile, "utf8");
    expect(content).toBe(initial); // Unchanged
  });

  it("replaces all occurrences when allowMultiple: true is set", async () => {
    const initial = `const a = 1;\nconst b = 2;\nconst c = 3;\n`;
    writeFileSync(testFile, initial, "utf8");

    const res = await editFileTool({
      path: testFile,
      target: "const",
      replacement: "let",
      allowMultiple: true,
    });

    expect(res).toContain("Edited");
    expect(res).toContain("3 replacements");
    const updated = readFileSync(testFile, "utf8");
    expect(updated).toBe(`let a = 1;\nlet b = 2;\nlet c = 3;\n`);
  });

  it("deletes text when replacement is empty string", async () => {
    const initial = `import { unused } from "lib";\nimport { used } from "lib";\n`;
    writeFileSync(testFile, initial, "utf8");

    const res = await editFileTool({
      path: testFile,
      target: `import { unused } from "lib";\n`,
      replacement: "",
    });

    expect(res).toContain("Edited");
    const updated = readFileSync(testFile, "utf8");
    expect(updated).toBe(`import { used } from "lib";\n`);
  });

  it("rejects when target is empty string", async () => {
    writeFileSync(testFile, "hello", "utf8");
    const res = await editFileTool({
      path: testFile,
      target: "",
      replacement: "test",
    });
    expect(res).toContain("target content cannot be empty");
  });

  it("rejects when file does not exist", async () => {
    const nonExistent = join(tempDir, "does_not_exist.ts");
    const res = await editFileTool({
      path: nonExistent,
      target: "foo",
      replacement: "bar",
    });
    expect(res).toContain("file does not exist");
  });
});
