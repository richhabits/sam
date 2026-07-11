import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/tmp/sam-analytics-test";
let A: typeof import("./analytics.ts");
beforeAll(async () => { process.env.VAULT_DIR = SCRATCH; rmSync(SCRATCH, { recursive: true, force: true }); A = await import("./analytics.ts"); });
beforeEach(() => A.resetAnalytics());

describe("local analytics (on-device usage)", () => {
  it("records tasks, tools, activation, and active days without any content", () => {
    A.recordTask("2026-07-04T10:00:00.000Z");
    A.recordTool("web_search", "2026-07-04T10:01:00.000Z");
    A.recordTool("web_search", "2026-07-05T10:00:00.000Z");
    A.recordWorkflowRun("2026-07-05T10:05:00.000Z");
    const a = A.getAnalytics();
    expect(a.tasks).toBe(1);
    expect(a.toolUses.web_search).toBe(2);
    expect(a.workflowRuns).toBe(1);
    expect(a.activatedAt).toBe("2026-07-04T10:00:00.000Z");
    expect(a.activeDays).toEqual(["2026-07-04", "2026-07-05"]);
  });

  it("summary reports retention + is honest that 0 data left the device", () => {
    A.recordTask("2026-07-04T10:00:00.000Z");
    const s = A.analyticsSummary("2026-07-11T10:00:00.000Z");
    expect(s.retentionDays).toBe(8);          // 04 → 11 inclusive
    expect(s.activated).toBe(true);
    expect(s.dataLeftDevice).toBe(0);
    expect(s.hoursSaved).toBeGreaterThanOrEqual(0);
  });
});
