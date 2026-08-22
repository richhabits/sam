import { describe, it, expect } from "vitest";
import { getScaleStatus } from "./scale-100m.ts";

describe("S.A.M. Scale Status (Ground Truth)", () => {
  it("reports zero revenue, zero customers, zero trades — because that is the truth", () => {
    const status = getScaleStatus();
    expect(status.actual.revenueTotalGBP).toBe(0);
    expect(status.actual.payingCustomers).toBe(0);
    expect(status.actual.liveTradesExecuted).toBe(0);
    expect(status.actual.tradingPnlGBP).toBe(0);
  });

  it("reports real cost savings from the ledger (may be zero or small)", () => {
    const status = getScaleStatus();
    expect(typeof status.actual.costSavings.dollarsSaved).toBe("number");
    expect(typeof status.actual.costSavings.totalRequests).toBe("number");
  });

  it("reads codebase inventory from the filesystem, not hardcoded", () => {
    const status = getScaleStatus();
    // These are read from disk — in the test env they should be > 0
    // because the server/ directory exists with real .ts files
    expect(status.codebaseInventory.serverModules).toBeGreaterThan(0);
    expect(status.codebaseInventory.testFiles).toBeGreaterThan(0);
    expect(typeof status.codebaseInventory.skillsLinked).toBe("number");
    expect(typeof status.codebaseInventory.knowledgeGraphNodes).toBe("number");
  });

  it("labels all targets as aspirations with zero actual progress", () => {
    const status = getScaleStatus();
    expect(status.targets.length).toBe(3);
    for (const target of status.targets) {
      expect(target.actualGBP).toBe(0);
      expect(target.note).toBeTruthy();
      expect(
        target.note.toLowerCase().includes("aspiration") ||
        target.note.toLowerCase().includes("no ")
      ).toBe(true);
    }
  });
});
