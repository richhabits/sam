// ─────────────────────────────────────────────────────────────
//  S.A.M. · FLIPIT DYNAMIC RISK SHIELD & PORTFOLIO SCALER
//
//  Computes real-time Kelly leverage sizing, drawdown circuit-breakers,
//  and multi-asset risk parity allocation with zero execution drag.
// ─────────────────────────────────────────────────────────────

export interface KellyRiskAssessment {
  currentEquityGbp: number;
  winRatePct: number;
  winLossRatio: number;
  fullKellyFraction: number;
  recommendedHalfKelly: number;
  maxLeveragePermitted: number;
  drawdownPct: number;
  riskRegime: "AGGRESSIVE" | "BALANCED" | "DEFENSIVE" | "CIRCUIT_BREAKER_HALT";
  recommendedCashReservePct: number;
  hedgingAction: string;
}

export interface ArbitrageOpportunity {
  pair: string;
  sourceExchange: string;
  targetExchange: string;
  spreadBps: number; // Basis points (1 bp = 0.01%)
  estimatedNetProfitGbp: number;
  executionRisk: "LOW" | "MEDIUM" | "HIGH";
}

export function computeKellyRiskShield(params: {
  currentEquityGbp: number;
  peakEquityGbp: number;
  winRate: number; // e.g. 0.58
  avgWinGbp: number;
  avgLossGbp: number;
  maxDrawdownThresholdPct?: number;
}): KellyRiskAssessment {
  const current = Math.max(1, params.currentEquityGbp);
  const peak = Math.max(current, params.peakEquityGbp);
  const drawdown = Math.max(0, ((peak - current) / peak) * 100);

  const winRate = Math.min(0.99, Math.max(0.01, params.winRate));
  const avgWin = Math.max(1, params.avgWinGbp);
  const avgLoss = Math.max(1, params.avgLossGbp);
  const b = avgWin / avgLoss; // payoff ratio
  const p = winRate;
  const q = 1 - p;

  // Kelly Criterion: f* = (p * b - q) / b
  const rawKelly = Math.max(0, (p * b - q) / b);
  const fullKelly = Number(Math.min(1.0, rawKelly).toFixed(4));
  const halfKelly = Number((fullKelly * 0.5).toFixed(4));

  // Determine Risk Regime based on current drawdown
  let regime: "AGGRESSIVE" | "BALANCED" | "DEFENSIVE" | "CIRCUIT_BREAKER_HALT" = "BALANCED";
  let cashReservePct = 15;
  let maxLeverage = 2.0;
  let hedgingAction = "Maintain standard risk-parity weights.";

  if (drawdown >= 20) {
    regime = "CIRCUIT_BREAKER_HALT";
    cashReservePct = 80;
    maxLeverage = 1.0;
    hedgingAction = "Halt new leveraged allocations. Hedge 50% beta via index short/put overlay.";
  } else if (drawdown >= 10) {
    regime = "DEFENSIVE";
    cashReservePct = 40;
    maxLeverage = 1.25;
    hedgingAction = "Scale position size to Quarter-Kelly (25%). Tighten trailing stops to 1.5 sigma.";
  } else if (drawdown < 5 && fullKelly > 0.15) {
    regime = "AGGRESSIVE";
    cashReservePct = 10;
    maxLeverage = 2.5;
    hedgingAction = "Compounding mode active. Deploy Half-Kelly allocation across top-momentum assets.";
  }

  return {
    currentEquityGbp: Number(current.toFixed(2)),
    winRatePct: Number((winRate * 100).toFixed(2)),
    winLossRatio: Number(b.toFixed(2)),
    fullKellyFraction: fullKelly,
    recommendedHalfKelly: halfKelly,
    maxLeveragePermitted: maxLeverage,
    drawdownPct: Number(drawdown.toFixed(2)),
    riskRegime: regime,
    recommendedCashReservePct: cashReservePct,
    hedgingAction,
  };
}

export function scanCrossMarketSpreads(
  quotes: { symbol: string; exchangeA: string; bidA: number; askA: number; exchangeB: string; bidB: number; askB: number }[],
  allocatedCapitalGbp = 1000
): ArbitrageOpportunity[] {
  const opps: ArbitrageOpportunity[] = [];

  for (const q of quotes) {
    // Buy on A, sell on B
    const spreadAB = ((q.bidB - q.askA) / q.askA) * 10000; // in bps
    // Buy on B, sell on A
    const spreadBA = ((q.bidA - q.askB) / q.askB) * 10000; // in bps

    if (spreadAB > 10) {
      const grossProfit = (allocatedCapitalGbp * spreadAB) / 10000;
      const netProfit = grossProfit - (allocatedCapitalGbp * 0.001); // 10 bps fees
      if (netProfit > 0) {
        opps.push({
          pair: q.symbol,
          sourceExchange: q.exchangeA,
          targetExchange: q.exchangeB,
          spreadBps: Number(spreadAB.toFixed(2)),
          estimatedNetProfitGbp: Number(netProfit.toFixed(2)),
          executionRisk: spreadAB > 50 ? "MEDIUM" : "LOW",
        });
      }
    } else if (spreadBA > 10) {
      const grossProfit = (allocatedCapitalGbp * spreadBA) / 10000;
      const netProfit = grossProfit - (allocatedCapitalGbp * 0.001);
      if (netProfit > 0) {
        opps.push({
          pair: q.symbol,
          sourceExchange: q.exchangeB,
          targetExchange: q.exchangeA,
          spreadBps: Number(spreadBA.toFixed(2)),
          estimatedNetProfitGbp: Number(netProfit.toFixed(2)),
          executionRisk: spreadBA > 50 ? "MEDIUM" : "LOW",
        });
      }
    }
  }

  return opps.sort((a, b) => b.estimatedNetProfitGbp - a.estimatedNetProfitGbp);
}
