import type { Express } from "express";
import { computeKellyRiskShield, scanCrossMarketSpreads } from "./flipit-scale.ts";
import { calculatePortfolioRebalance, type HoldingPosition, type TargetAllocation } from "./flipit-auto.ts";

export function registerFlipItScaleRoutes(app: Express) {
  app.post("/api/flipit/rebalance", (req, res) => {
    try {
      const { holdings, targetAllocations, totalEquityGbp, threshold, commission } = req.body || {};
      if (!Array.isArray(holdings) || !Array.isArray(targetAllocations)) {
        return res.status(400).json({ error: "holdings and targetAllocations arrays are required." });
      }
      
      const report = calculatePortfolioRebalance(
        holdings as HoldingPosition[], 
        targetAllocations as TargetAllocation[], 
        totalEquityGbp ? Number(totalEquityGbp) : undefined, 
        { 
          rebalanceThresholdPct: threshold ? Number(threshold) : undefined, 
          commissionRate: commission ? Number(commission) : undefined 
        }
      );
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to calculate rebalance" });
    }
  });

  app.post("/api/flipit/shield", (req, res) => {
    try {
      const { currentEquityGbp, peakEquityGbp, winRate, avgWinGbp, avgLossGbp, maxDrawdownThresholdPct } = req.body || {};
      if (currentEquityGbp == null || peakEquityGbp == null || winRate == null || avgWinGbp == null || avgLossGbp == null) {
        return res.status(400).json({ error: "Missing required Kelly risk parameters." });
      }

      const shield = computeKellyRiskShield({
        currentEquityGbp: Number(currentEquityGbp),
        peakEquityGbp: Number(peakEquityGbp),
        winRate: Number(winRate),
        avgWinGbp: Number(avgWinGbp),
        avgLossGbp: Number(avgLossGbp),
        maxDrawdownThresholdPct: maxDrawdownThresholdPct != null ? Number(maxDrawdownThresholdPct) : undefined
      });
      res.json(shield);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to compute Kelly shield" });
    }
  });

  app.post("/api/flipit/arbitrage", (req, res) => {
    try {
      const { quotes, allocatedCapitalGbp } = req.body || {};
      if (!Array.isArray(quotes)) {
        return res.status(400).json({ error: "quotes array is required." });
      }

      const opps = scanCrossMarketSpreads(quotes, allocatedCapitalGbp ? Number(allocatedCapitalGbp) : undefined);
      res.json({ opportunities: opps });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to scan arbitrage spreads" });
    }
  });
}
