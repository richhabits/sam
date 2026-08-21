import { describe, it, expect } from "vitest";
import {
  huntRevenueOpportunities,
  calculateSaasArbitrage,
  calculateOpportunityRoi,
} from "./revenue-hunter.ts";

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
