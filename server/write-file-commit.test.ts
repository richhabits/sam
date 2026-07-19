import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOOLS } from "./tools.ts";

// write_file routed through Preview → Commit (SAM_PREVIEW_COMMIT=1): the confirm card shows the real
// create/modify diff, the write is journalled + convergent (re-writing identical content is a no-op),
// and a commit that fails surfaces LOUDLY. With the flag off, the plain overwrite path is unchanged.
// Absolute temp paths throughout — safePath() only expands a leading ~, so it never leaves this dir.

const tool = TOOLS.find((t) => t.name === "write_file")!;
let dir = "";
const p = (rel: string) => join(dir, rel);
const read = (rel: string) => { try { return readFileSync(join(dir, rel), "utf8"); } catch { return null; } };

beforeEach(() => {
  dir = join(tmpdir(), `sam-wf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.VAULT_DIR = join(dir, "vault");   // the Preview → Commit journal lives here
});
afterEach(() => {
  delete process.env.SAM_PREVIEW_COMMIT;
  delete process.env.VAULT_DIR;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("write_file — Preview → Commit ON", () => {
  beforeEach(() => { process.env.SAM_PREVIEW_COMMIT = "1"; });

  it("card shows a create diff; run writes the file (and its parent dir) and reports the action", async () => {
    const input = { path: p("notes/new.md"), content: "hello\nworld\n" };
    expect(tool.preview!(input)).toMatch(/Create .*new\.md · \+2\/-0/);
    const msg = await tool.run(input);
    expect(read("notes/new.md")).toBe("hello\nworld\n");       // parent dir was created too
    expect(msg).toMatch(/create/);
    expect(msg).toContain("journalled");
  });

  it("is CONVERGENT: re-writing identical content writes nothing", async () => {
    const input = { path: p("a.txt"), content: "same" };
    await tool.run(input);
    const again = await tool.run(input);
    expect(again).toMatch(/already holds that exact content/);
  });

  it("shows a modify diff with the line delta on an existing file", async () => {
    writeFileSync(p("edit.txt"), "one\ntwo\n");
    const input = { path: p("edit.txt"), content: "one\nTWO\nthree\n" };
    expect(tool.preview!(input)).toMatch(/Modify .*edit\.txt · \+2\/-1/);
    await tool.run(input);
    expect(read("edit.txt")).toBe("one\nTWO\nthree\n");
  });

  it("a failed write surfaces LOUDLY, never a phantom success", async () => {
    mkdirSync(p("blocked"));            // a directory — writing a file to this path throws
    const msg = await tool.run({ path: p("blocked"), content: "boom" });
    expect(msg).toMatch(/Could not write/);
  });
});

describe("write_file — Preview → Commit OFF (default)", () => {
  it("uses the plain overwrite path and the byte-count card", async () => {
    const input = { path: p("plain.txt"), content: "12345" };
    expect(tool.preview!(input)).toBe(`Write to ${p("plain.txt")} (5 chars)`);
    const msg = await tool.run(input);
    expect(read("plain.txt")).toBe("12345");
    expect(msg).toBe(`Wrote 5 chars to ${p("plain.txt")}`);
    expect(msg).not.toContain("journalled");
  });
});
