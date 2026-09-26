// ─────────────────────────────────────────────────────────────
//  S.A.M. · MT5  — read-only account, positions, journal + risk metrics. REAL DATA ONLY.
//
//  There is NO simulated source in the product. With nothing configured SAM says "not connected"
//  instead of showing numbers that are not yours. The one real source is the JSON that the
//  FlipItReporter Expert Advisor (FLIP IT repo, mt5/) writes from inside a MetaTrader 5 terminal:
//
//      MT5_FILE=/path/to/mt5.json        (the file the EA — or scripts/publish_snapshot.py — wrote)
//
//  MT5_BACKEND=mock is REFUSED on purpose. Tests inject their own adapter via setMt5AdapterForTests;
//  nothing in a running SAM can reach fake data.
//
//  Live (non-demo) accounts are refused unless MT5_ALLOW_LIVE_READ=1 — read-only either way, and the
//  adapter has no write methods at all.
// ─────────────────────────────────────────────────────────────

import type { Mt5Account, Mt5Deal, Mt5Position, Mt5ReadAdapter } from "./adapter.ts";
import { createFileAdapter, Mt5NotConnected } from "./file-source.ts";
import { computeMetrics, type Mt5Metrics } from "./metrics.ts";

export type { Mt5Account, Mt5Deal, Mt5Metrics, Mt5Position, Mt5ReadAdapter };
export { computeMetrics, Mt5NotConnected };

let override: Mt5ReadAdapter | null = null;
/** Test hook: pin the adapter (pass null to restore env-based selection). */
export function setMt5AdapterForTests(a: Mt5ReadAdapter | null) { override = a; }

export const NOT_CONNECTED_TEXT =
  "MetaTrader 5 isn't connected. SAM only ever shows REAL numbers, never sample data. To connect: install MT5, log in with a demo INVESTOR " +
  "login, attach the FlipItReporter EA (FLIP IT repo, mt5/), then set MT5_FILE to the mt5.json it writes.";

export function getMt5Adapter(): Mt5ReadAdapter {
  if (override) return override;
  const backend = (process.env.MT5_BACKEND || "").toLowerCase();
  if (backend === "mock") {
    throw new Error('MT5_BACKEND="mock" no longer exists: SAM never shows simulated account data. To see real numbers, set MT5_FILE to the mt5.json the FlipItReporter EA writes.');
  }
  if (backend && backend !== "file") throw new Error(`MT5_BACKEND="${backend}" isn't supported. Set MT5_FILE=/path/to/mt5.json.`);
  const file = process.env.MT5_FILE;
  if (!file) throw new Mt5NotConnected(NOT_CONNECTED_TEXT);
  return createFileAdapter(file);
}

/** A reading older than this is labelled stale (the EA writes about once a minute while MT5 is open). */
export const STALE_AFTER_MS = 30 * 60_000;

export interface Mt5Summary {
  backend: string;
  readOnly: true;
  days: number;
  /** When the numbers were TAKEN (ISO UTC), if the source knows. */
  asOf?: string;
  /** True when `asOf` is older than STALE_AFTER_MS — the terminal may be closed. */
  stale?: boolean;
  account: Mt5Account;
  positions: Mt5Position[];
  deals: Mt5Deal[];
  metrics: Mt5Metrics;
}

export async function mt5Summary(days = 30, now: number = Date.now()): Promise<Mt5Summary> {
  const d = Number.isFinite(days) ? Math.min(Math.max(Math.floor(days), 1), 365) : 30;
  const a = getMt5Adapter();
  const account = await a.getAccount();
  if (!account.demo && process.env.MT5_ALLOW_LIVE_READ !== "1") {
    throw new Error("This MT5 account is LIVE, not demo. Set MT5_ALLOW_LIVE_READ=1 to allow read-only access to a live account.");
  }
  const [positions, deals, asOf] = await Promise.all([a.getPositions(), a.getHistory(now - d * 86_400_000), a.asOf?.()]);
  const age = asOf ? now - Date.parse(asOf) : NaN;
  return {
    backend: a.name, readOnly: true, days: d, ...(asOf ? { asOf } : {}), ...(Number.isFinite(age) ? { stale: age > STALE_AFTER_MS } : {}),
    account, positions, deals, metrics: computeMetrics(deals, positions, account),
  };
}

/** For the HUD and API: "not connected" is a normal STATE, not an error. Anything else that is wrong still throws. */
export type Mt5Status = ({ connected: true } & Mt5Summary) | { connected: false; reason: string };
export async function mt5Status(days = 30): Promise<Mt5Status> {
  try { return { connected: true, ...(await mt5Summary(days)) }; }
  catch (e) { if (e instanceof Mt5NotConnected) return { connected: false, reason: e.message }; throw e; }
}

const money = (n: number, c: string) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)} ${c}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function asOfLine(s: Mt5Summary): string {
  if (!s.asOf) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(s.asOf)) / 60_000));
  return `\nAs of ${s.asOf} (${mins} min ago)${s.stale ? " — STALE: is MetaTrader 5 still running with the reporter attached?" : ""}`;
}

export function formatAccount(s: Mt5Summary): string {
  const a = s.account, m = s.metrics;
  return `MT5 account ${a.login} @ ${a.server} (${a.demo ? "DEMO" : "LIVE"}, backend: ${s.backend}, read-only)\n` +
    `Balance ${money(a.balance, a.currency)} · Equity ${money(a.equity, a.currency)} · Open P/L ${money(m.openPnl, a.currency)}\n` +
    `Margin ${money(a.margin, a.currency)} (${pct(m.marginUsedPct)} of equity) · Free ${money(a.freeMargin, a.currency)} · Leverage 1:${a.leverage}` + asOfLine(s);
}

export function formatPositions(s: Mt5Summary): string {
  if (!s.positions.length) return "No open positions.";
  const c = s.account.currency;
  const rows = s.positions.map((p) => `• ${p.symbol} ${p.side.toUpperCase()} ${p.volume} lot @ ${p.openPrice} → ${p.currentPrice}  P/L ${money(p.profit, c)}${p.sl ? `  SL ${p.sl}` : ""}${p.tp ? `  TP ${p.tp}` : ""}`);
  const ex = s.metrics.exposure.map((e) => `${e.symbol} ${e.net} ${e.lots}`).join(", ");
  return `${s.positions.length} open position(s):\n${rows.join("\n")}\nExposure: ${ex}\nTotal open P/L ${money(s.metrics.openPnl, c)}` + asOfLine(s);
}

export function formatHistory(s: Mt5Summary): string {
  const m = s.metrics, c = s.account.currency;
  if (!m.trades) return `No closed trades in the last ${s.days} day(s).`;
  return `Last ${s.days} day(s): ${m.trades} closed trades — ${m.wins}W / ${m.losses}L (win rate ${pct(m.winRate)})\n` +
    `Net ${money(m.netProfit, c)} · Profit factor ${m.profitFactor ?? "n/a (no losing trades)"} · Expectancy ${money(m.expectancy, c)}/trade\n` +
    `Avg win ${money(m.avgWin, c)} · Avg loss ${money(-m.avgLoss, c)} · Max drawdown ${money(m.maxDrawdown, c)} (${pct(m.maxDrawdownPct)})` + asOfLine(s);
}
