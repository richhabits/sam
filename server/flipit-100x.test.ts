import { describe, it, expect } from "vitest";
import {
  monteCarlo100x,
  analyzeMultiStrategy,
  project100xLadder,
} from "./flipit.ts";
import {
  flipitMonteCarloTool,
  flipitMultiStrategyTool,
  flipitLadderProjectionsTool,
} from "./tools.ts";

describe("FlipIt 100x Quantitative Engine", () => {
  describe("monteCarlo100x", () => {
    it("simulates up to 100,000 paths with quantile monotonicity and risk metrics", () => {
      const res = monteCarlo100x({
        initialCapital: 100,
        mu: 0.001,
        sigma: 0.015,
        days: 30,
        paths: 20_000,
        ruinThreshold: 0.5,
      });

      expect(res.paths).toBe(20_000);
      expect(res.days).toBe(30);
      expect(res.medianFinalEquity).toBeGreaterThan(0);

      // Quantile monotonicity: p1 <= p5 <= p10 <= p25 <= p50 <= p75 <= p90 <= p95 <= p99
      const q = res.quantiles;
      expect(q.p1).toBeLessThanOrEqual(q.p5);
      expect(q.p5).toBeLessThanOrEqual(q.p10);
      expect(q.p10).toBeLessThanOrEqual(q.p25);
      expect(q.p25).toBeLessThanOrEqual(q.p50);
      expect(q.p50).toBeLessThanOrEqual(q.p75);
      expect(q.p75).toBeLessThanOrEqual(q.p90);
      expect(q.p90).toBeLessThanOrEqual(q.p95);
      expect(q.p95).toBeLessThanOrEqual(q.p99);

      // Risk metrics sanity
      expect(res.var95).toBeGreaterThanOrEqual(0);
      expect(res.var99).toBeGreaterThanOrEqual(res.var95);
      expect(res.cvar95).toBeGreaterThanOrEqual(res.var95);
      expect(res.cvar99).toBeGreaterThanOrEqual(res.var99);

      expect(res.maxDrawdownMean).toBeGreaterThan(0);
      expect(res.maxDrawdownP95).toBeGreaterThanOrEqual(res.maxDrawdownMean);
      expect(res.ruinProbability).toBeGreaterThanOrEqual(0);
      expect(res.ruinProbability).toBeLessThanOrEqual(1.0);
    });

    it("caps paths at 100,000 safely", () => {
      const res = monteCarlo100x({
        mu: 0.0005,
        sigma: 0.01,
        paths: 150_000,
      });
      expect(res.paths).toBe(100_000);
    });
  });

  describe("analyzeMultiStrategy", () => {
    it("allocates risk-parity weights that sum to 1.0 and calculates diversification benefit", () => {
      const assets = [
        { id: "s1", name: "Strategy Low Vol", expectedDailyReturn: 0.0008, dailyVolatility: 0.008 },
        { id: "s2", name: "Strategy Mid Vol", expectedDailyReturn: 0.0012, dailyVolatility: 0.014 },
        { id: "s3", name: "Strategy High Vol", expectedDailyReturn: 0.0018, dailyVolatility: 0.022 },
      ];

      const res = analyzeMultiStrategy(assets, { targetDailyVol: 0.01, assumedCorrelation: 0.2 });

      expect(res.assets.length).toBe(3);
      const totalWeight = res.assets.reduce((sum, a) => sum + a.riskParityWeight, 0);
      expect(totalWeight).toBeCloseTo(1.0, 6);

      // Lower volatility strategy gets higher risk parity weight
      expect(res.assets[0].riskParityWeight).toBeGreaterThan(res.assets[1].riskParityWeight);
      expect(res.assets[1].riskParityWeight).toBeGreaterThan(res.assets[2].riskParityWeight);

      // Diversification ratio should be > 1.0 when correlation < 1.0
      expect(res.diversificationRatio).toBeGreaterThan(1.0);
      expect(res.volatilityScaleFactor).toBeGreaterThan(0);
    });
  });

  describe("project100xLadder", () => {
    it("projects 100 rungs with positive Kelly fractions and exponential milestone velocity", () => {
      const res = project100xLadder(5.0, {
        mu: 0.002,
        sigma: 0.015,
        totalRungs: 100,
      });

      expect(res.currentEquity).toBe(5.0);
      expect(res.totalRungs).toBe(100);
      expect(res.rungs.length).toBe(100);

      // Rungs monotonically increase
      for (let i = 1; i < res.rungs.length; i++) {
        expect(res.rungs[i].targetEquity).toBeGreaterThan(res.rungs[i - 1].targetEquity);
        expect(res.rungs[i].estimatedDaysToReach).toBeGreaterThanOrEqual(res.rungs[i - 1].estimatedDaysToReach);
      }

      // Kelly fraction is positive
      expect(res.optimalKellyFraction).toBeGreaterThan(0);
      expect(res.optimalKellyFraction).toBeLessThanOrEqual(1.0);

      // Milestones ordered: 10x < 50x < 100x days
      expect(res.milestones.tenXDays).toBeLessThan(res.milestones.fiftyXDays);
      expect(res.milestones.fiftyXDays).toBeLessThan(res.milestones.hundredXDays);
    });
  });

  describe("FlipIt Tools in TOOLS", () => {
    it("runs flipitMonteCarloTool formatting", async () => {
      const out = await flipitMonteCarloTool({ paths: 1000, days: 20 });
      expect(out).toContain("FlipIt 100x Monte Carlo Simulation");
      expect(out).toContain("Mean Final Equity");
      expect(out).toContain("VaR 95%");
      expect(out).toContain("Sharpe Ratio");
    });

    it("runs flipitMultiStrategyTool formatting", async () => {
      const out = await flipitMultiStrategyTool({});
      expect(out).toContain("FlipIt Multi-Strategy Portfolio Matrix");
      expect(out).toContain("Diversification Ratio");
      expect(out).toContain("Strategy Allocations (Risk Parity)");
    });

    it("runs flipitLadderProjectionsTool formatting", async () => {
      const out = await flipitLadderProjectionsTool({ currentEquity: 10 });
      expect(out).toContain("FlipIt 100-Rung Ladder Projections");
      expect(out).toContain("Kelly Optimal Bet Sizing");
      expect(out).toContain("Milestone Velocities");
      expect(out).toContain("Rung 100");
    });
  });
});
