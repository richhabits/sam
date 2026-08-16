import { describe, it, expect } from "vitest";
import {
  calculatePortfolioRebalance,
} from "./flipit-auto.ts";
import { flipitRebalancePortfolioTool } from "./tools.ts";

describe("Autonomous Portfolio Rebalancer", () => {
  it("calculates exact buy/sell trade amounts and turnover for drifted portfolio", () => {
    const holdings = [
      { id: "mom_core", ticker: "MOM", name: "Momentum", currentValueGbp: 70, currentWeight: 0.70 },
      { id: "trend_flt", ticker: "TRND", name: "Trend", currentValueGbp: 30, currentWeight: 0.30 },
    ];
    const targets = [
      { id: "mom_core", targetWeight: 0.50 },
      { id: "trend_flt", targetWeight: 0.50 },
    ];

    const report = calculatePortfolioRebalance(holdings, targets, 100);

    expect(report.totalPortfolioValueGbp).toBe(100);
    expect(report.isRebalanceNeeded).toBe(true);
    expect(report.totalTurnoverGbp).toBe(40); // Sell 20 MOM + Buy 20 TRND = 40 turnover
    expect(report.trades.find(t => t.id === "mom_core")?.action).toBe("SELL");
    expect(report.trades.find(t => t.id === "trend_flt")?.action).toBe("BUY");
  });

  it("identifies already balanced portfolio and avoids unnecessary turnover", () => {
    const holdings = [
      { id: "asset_a", ticker: "AAA", name: "Asset A", currentValueGbp: 50, currentWeight: 0.50 },
      { id: "asset_b", ticker: "BBB", name: "Asset B", currentValueGbp: 50, currentWeight: 0.50 },
    ];
    const targets = [
      { id: "asset_a", targetWeight: 0.50 },
      { id: "asset_b", targetWeight: 0.50 },
    ];

    const report = calculatePortfolioRebalance(holdings, targets, 100);

    expect(report.isRebalanceNeeded).toBe(false);
    expect(report.totalTurnoverGbp).toBe(0);
    expect(report.trades.every(t => t.action === "HOLD")).toBe(true);
  });

  it("runs flipitRebalancePortfolioTool", async () => {
    const out = await flipitRebalancePortfolioTool({});
    expect(out).toContain("FlipIt Autonomous Portfolio Rebalancing Report");
    expect(out).toContain("Total Turnover:");
    expect(out).toContain("Actionable Rebalance Orders:");
  });
});
