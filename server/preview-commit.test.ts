import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commit, pendingCommit, preview, recover } from "./preview-commit.ts";

// Preview shows a batch before it lands; Commit enacts it under the Latch, journalled — convergent
// (re-committing an applied plan is a no-op) and all-or-nothing (a failed write rolls back the steps
// already done; a crash-interrupted journal is recovered the same way).

let dir = "";
const read = (name: string) => { try { return readFileSync(join(dir, name), "utf8"); } catch { return null; } };
const p = (name: string) => join(dir, name);

beforeEach(() => {
  dir = join(tmpdir(), `sam-pc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.VAULT_DIR = join(dir, "vault");
});
afterEach(() => { delete process.env.VAULT_DIR; try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });

describe("preview — read-only", () => {
  it("classifies create / modify / unchanged and touches nothing", () => {
    writeFileSync(p("keep.txt"), "same");
    writeFileSync(p("edit.txt"), "old\nline");
    const plan = preview([
      { kind: "write", path: p("new.txt"), after: "hello" },
      { kind: "write", path: p("edit.txt"), after: "new\nline" },
      { kind: "write", path: p("keep.txt"), after: "same" },
    ]);
    expect(plan.summary).toEqual({ creates: 1, modifies: 1, unchanged: 1 });
    const edit = plan.changes.find((c) => c.path.endsWith("edit.txt"))!;
    expect(edit.action).toBe("modify");
    expect(edit.addedLines).toBe(1); // "new" added
    expect(edit.removedLines).toBe(1); // "old" removed
    expect(read("new.txt")).toBeNull(); // preview wrote nothing
  });
});

describe("commit — enact", () => {
  it("applies the batch and clears the journal", () => {
    const plan = preview([{ kind: "write", path: p("a.txt"), after: "A" }, { kind: "write", path: p("b.txt"), after: "B" }]);
    const r = commit(plan);
    expect(r.ok).toBe(true);
    expect(r.applied).toHaveLength(2);
    expect(read("a.txt")).toBe("A");
    expect(read("b.txt")).toBe("B");
    expect(pendingCommit()).toBe(false); // journal cleared on success
  });

  it("is CONVERGENT: re-committing an already-applied plan is a no-op", () => {
    const plan = preview([{ kind: "write", path: p("c.txt"), after: "C" }]);
    commit(plan);
    const again = commit(plan);        // same plan, file already == after
    expect(again.ok).toBe(true);
    expect(again.applied).toEqual([]); // nothing re-written
  });
});

describe("commit — all-or-nothing", () => {
  it("rolls back the steps already done when a later write fails", () => {
    writeFileSync(p("first.txt"), "ORIGINAL");
    mkdirSync(p("blocked"));            // a directory — writing a file to this path throws
    const plan = preview([
      { kind: "write", path: p("first.txt"), after: "CHANGED" },
      { kind: "write", path: p("blocked"), after: "boom" }, // this write fails
    ]);
    const r = commit(plan);
    expect(r.ok).toBe(false);
    expect(r.rolledBack).toContain(p("first.txt"));
    expect(read("first.txt")).toBe("ORIGINAL"); // restored — the batch never lands half-applied
    expect(pendingCommit()).toBe(false);
  });
});

describe("recover — after a crash", () => {
  it("rolls back an interrupted commit's applied steps to their before-state", () => {
    // Simulate: a commit applied one step, then the process died leaving the journal behind.
    writeFileSync(p("doc.txt"), "APPLIED-BY-DEAD-COMMIT");
    mkdirSync(process.env.VAULT_DIR!, { recursive: true });
    writeFileSync(join(process.env.VAULT_DIR!, "preview-commit.journal.json"), JSON.stringify({
      at: "2026-07-19T00:00:00.000Z",
      steps: [{ path: p("doc.txt"), before: "ORIGINAL", after: "APPLIED-BY-DEAD-COMMIT", status: "done" }],
    }));
    expect(pendingCommit()).toBe(true);
    const r = recover();
    expect(r.rolledBack).toContain(p("doc.txt"));
    expect(read("doc.txt")).toBe("ORIGINAL"); // rolled back
    expect(pendingCommit()).toBe(false);       // journal cleared
  });

  it("recover with no journal is a clean no-op", () => {
    expect(recover()).toEqual({ rolledBack: [] });
  });
});
