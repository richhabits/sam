import { describe, it, expect } from "vitest";
import { applyEdits } from "./edits.ts";

// The promise: a pinpoint edit changes only the exact span it names, never the rest of the file,
// and refuses (never guesses) anything it cannot place unambiguously.

describe("applyEdits — the exact-unique-match rule", () => {
  const file = `<!doctype html>
<title>Old Title</title>
<h1>Welcome</h1>
<p>hello</p>`;

  it("replaces a passage that occurs exactly once", () => {
    const r = applyEdits(file, [{ find: "<title>Old Title</title>", replace: "<title>New Title</title>" }]);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(1);
    expect(r.content).toContain("<title>New Title</title>");
    expect(r.content).toContain("<h1>Welcome</h1>");   // the rest is untouched — the whole point
    expect(r.content).not.toContain("Old Title");
  });

  it("REFUSES a passage that is not present, changing nothing", () => {
    const r = applyEdits(file, [{ find: "<title>Nonexistent</title>", replace: "x" }]);
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(0);
    expect(r.content).toBe(file);                       // unchanged
    expect(r.failures[0].why).toMatch(/not found/);
  });

  it("REFUSES an ambiguous passage rather than guessing which one", () => {
    const r = applyEdits(file, [{ find: "hello", replace: "hi" }].concat([{ find: "l", replace: "L" }]));
    // "l" appears many times → must be refused, not applied to the first
    const ambiguous = r.failures.find((f) => f.find === "l");
    expect(ambiguous?.why).toMatch(/matches \d+ places/);
  });

  it("refuses an empty target", () => {
    const r = applyEdits(file, [{ find: "", replace: "anything" }]);
    expect(r.ok).toBe(false);
    expect(r.failures[0].why).toMatch(/empty target/);
  });

  it("applies several edits in order, each against the running result", () => {
    const r = applyEdits(file, [
      { find: "Old Title", replace: "Mid Title" },
      { find: "Mid Title", replace: "Final Title" },   // sees the previous edit's output
      { find: "<p>hello</p>", replace: "<p>hi there</p>" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(3);
    expect(r.content).toContain("Final Title");
    expect(r.content).toContain("hi there");
  });

  it("treats the replacement literally — $ is not a special pattern", () => {
    const r = applyEdits("const price = AMOUNT;", [{ find: "AMOUNT", replace: "`$${n}`" }]);
    expect(r.ok).toBe(true);
    expect(r.content).toBe("const price = `$${n}`;");   // $$ / ${} survive verbatim
  });

  it("can delete a passage (empty replacement)", () => {
    const r = applyEdits(file, [{ find: "<p>hello</p>", replace: "" }]);
    expect(r.ok).toBe(true);
    expect(r.content).not.toContain("<p>hello</p>");
    expect(r.content).toContain("<h1>Welcome</h1>");
  });

  it("reports each failure with its index, and one bad block does not stop ok from being false", () => {
    const r = applyEdits(file, [
      { find: "<h1>Welcome</h1>", replace: "<h1>Hi</h1>" },   // fine
      { find: "not-in-file", replace: "x" },                  // fails
    ]);
    expect(r.ok).toBe(false);                                 // any failure ⇒ not ok
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].index).toBe(1);
  });

  it("does nothing to a file when given no edits", () => {
    const r = applyEdits(file, []);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(0);
    expect(r.content).toBe(file);
  });
});
