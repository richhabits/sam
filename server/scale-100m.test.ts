import { describe, it, expect } from "vitest";
import { generate100MStrategy } from "./scale-100m.ts";

describe("S.A.M. £100M BUSINESS SCALE-UP ENGINE", () => {
  it("generates triangulated strategy across Elon Musk, Apple, and Trump archetypes", () => {
    const strategy = generate100MStrategy();
    expect(strategy.valuationTargetGBP).toBe(100_000_000);
    expect(strategy.pillars.length).toBe(3);

    const elon = strategy.pillars.find((p) => p.archetype === "ELON_MUSK");
    expect(elon).toBeDefined();
    expect(elon?.name).toContain("First-Principles");

    const apple = strategy.pillars.find((p) => p.archetype === "APPLE");
    expect(apple).toBeDefined();
    expect(apple?.name).toContain("Luxury");

    const trump = strategy.pillars.find((p) => p.archetype === "TRUMP");
    expect(trump).toBeDefined();
    expect(trump?.name).toContain("Commercial");
  });

  it("contains clear milestone roadmap toward £1M, £10M, and £100M", () => {
    const strategy = generate100MStrategy();
    expect(strategy.roadmap.length).toBe(3);
    expect(strategy.roadmap.map((r) => r.level)).toEqual(["£1M ARR", "£10M ARR", "£100M VALUATION"]);
    expect(strategy.revenueEngines.length).toBeGreaterThan(0);
    expect(strategy.growthDirectives.length).toBeGreaterThan(0);
  });
});
