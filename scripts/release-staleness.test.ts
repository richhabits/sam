import { describe, it, expect } from "vitest";
import { isStale, computeStaleness } from "./release-staleness.mjs";

describe("isStale", () => {
  it("is stale past both thresholds (the synthetic incident case: 14 days, 200+ commits)", () => {
    expect(isStale(14, 267)).toBe(true);
  });
  it("is NOT stale the day a release is cut (0 days, 0 commits)", () => {
    expect(isStale(0, 0)).toBe(false);
  });
  it("needs BOTH thresholds crossed, not either alone", () => {
    expect(isStale(30, 1)).toBe(false);   // old tag, but nothing user-visible landed since
    expect(isStale(1, 50)).toBe(false);   // busy day, but not old enough to nag about yet
  });
  it("is stale right at the boundary (>=, not >)", () => {
    expect(isStale(7, 5)).toBe(true);
  });
});

describe("computeStaleness", () => {
  it("filters non-user-facing commits from the count, using an injected git", () => {
    const fakeGit = (cmd: string) => {
      if (cmd.includes("describe")) return "v9.9.9";
      if (cmd.includes("log -1 --format=%ct")) return String(Math.floor(Date.now() / 1000) - 10 * 86400); // 10 days ago
      if (cmd.includes("log v9.9.9..HEAD")) {
        return ["feat(mobile): real user-facing thing", "chore: sync stats", "docs: readme", "fix(security): real fix"].join("\n");
      }
      throw new Error(`unexpected: ${cmd}`);
    };
    const r = computeStaleness(fakeGit);
    expect(r).toEqual({ tag: "v9.9.9", days: 10, totalCommits: 4, userVisibleCommits: 2, stale: false });
  });
});
