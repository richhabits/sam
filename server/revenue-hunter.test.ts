import { describe, it, expect } from "vitest";
import { huntRevenueOpportunities } from "./revenue-hunter.ts";

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
});
