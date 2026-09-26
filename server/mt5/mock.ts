// TEST-ONLY. A deterministic MT5 stand-in so unit tests are exact. It is NOT reachable from a running
// SAM: index.ts does not import it and MT5_BACKEND=mock is refused (a test pins that). Fake account
// numbers must never appear in the product — only tests inject this via setMt5AdapterForTests.
import type { Mt5Account, Mt5Deal, Mt5Position, Mt5Quote, Mt5ReadAdapter } from "./adapter.ts";

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

export function createMockAdapter(now: () => number = () => Date.now()): Mt5ReadAdapter {
  const deal = (n: number, symbol: string, side: "buy" | "sell", volume: number, o: number, c: number, profit: number, hoursAgo: number): Mt5Deal =>
    ({ ticket: `M${1000 + n}`, symbol, side, volume, openPrice: o, closePrice: c, profit, openedAt: iso(now() - (hoursAgo + 3) * H), closedAt: iso(now() - hoursAgo * H) });

  // Oldest → newest. Net +75.50: 5 wins (+360.50) and 3 losses (-285.00).
  const deals: Mt5Deal[] = [
    deal(1, "EURUSD", "buy", 0.10, 1.0850, 1.0880, 30.0, 190),
    deal(2, "GBPUSD", "sell", 0.10, 1.2700, 1.2725, -25.0, 150),
    deal(3, "XAUUSD", "buy", 0.05, 2300.0, 2318.0, 90.0, 120),
    deal(4, "EURUSD", "sell", 0.20, 1.0900, 1.0940, -80.0, 96),
    deal(5, "USDJPY", "buy", 0.10, 150.00, 150.60, 40.0, 72),
    deal(6, "XAUUSD", "sell", 0.10, 2330.0, 2348.0, -180.0, 48),
    deal(7, "GBPUSD", "buy", 0.10, 1.2650, 1.2712, 62.0, 30),
    deal(8, "EURUSD", "buy", 0.20, 1.0870, 1.0898, 138.5, 10),
  ];

  const positions: Mt5Position[] = [
    { ticket: "M2001", symbol: "EURUSD", side: "buy", volume: 0.10, openPrice: 1.0880, currentPrice: 1.0895, profit: 15.0, openedAt: iso(now() - 5 * H), sl: 1.0840, tp: 1.0950 },
    { ticket: "M2002", symbol: "XAUUSD", side: "sell", volume: 0.05, openPrice: 2345.0, currentPrice: 2350.0, profit: -25.0, openedAt: iso(now() - 2 * H), sl: 2365.0 },
  ];

  const quotes: Record<string, [number, number]> = {
    EURUSD: [1.0895, 1.0897], GBPUSD: [1.2712, 1.2715], USDJPY: [150.60, 150.63], XAUUSD: [2350.0, 2350.4],
  };

  return {
    name: "mock",
    readOnly: true,
    async getAccount(): Promise<Mt5Account> {
      const floating = positions.reduce((s, p) => s + p.profit, 0);
      const balance = 10_000 + deals.reduce((s, d) => s + d.profit, 0);
      return { login: "MOCK-0001", server: "SAM-Mock-Demo", currency: "USD", balance, equity: balance + floating, margin: 480, freeMargin: balance + floating - 480, leverage: 100, demo: true };
    },
    async getPositions() { return positions.map((p) => ({ ...p })); },
    async getHistory(sinceMs: number) { return deals.filter((d) => Date.parse(d.closedAt) >= sinceMs).map((d) => ({ ...d })); },
    async getQuote(symbol: string): Promise<Mt5Quote> {
      const q = quotes[symbol.toUpperCase()];
      if (!q) throw new Error(`Unknown symbol "${symbol}" (mock knows: ${Object.keys(quotes).join(", ")})`);
      return { symbol: symbol.toUpperCase(), bid: q[0], ask: q[1], time: iso(now()) };
    },
  };
}
