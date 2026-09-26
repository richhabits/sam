// ─────────────────────────────────────────────────────────────
//  S.A.M. · MT5  — Phase 1: read-only account, positions, journal + risk metrics.
//
//  Backend is chosen by MT5_BACKEND (default "mock"). Real backends (MetaApi / self-hosted
//  bridge) are added later behind the same read-only adapter; until then an unknown value is a
//  loud error, never a silent fallback to something that might touch a real account.
//
//  Live (non-demo) accounts are refused unless MT5_ALLOW_LIVE_READ=1 — Phase 1 is demo-only.
// ─────────────────────────────────────────────────────────────

import type { Mt5ReadAdapter, Mt5Account, Mt5Position, Mt5Deal } from "./adapter.ts";
import { createMockAdapter } from "./mock.ts";
import { computeMetrics, type Mt5Metrics } from "./metrics.ts";

export type { Mt5ReadAdapter, Mt5Account, Mt5Position, Mt5Deal, Mt5Metrics };
export { computeMetrics };

let override: Mt5ReadAdapter | null = null;
/** Test hook: pin the adapter (pass null to restore env-based selection). */
export function setMt5AdapterForTests(a: Mt5ReadAdapter | null) { override = a; }

export function getMt5Adapter(): Mt5ReadAdapter {
  if (override) return override;
  const backend = (process.env.MT5_BACKEND || "mock").toLowerCase();
  if (backend === "mock") return createMockAdapter();
  throw new Error(`MT5_BACKEND="${backend}" is not available yet — Phase 1 ships the "mock" backend only (MetaApi / self-hosted bridge come next). Unset MT5_BACKEND to use the mock.`);
}

export interface Mt5Summary {
  backend: string;
  readOnly: true;
  days: number;
  account: Mt5Account;
  positions: Mt5Position[];
  deals: Mt5Deal[];
  metrics: Mt5Metrics;
}

export async function mt5Summary(days = 30): Promise<Mt5Summary> {
  const d = Number.isFinite(days) ? Math.min(Math.max(Math.floor(days), 1), 365) : 30;
  const a = getMt5Adapter();
  const account = await a.getAccount();
  if (!account.demo && process.env.MT5_ALLOW_LIVE_READ !== "1") {
    throw new Error("This MT5 account is LIVE, not demo. Phase 1 is demo-only; set MT5_ALLOW_LIVE_READ=1 to allow read-only access to a live account.");
  }
  const [positions, deals] = await Promise.all([a.getPositions(), a.getHistory(Date.now() - d * 86_400_000)]);
  return { backend: a.name, readOnly: true, days: d, account, positions, deals, metrics: computeMetrics(deals, positions, account) };
}

const money = (n: number, c: string) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)} ${c}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function formatAccount(s: Mt5Summary): string {
  const a = s.account, m = s.metrics;
  return `MT5 account ${a.login} @ ${a.server} (${a.demo ? "DEMO" : "LIVE"}, backend: ${s.backend}, read-only)\n` +
    `Balance ${money(a.balance, a.currency)} · Equity ${money(a.equity, a.currency)} · Open P/L ${money(m.openPnl, a.currency)}\n` +
    `Margin ${money(a.margin, a.currency)} (${pct(m.marginUsedPct)} of equity) · Free ${money(a.freeMargin, a.currency)} · Leverage 1:${a.leverage}`;
}

export function formatPositions(s: Mt5Summary): string {
  if (!s.positions.length) return "No open positions.";
  const c = s.account.currency;
  const rows = s.positions.map((p) => `• ${p.symbol} ${p.side.toUpperCase()} ${p.volume} lot @ ${p.openPrice} → ${p.currentPrice}  P/L ${money(p.profit, c)}${p.sl ? `  SL ${p.sl}` : ""}${p.tp ? `  TP ${p.tp}` : ""}`);
  const ex = s.metrics.exposure.map((e) => `${e.symbol} ${e.net} ${e.lots}`).join(", ");
  return `${s.positions.length} open position(s):\n${rows.join("\n")}\nExposure: ${ex}\nTotal open P/L ${money(s.metrics.openPnl, c)}`;
}

export function formatHistory(s: Mt5Summary): string {
  const m = s.metrics, c = s.account.currency;
  if (!m.trades) return `No closed trades in the last ${s.days} day(s).`;
  return `Last ${s.days} day(s): ${m.trades} closed trades — ${m.wins}W / ${m.losses}L (win rate ${pct(m.winRate)})\n` +
    `Net ${money(m.netProfit, c)} · Profit factor ${m.profitFactor ?? "n/a (no losing trades)"} · Expectancy ${money(m.expectancy, c)}/trade\n` +
    `Avg win ${money(m.avgWin, c)} · Avg loss ${money(-m.avgLoss, c)} · Max drawdown ${money(m.maxDrawdown, c)} (${pct(m.maxDrawdownPct)})`;
}
