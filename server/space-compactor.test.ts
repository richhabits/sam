import { describe, it, expect } from "vitest";
import { auditSpaceConsumption, compactSpaceAndMemory } from "./space-compactor.ts";
import { spaceConsumptionOptimizerTool } from "./tools.ts";

describe("Autonomous Storage & Memory Compactor", () => {
  it("audits heap memory and cache consumption", () => {
    const report = auditSpaceConsumption();
    expect(report.heapUsedMb).toBeGreaterThan(0);
    expect(report.heapTotalMb).toBeGreaterThan(0);
    expect(report.rssMb).toBeGreaterThan(0);
    expect(["OPTIMAL", "COMPACT_RECOMMENDED"]).toContain(report.status);
  });

  it("compacts memory and reports freed cache entries", () => {
    const res = compactSpaceAndMemory();
    expect(res.status).toBe("COMPACTED");
    expect(res.currentHeapUsedMb).toBeGreaterThan(0);
    expect(res.durationMs).toBeGreaterThanOrEqual(1);
  });

  it("spaceConsumptionOptimizerTool formats audit and compact reports", async () => {
    const audit = await spaceConsumptionOptimizerTool({ mode: "audit" });
    expect(audit).toContain("Memory & Storage Consumption Audit");

    const compact = await spaceConsumptionOptimizerTool({ mode: "compact" });
    expect(compact).toContain("Space & Memory Compaction Completed");
  });
});
