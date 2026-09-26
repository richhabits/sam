import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Mt5Account, Mt5Deal } from "./adapter.ts";
import { formatAccount, formatHistory, formatPositions, getMt5Adapter, mt5Summary, setMt5AdapterForTests } from "./index.ts";
import { computeMetrics } from "./metrics.ts";
import { createMockAdapter } from "./mock.ts";

const acct = (o: Partial<Mt5Account> = {}): Mt5Account =>
  ({ login: "1", server: "s", currency: "USD", balance: 1000, equity: 1000, margin: 100, freeMargin: 900, leverage: 100, demo: true, ...o });
const deal = (n: number, profit: number): Mt5Deal =>
  ({ ticket: String(n), symbol: "EURUSD", side: "buy", volume: 0.1, openPrice: 1, closePrice: 1, profit, openedAt: new Date(n * 1e6).toISOString(), closedAt: new Date(n * 1e6 + 1).toISOString() });

afterEach(() => { setMt5AdapterForTests(null); delete process.env.MT5_BACKEND; delete process.env.MT5_FILE; delete process.env.MT5_ALLOW_LIVE_READ; });

describe("mt5 metrics", () => {
  it("empty history is all zeros, no NaN", () => {
    const m = computeMetrics([], [], acct());
    expect(m).toMatchObject({ trades: 0, winRate: 0, netProfit: 0, profitFactor: null, expectancy: 0, maxDrawdown: 0, openPnl: 0 });
  });
  it("win rate, profit factor, expectancy", () => {
    const m = computeMetrics([deal(1, 100), deal(2, -50), deal(3, 50)], [], acct({ balance: 1100 }));
    expect(m.wins).toBe(2); expect(m.losses).toBe(1);
    expect(m.winRate).toBeCloseTo(2 / 3);
    expect(m.netProfit).toBe(100); expect(m.profitFactor).toBe(3); expect(m.expectancy).toBeCloseTo(33.33);
    expect(m.avgWin).toBe(75); expect(m.avgLoss).toBe(50);
  });
  it("no losers → profitFactor null (not Infinity)", () => {
    expect(computeMetrics([deal(1, 10), deal(2, 20)], [], acct()).profitFactor).toBeNull();
  });
  it("max drawdown is peak-to-trough on the closed-trade curve, anchored at pre-deal balance", () => {
    // start 1000: +100 → 1100 (peak), -300 → 800, +50 → 850 ; dd = 300 from peak 1100
    const m = computeMetrics([deal(1, 100), deal(2, -300), deal(3, 50)], [], acct({ balance: 850 }));
    expect(m.maxDrawdown).toBe(300);
    expect(m.maxDrawdownPct).toBeCloseTo(300 / 1100, 3);
  });
  it("order of input doesn't matter (sorted by close time)", () => {
    const a = computeMetrics([deal(3, 50), deal(1, 100), deal(2, -300)], [], acct({ balance: 850 }));
    expect(a.maxDrawdown).toBe(300);
  });
  it("exposure nets long vs short per symbol; margin % guards zero equity", () => {
    const pos = (t: string, side: "buy" | "sell", v: number, p: number) => ({ ticket: t, symbol: "EURUSD", side, volume: v, openPrice: 1, currentPrice: 1, profit: p, openedAt: "" });
    const m = computeMetrics([], [pos("a", "buy", 0.3, 10), pos("b", "sell", 0.1, -4)], acct({ equity: 0 }));
    expect(m.exposure).toEqual([{ symbol: "EURUSD", lots: 0.4, net: "long", pnl: 6 }]);
    expect(m.openPnl).toBe(6); expect(m.marginUsedPct).toBe(0);
  });
});

// The mock is a TEST fixture only — injected explicitly, never reachable from a running SAM (see file-source.test.ts).
describe("mt5 summary logic (test stand-in adapter)", () => {
  beforeEach(() => setMt5AdapterForTests(createMockAdapter()));
  it("mock is deterministic and internally consistent", async () => {
    const s = await mt5Summary(30);
    expect(s.backend).toBe("mock"); expect(s.readOnly).toBe(true);
    expect(s.metrics.trades).toBe(8); expect(s.metrics.netProfit).toBe(75.5);
    expect(s.account.balance).toBe(10075.5);
    expect(s.account.equity).toBeCloseTo(10075.5 + s.metrics.openPnl);
  });
  it("days window filters history", async () => {
    const s = await mt5Summary(2);   // only deals closed in the last 48h
    expect(s.metrics.trades).toBeLessThan(8);
  });
  it("days is clamped, junk falls back", async () => {
    expect((await mt5Summary(9999)).days).toBe(365);
    expect((await mt5Summary(NaN)).days).toBe(30);
  });
  it("adapter exposes NO write methods (read-only by construction)", () => {
    const a = createMockAdapter() as any;
    expect(a.readOnly).toBe(true);
    for (const k of ["placeOrder", "order", "buy", "sell", "closePosition", "modify", "cancel"]) expect(a[k]).toBeUndefined();
  });
  it("unknown backend is a loud error, never a silent fallback", () => {
    setMt5AdapterForTests(null);
    process.env.MT5_BACKEND = "metaapi";
    expect(() => getMt5Adapter()).toThrow(/isn't supported/);
  });
  it("refuses a LIVE account unless MT5_ALLOW_LIVE_READ=1", async () => {
    const base = createMockAdapter();
    setMt5AdapterForTests({ ...base, getAccount: async () => ({ ...(await base.getAccount()), demo: false }) });
    await expect(mt5Summary()).rejects.toThrow(/LIVE/);
    process.env.MT5_ALLOW_LIVE_READ = "1";
    await expect(mt5Summary()).resolves.toBeTruthy();
  });
  it("formatters render without throwing and label DEMO/read-only", async () => {
    const s = await mt5Summary();
    expect(formatAccount(s)).toMatch(/DEMO.*read-only/);
    expect(formatPositions(s)).toMatch(/2 open position/);
    expect(formatHistory(s)).toMatch(/8 closed trades/);
  });
});
