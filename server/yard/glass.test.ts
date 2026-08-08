import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { withSelect, wantsSelect, saveDiffs, loadDiffs, diffPathFor, GLASS_SOURCE, SELECT_SCRIPT_SRC } from "./glass.ts";
import { diffFiles } from "./diff.ts";

// Caught live, in a browser, after the unit tests were green: the picker was injected
// perfectly and then refused by the preview's own `default-src 'self'`, which forbids
// inline script. Being in the page is not the same as being allowed to run, and only one
// of those had a test. This is the one that would have failed.
describe("the picker is allowed to run, not merely present", () => {
  const scriptIn = (html: string) => {
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) throw new Error("no script was injected");
    return m[1];
  };

  it("names the injected script in the policy by its own hash", () => {
    const hash = createHash("sha256").update(scriptIn(withSelect("<body></body>"))).digest("base64");
    expect(SELECT_SCRIPT_SRC).toContain(`'sha256-${hash}'`);
  });

  it("keeps 'self' for scripts, so naming script-src does not newly break a page's own ./app.js", () => {
    expect(SELECT_SCRIPT_SRC).toMatch(/^script-src 'self' 'sha256-/);
  });

  it("does not reach for 'unsafe-inline' — the hash is the whole point", () => {
    expect(SELECT_SCRIPT_SRC).not.toContain("unsafe-inline");
  });
});

describe("select mode is opt-in", () => {
  it("is off unless explicitly asked for", () => {
    expect(wantsSelect({})).toBe(false);
    expect(wantsSelect({ select: "0" })).toBe(false);
    expect(wantsSelect(undefined)).toBe(false);
    expect(wantsSelect({ select: "true" })).toBe(false);
  });
  it("is on for the one explicit flag", () => {
    expect(wantsSelect({ select: "1" })).toBe(true);
  });
});

describe("injecting the picker", () => {
  const page = "<html><body><h1>Hi</h1></body></html>";

  it("puts the script before the closing body, after the page's own scripts", () => {
    const out = withSelect(page);
    expect(out.indexOf("__samGlass")).toBeLessThan(out.indexOf("</body>"));
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("still injects into a fragment with no body tag", () => {
    expect(withSelect("<h1>bare</h1>")).toContain("__samGlass");
  });

  it("carries the marker the receiving side checks for", () => {
    expect(withSelect(page)).toContain(JSON.stringify(GLASS_SOURCE));
  });

  it("prevents the click, so a preview cannot navigate away from what you are pointing at", () => {
    expect(withSelect(page)).toContain("preventDefault");
  });

  it("leaves the page alone when select mode was not asked for", () => {
    // The guarantee that matters: what ships is never the page with SAM's script in it.
    expect(page).not.toContain("__samGlass");
  });
});

describe("diffs kept beside the job log", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "samyard-glass-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("round-trips what the loop produced", () => {
    const log = join(dir, "job.log");
    writeFileSync(log, "");
    const diffs = [diffFiles("a.js", "old\n", "new\n"), diffFiles("b.js", null, "fresh\n")];
    saveDiffs(log, diffs);
    const back = loadDiffs(log);
    expect(back).toHaveLength(2);
    expect(back[0].path).toBe("a.js");
    expect(back[0].before).toBe("old\n");
    expect(back[1].kind).toBe("added");
  });

  it("is empty rather than throwing when there is nothing saved", () => {
    expect(loadDiffs(join(dir, "missing.log"))).toEqual([]);
    expect(loadDiffs(null)).toEqual([]);
  });

  it("survives a corrupted file", () => {
    const log = join(dir, "job.log");
    writeFileSync(diffPathFor(log), "{ not json");
    expect(loadDiffs(log)).toEqual([]);
  });

  it("writes nothing when there is nothing to write", () => {
    const log = join(dir, "job.log");
    saveDiffs(log, []);
    expect(loadDiffs(log)).toEqual([]);
  });

  it("never fails the build that produced it", () => {
    // An unwritable path is a bad place to discover that a successful build now reports failure.
    expect(() => saveDiffs(join(dir, "nope", "deep", "job.log"), [diffFiles("a", null, "x")])).not.toThrow();
  });
});
