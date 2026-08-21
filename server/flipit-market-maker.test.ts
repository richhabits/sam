import { describe, it, expect } from "vitest";
import {
  standardNormalPdf,
  calculateBinaryDelta,
  generateMarketMakerQuotes,
  calculateDeltaHedge,
} from "./flipit-market-maker.ts";

describe("S.A.M. FlipIt Statistical Delta-Neutral Market Maker", () => {
  it("computes normal PDF accurately at standard inflection points", () => {
    // Peak at mean: 1 / sqrt(2 * pi) ≈ 0.3989
    expect(standardNormalPdf(0)).toBeCloseTo(0.3989, 3);
    // At 1 std dev: ≈ 0.2419
    expect(standardNormalPdf(1)).toBeCloseTo(0.2419, 3);
    expect(standardNormalPdf(-1)).toBeCloseTo(0.2419, 3);
  });

  it("calculates binary option delta with positive sensitivity", () => {
    const deltaAtm = calculateBinaryDelta(100000, 100000, 30);
    expect(deltaAtm).toBeGreaterThan(0);

    // Delta is highest near-the-money
    const deltaDeepOtm = calculateBinaryDelta(70000, 100000, 30);
    expect(deltaAtm).toBeGreaterThan(deltaDeepOtm);
  });

  it("skews market making quotes to mitigate inventory risk", () => {
    // Neutral inventory
    const neutralQuotes = generateMarketMakerQuotes({
      spotPriceUsd: 100000,
      strikePriceUsd: 100000,
      expiryDays: 14,
      currentYesInventory: 0,
      targetSpreadPct: 0.04,
    });

    expect(neutralQuotes.skewDirection).toBe("NEUTRAL");
    expect(neutralQuotes.bidPrice).toBeLessThan(neutralQuotes.fairValue);
    expect(neutralQuotes.askPrice).toBeGreaterThan(neutralQuotes.fairValue);
    expect(neutralQuotes.bidSizeGbp).toBe(neutralQuotes.askSizeGbp);

    // Long-heavy inventory (+50 YES shares)
    const longHeavyQuotes = generateMarketMakerQuotes({
      spotPriceUsd: 100000,
      strikePriceUsd: 100000,
      expiryDays: 14,
      currentYesInventory: 50,
      targetSpreadPct: 0.04,
    });

    expect(longHeavyQuotes.skewDirection).toBe("LONG_HEAVY");
    expect(longHeavyQuotes.reservationPrice).toBeLessThan(neutralQuotes.fairValue);
    expect(longHeavyQuotes.askSizeGbp).toBeGreaterThan(longHeavyQuotes.bidSizeGbp);
  });

  it("calculates required spot hedging orders when delta threshold is exceeded", () => {
    // Long 500 binary contracts with positive delta
    const hedge = calculateDeltaHedge(100000, 100000, 30, 500, 20);

    expect(hedge.isHedgeRequired).toBe(true);
    expect(hedge.totalPortfolioDeltaUsd).toBeGreaterThan(20);
    expect(hedge.requiredSpotHedgeAction).toBe("SELL_SPOT");
    expect(hedge.hedgeAmountCryptoUnits).toBeGreaterThan(0);

    // Flat inventory
    const flatHedge = calculateDeltaHedge(100000, 100000, 30, 0, 20);
    expect(flatHedge.isHedgeRequired).toBe(false);
    expect(flatHedge.requiredSpotHedgeAction).toBe("FLAT");
  });
});
