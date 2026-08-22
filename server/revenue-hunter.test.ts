import { describe, it, expect, vi } from "vitest";
import {
  huntRevenueOpportunities,
  calculateSaasArbitrage,
  calculateOpportunityRoi,
} from "./revenue-hunter.ts";

// Mock the model layer so tests don't hang waiting for an LLM
vi.mock("./models.ts", () => ({
  runModel: vi.fn().mockResolvedValue("Mocked executive strategy summary."),
}));

// buildDynamicOpportunities() calls the real Yahoo Finance quotes() unconditionally, regardless
// of synthesizeStrategy — this was the actual source of the slowness/flakiness (6+ seconds for
// tests that should be instant): a live network call to a third party on every run, mocking the
// LLM layer alone didn't touch it.
vi.mock("./markets.ts", () => ({
  quotes: vi.fn().mockResolvedValue([
    { symbol: "BTC-USD", ok: true, price: 65000, currency: "USD", prevClose: 64000, change: 1000, changePct: 1.56, exchange: "CCC" },
    { symbol: "ETH-USD", ok: true, price: 3500, currency: "USD", prevClose: 3400, change: 100, changePct: 2.94, exchange: "CCC" },
  ]),
}));

describe("AUTONOMOUS REVENUE & OPPORTUNITY HUNTER", () => {
  it("returns prioritized revenue opportunities with estimated ROI", async () => {
    const rep = await huntRevenueOpportunities({ synthesizeStrategy: false });
    expect(rep.totalOpportunitiesFound).toBeGreaterThanOrEqual(2);
    expect(rep.totalEstimatedValueUSD).toBeGreaterThan(500);
    expect(rep.highestYieldOpportunity).toBeDefined();
    expect(rep.highestYieldOpportunity?.estimatedValueUSD).toBeGreaterThan(0);
    expect(rep.items[0].actionSteps.length).toBeGreaterThan(0);
  });

  it("filters by category correctly", async () => {
    const rep = await huntRevenueOpportunities({ focusCategory: "cost-reduction", synthesizeStrategy: false });
    expect(rep.items.length).toBeGreaterThanOrEqual(1);
    expect(rep.items.every((i) => i.category === "cost-reduction")).toBe(true);
  });

  it("computes SaaS arbitrage annual savings accurately", () => {
    const arb = calculateSaasArbitrage();
    expect(arb.totalMonthlySavingsUsd).toBeGreaterThan(200);
    expect(arb.totalAnnualSavingsUsd).toBeGreaterThan(2000);
    expect(arb.items.length).toBeGreaterThanOrEqual(5);
  });

  it("computes mathematical ROI and payback period with precision", () => {
    const roi = calculateOpportunityRoi(500, 2500, 30);
    expect(roi.netProfitUsd).toBe(2000);
    expect(roi.roiPct).toBe(400);
    expect(roi.annualizedRoiPct).toBeGreaterThan(4000);
    expect(roi.paybackDays).toBe(6);
  });
});
