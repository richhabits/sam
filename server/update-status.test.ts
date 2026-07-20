import { describe, expect, it } from "vitest";
import { friendlyUpdateError, isNewerVer, sourceUpdateStatus } from "./update-status.ts";

describe("isNewerVer", () => {
  it("compares semver parts", () => {
    expect(isNewerVer("2.3.0", "2.2.0")).toBe(true);
    expect(isNewerVer("2.2.1", "2.2.0")).toBe(true);
    expect(isNewerVer("2.2.0", "2.2.0")).toBe(false);
    expect(isNewerVer("2.1.0", "2.2.0")).toBe(false);
  });
});

describe("sourceUpdateStatus", () => {
  it("reports the human version, never a bare SHA, when up to date", () => {
    const s = sourceUpdateStatus("2.2.0", "abc1234def", "abc1234def");
    expect(s.behind).toBe(false);
    expect(s.current).toBe("2.2.0");   // the popover shows "SAM 2.2.0", not the SHA
    expect(s.latest).toBe("2.2.0");
  });

  it("flags behind by SHA and surfaces the short remote SHA as latest", () => {
    const s = sourceUpdateStatus("2.2.0", "aaaaaaa1111", "bbbbbbb2222");
    expect(s.behind).toBe(true);
    expect(s.current).toBe("2.2.0");           // still tells the user what they're on
    expect(s.latest).toBe("bbbbbbb");          // short remote SHA — no newer version number exists
  });

  it("falls back to the short local SHA only when no version is known", () => {
    const s = sourceUpdateStatus("", "abc1234def", "abc1234def");
    expect(s.current).toBe("abc1234");
  });
});

describe("friendlyUpdateError", () => {
  it("turns git's no-tracking wall of text into one actionable sentence", () => {
    // The exact message the update button leaked when the checkout sat on a branch with no upstream.
    const raw = "There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n    git pull <remote> <branch>";
    expect(friendlyUpdateError(raw)).toMatch(/isn't tracking the update branch/);
    expect(friendlyUpdateError(raw)).not.toMatch(/git pull <remote>/);   // no raw git text reaches the user
  });

  it("maps the other known failures and never dumps raw git for them", () => {
    expect(friendlyUpdateError("fatal: not a git repository")).toMatch(/releases page/);
    expect(friendlyUpdateError("Not possible to fast-forward, aborting.")).toMatch(/diverged/);
    expect(friendlyUpdateError("fatal: unable to access ... Could not resolve host: github.com")).toMatch(/internet/);
  });

  it("passes an unknown error through, truncated", () => {
    expect(friendlyUpdateError("some novel git failure")).toBe("some novel git failure");
    expect(friendlyUpdateError("x".repeat(500)).length).toBe(200);
  });
});
