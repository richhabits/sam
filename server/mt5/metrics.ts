// Pure performance / risk maths over closed deals + open positions. No I/O, fully unit-tested.
import type { Mt5Account, Mt5Deal, Mt5Position } from "./adapter.ts";

export interface Mt5Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;              // 0..1
  netProfit: number;
  grossProfit: number;
  grossLoss: number;            // positive number
  profitFactor: number | null;  // null when there are no losing trades (undefined, not infinite)
  avgWin: number;
  avgLoss: number;              // positive number
  expectancy: number;           // average P/L per trade
  maxDrawdown: number;          // largest peak-to-trough fall of the closed-trade equity curve (>= 0)
  maxDrawdownPct: number;       // as a fraction of the peak equity it fell from (0..1)
  openPnl: number;
  exposure: { symbol: string; lots: number; net: "long" | "short" | "flat"; pnl: number }[];
  marginUsedPct: number;        // margin / equity (0..1), 0 when equity <= 0
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export function computeMetrics(deals: Mt5Deal[], positions: Mt5Position[], account: Mt5Account): Mt5Metrics {
  const ordered = [...deals].sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  const wins = ordered.filter((d) => d.profit > 0);
  const losses = ordered.filter((d) => d.profit < 0);
  const grossProfit = wins.reduce((s, d) => s + d.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, d) => s + d.profit, 0));
  const netProfit = grossProfit - grossLoss;

  // Closed-trade equity curve, anchored at the balance the account had before these deals.
  let equity = account.balance - netProfit;
  let peak = equity, maxDd = 0, maxDdPct = 0;
  for (const d of ordered) {
    equity += d.profit;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) { maxDd = dd; maxDdPct = peak > 0 ? dd / peak : 0; }
  }

  const bySymbol = new Map<string, { long: number; short: number; pnl: number }>();
  for (const p of positions) {
    const e = bySymbol.get(p.symbol) ?? { long: 0, short: 0, pnl: 0 };
    if (p.side === "buy") e.long += p.volume; else e.short += p.volume;
    e.pnl += p.profit;
    bySymbol.set(p.symbol, e);
  }

  const n = ordered.length;
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? wins.length / n : 0,
    netProfit: round(netProfit),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    avgWin: wins.length ? round(grossProfit / wins.length) : 0,
    avgLoss: losses.length ? round(grossLoss / losses.length) : 0,
    expectancy: n ? round(netProfit / n) : 0,
    maxDrawdown: round(maxDd),
    maxDrawdownPct: round(maxDdPct, 4),
    openPnl: round(positions.reduce((s, p) => s + p.profit, 0)),
    exposure: [...bySymbol.entries()].map(([symbol, e]) => ({
      symbol, lots: round(e.long + e.short), pnl: round(e.pnl),
      net: e.long > e.short ? "long" as const : e.short > e.long ? "short" as const : "flat" as const,
    })),
    marginUsedPct: account.equity > 0 ? round(account.margin / account.equity, 4) : 0,
  };
}
