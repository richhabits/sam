import { describe, it, expect } from "vitest";
import {
  calculateBinaryOutcomeProbability,
  evaluateEvSignal,
  scanEvArbitrageSignals,
  standardNormalCdf,
  type PredictionMarketTarget,
} from "./flipit-signals.ts";

describe("S.A.M. FlipIt +EV Prediction Market Signal Engine", () => {
  it("computes normal CDF accurately at standard deviation bounds", () => {
    expect(standardNormalCdf(0)).toBeCloseTo(0.5, 2);
    expect(standardNormalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(standardNormalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });

  it("calculates binary outcome probability respecting spot, strike, and time horizon", () => {
    // When spot equals strike, probability is roughly ~50%
    const pAtMoney = calculateBinaryOutcomeProbability(100000, 100000, 30);
    expect(pAtMoney).toBeGreaterThanOrEqual(0.45);
    expect(pAtMoney).toBeLessThanOrEqual(0.55);

    // Deep in the money (Spot 110k vs Strike 90k)
    const pDeepItm = calculateBinaryOutcomeProbability(110000, 90000, 14);
    expect(pDeepItm).toBeGreaterThan(0.85);

    // Deep out of the money (Spot 80k vs Strike 120k)
    const pDeepOtm = calculateBinaryOutcomeProbability(80000, 120000, 7);
    expect(pDeepOtm).toBeLessThan(0.15);
  });

  it("identifies positive expected value (+EV) and calculates capped Half-Kelly size", () => {
    const undervaluedTarget: PredictionMarketTarget = {
      id: "test-undervalued",
      marketTitle: "Will BTC reach 100k?",
      underlyingAsset: "BTC",
      strikePriceUsd: 98000,
      expiryDays: 7,
      marketYesPrice: 0.35, // Market thinks 35%
      marketNoPrice: 0.65,
    };

    // Spot is 99,500 (above strike, model probability ~60%+)
    const signal = evaluateEvSignal(undervaluedTarget, 99500, 2000);

    expect(signal.isPositiveEv).toBe(true);
    expect(signal.recommendedPosition).toBe("BUY_YES");
    expect(signal.edgePct).toBeGreaterThan(4);
    expect(signal.halfKellyAllocationGbp).toBeGreaterThan(0);
    expect(signal.halfKellyAllocationGbp).toBeLessThanOrEqual(2000 * 0.15); // Never exceeds 15% risk cap
  });

  it("scans default market opportunities with live spot feeds", () => {
    const signals = scanEvArbitrageSignals([], 1500);
    expect(signals.length).toBeGreaterThanOrEqual(2);
    for (const s of signals) {
      expect(s.spotPriceUsd).toBeGreaterThan(0);
      expect(s.modelTrueProbability).toBeGreaterThan(0);
      expect(s.modelTrueProbability).toBeLessThan(1);
    }
  });
});
