import { describe, it, expect } from "vitest";
import { computeKellyRiskShield, scanCrossMarketSpreads } from "./flipit-scale.ts";
import { flipitScaleShieldTool } from "./tools.ts";

describe("FlipIt Dynamic Risk Shield & Portfolio Scaler", () => {
  it("computes Kelly leverage and switches regimes based on drawdown", () => {
    // Normal balanced regime
    const res1 = computeKellyRiskShield({
      currentEquityGbp: 1000,
      peakEquityGbp: 1020,
      winRate: 0.60,
      avgWinGbp: 150,
      avgLossGbp: 100,
    });
    expect(res1.fullKellyFraction).toBeGreaterThan(0);
    expect(res1.recommendedHalfKelly).toBeLessThan(res1.fullKellyFraction);
    expect(res1.riskRegime).toBe("AGGRESSIVE");

    // Circuit breaker regime on 25% drawdown
    const res2 = computeKellyRiskShield({
      currentEquityGbp: 750,
      peakEquityGbp: 1000,
      winRate: 0.50,
      avgWinGbp: 100,
      avgLossGbp: 100,
    });
    expect(res2.riskRegime).toBe("CIRCUIT_BREAKER_HALT");
    expect(res2.recommendedCashReservePct).toBeGreaterThanOrEqual(80);
    expect(res2.hedgingAction).toContain("Halt new leveraged allocations");
  });

  it("scans cross-market arbitrage spreads accurately", () => {
    const quotes = [
      { symbol: "BTC/GBP", exchangeA: "Kraken", bidA: 50000, askA: 50020, exchangeB: "Binance", bidB: 50200, askB: 50210 },
      { symbol: "ETH/GBP", exchangeA: "Coinbase", bidA: 2500, askA: 2501, exchangeB: "Kraken", bidB: 2502, askB: 2503 },
    ];

    const opps = scanCrossMarketSpreads(quotes, 10000);
    expect(opps.length).toBeGreaterThan(0);
    expect(opps[0].pair).toBe("BTC/GBP");
    expect(opps[0].estimatedNetProfitGbp).toBeGreaterThan(0);
  });

  it("flipitScaleShieldTool formats report cleanly", async () => {
    const out = await flipitScaleShieldTool({ currentEquityGbp: 5000, peakEquityGbp: 5200, winRate: 0.55 });
    expect(out).toContain("FlipIt Portfolio Scaling & Risk Shield");
    expect(out).toContain("Risk Regime:");
  });

  // AUDIT FIX: scanCrossMarketSpreads was imported into tools.ts and never called anywhere —
  // dead code the tool's own description already claimed to do ("cross-market arbitrage
  // spreads"). Proves the wiring now actually runs, and stays honest with no quotes supplied
  // (SAM has no live exchange feed, so it must never fabricate a spread on its own).
  it("flipitScaleShieldTool runs the arbitrage scan when real quotes are supplied", async () => {
    const quotes = [
      { symbol: "BTC/GBP", exchangeA: "Kraken", bidA: 50000, askA: 50020, exchangeB: "Binance", bidB: 50200, askB: 50210 },
    ];
    const out = await flipitScaleShieldTool({ currentEquityGbp: 5000, quotes, allocatedCapitalGbp: 10000 });
    expect(out).toContain("Cross-Market Arbitrage Scan");
    expect(out).toContain("BTC/GBP");
    expect(out).toContain("Kraken");
  });

  it("flipitScaleShieldTool omits the arbitrage section entirely when no quotes are given — never fabricates one", async () => {
    const out = await flipitScaleShieldTool({ currentEquityGbp: 5000 });
    expect(out).not.toContain("Cross-Market Arbitrage Scan");
  });
});
