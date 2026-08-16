// ─────────────────────────────────────────────────────────────
//  S.A.M. · AUTONOMOUS PORTFOLIO REBALANCER (FlipIt Engine)
//
//  Computes exact rebalancing trades and turnover fractions
//  to align current live holdings with Risk-Parity optimal weights.
// ─────────────────────────────────────────────────────────────

export interface HoldingPosition {
  id: string;
  ticker: string;
  name: string;
  currentValueGbp: number;
  currentWeight: number;
}

export interface TargetAllocation {
  id: string;
  targetWeight: number; // 0.0 to 1.0 (sums to 1.0)
}

export interface RebalanceTrade {
  id: string;
  ticker: string;
  action: "BUY" | "SELL" | "HOLD";
  deltaGbp: number;
  currentWeightPct: number;
  targetWeightPct: number;
  postTradeValueGbp: number;
}

export interface PortfolioRebalanceReport {
  totalPortfolioValueGbp: number;
  trades: RebalanceTrade[];
  totalTurnoverGbp: number;
  turnoverPercentage: number;
  estimatedCommissionGbp: number;
  maxWeightDriftPct: number;
  isRebalanceNeeded: boolean;
}

export function calculatePortfolioRebalance(
  currentHoldings: HoldingPosition[],
  targetAllocations: TargetAllocation[],
  totalEquityGbp?: number,
  options: { rebalanceThresholdPct?: number; commissionRate?: number } = {}
): PortfolioRebalanceReport {
  const threshold = options.rebalanceThresholdPct ?? 2.0; // 2% drift trigger
  const commissionRate = options.commissionRate ?? 0.001; // 0.1% transaction cost

  const totalValue = totalEquityGbp ?? currentHoldings.reduce((sum, h) => sum + Math.max(0, h.currentValueGbp), 0);
  const safeTotal = Math.max(1, totalValue);

  const targetMap = new Map<string, number>();
  for (const t of targetAllocations) {
    targetMap.set(t.id, t.targetWeight);
  }

  const trades: RebalanceTrade[] = [];
  let totalTurnover = 0;
  let maxDrift = 0;

  for (const h of currentHoldings) {
    const currentVal = Math.max(0, h.currentValueGbp);
    const currentWeight = currentVal / safeTotal;
    const targetWeight = targetMap.get(h.id) ?? (1 / Math.max(1, currentHoldings.length));

    const targetVal = safeTotal * targetWeight;
    const delta = targetVal - currentVal;
    const driftPct = Math.abs((targetWeight - currentWeight) * 100);

    if (driftPct > maxDrift) maxDrift = driftPct;

    let action: "BUY" | "SELL" | "HOLD" = "HOLD";
    if (Math.abs(delta) >= (safeTotal * (threshold / 100))) {
      action = delta > 0 ? "BUY" : "SELL";
      totalTurnover += Math.abs(delta);
    }

    trades.push({
      id: h.id,
      ticker: h.ticker,
      action,
      deltaGbp: Number(delta.toFixed(2)),
      currentWeightPct: Number((currentWeight * 100).toFixed(2)),
      targetWeightPct: Number((targetWeight * 100).toFixed(2)),
      postTradeValueGbp: Number((action === "HOLD" ? currentVal : targetVal).toFixed(2)),
    });
  }

  const turnoverPct = (totalTurnover / safeTotal) * 100;
  const commission = totalTurnover * commissionRate;

  return {
    totalPortfolioValueGbp: Number(safeTotal.toFixed(2)),
    trades,
    totalTurnoverGbp: Number(totalTurnover.toFixed(2)),
    turnoverPercentage: Number(turnoverPct.toFixed(2)),
    estimatedCommissionGbp: Number(commission.toFixed(2)),
    maxWeightDriftPct: Number(maxDrift.toFixed(2)),
    isRebalanceNeeded: totalTurnover > 0,
  };
}
