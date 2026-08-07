import { describe, it, expect } from "vitest";
import { diffFiles, hunksBetween, summariseDiff, summariseAll, renderDiff, MAX_DIFF_LINES } from "./diff.ts";

describe("finding what changed", () => {
  it("sees nothing when nothing changed", () => {
    expect(hunksBetween("a\nb\nc", "a\nb\nc")).toEqual([]);
  });

  it("collects a run of changes into one hunk, not one per line", () => {
    const h = hunksBetween("a\nb\nc\nd", "a\nX\nY\nd");
    expect(h).toHaveLength(1);
    expect(h[0].removed).toEqual(["b", "c"]);
    expect(h[0].added).toEqual(["X", "Y"]);
  });

  it("keeps separate changes separate", () => {
    const h = hunksBetween("a\nb\nc\nd\ne", "X\nb\nc\nd\nY");
    expect(h).toHaveLength(2);
  });

  it("handles a pure insertion and a pure deletion", () => {
    expect(hunksBetween("a\nc", "a\nb\nc")[0].added).toEqual(["b"]);
    expect(hunksBetween("a\nb\nc", "a\nc")[0].removed).toEqual(["b"]);
  });
});

describe("the diff for one file", () => {
  it("calls a file that did not exist added, and keeps before as null so it can be undone", () => {
    const d = diffFiles("index.html", null, "<h1>hi</h1>");
    expect(d.kind).toBe("added");
    expect(d.before).toBeNull();
    expect(d.addedLines).toBe(1);
  });

  it("distinguishes added from modified-from-empty", () => {
    expect(diffFiles("a.txt", null, "x").kind).toBe("added");
    expect(diffFiles("a.txt", "", "x").kind).toBe("modified");
  });

  it("keeps the previous bytes so the change can be reverted", () => {
    const d = diffFiles("a.txt", "old", "new");
    expect(d.before).toBe("old");
  });

  it("counts both directions", () => {
    const d = diffFiles("a.txt", "a\nb\nc", "a\nX");
    expect(d.addedLines).toBe(1);
    expect(d.removedLines).toBe(2);
  });

  it("refuses to diff something too large to read, and says so rather than hanging", () => {
    const big = new Array(MAX_DIFF_LINES + 10).fill("line").join("\n");
    const d = diffFiles("big.txt", big, `${big}\nmore`);
    expect(d.truncated).toBe(true);
    expect(d.hunks).toEqual([]);
    expect(summariseDiff(d)).toContain("too large");
  });
});

describe("saying what happened", () => {
  it("summarises one file", () => {
    expect(summariseDiff(diffFiles("a.txt", "a\nb", "a\nX"))).toBe("a.txt — +1 −1");
    expect(summariseDiff(diffFiles("n.txt", null, "x\ny"))).toContain("new, 2 lines");
  });

  it("summarises a batch", () => {
    const diffs = [diffFiles("a.txt", "a", "b"), diffFiles("c.txt", null, "x\ny")];
    expect(summariseAll(diffs)).toBe("2 files · +3 −1");
    expect(summariseAll([])).toBe("nothing changed");
  });

  it("renders something a person can read", () => {
    const out = renderDiff(diffFiles("a.txt", "a\nb", "a\nX"));
    expect(out).toContain("--- a.txt");
    expect(out).toContain("- b");
    expect(out).toContain("+ X");
  });
});
