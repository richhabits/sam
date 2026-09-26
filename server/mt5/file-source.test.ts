import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileAdapter, Mt5FileError, Mt5NotConnected, parseMt5File } from "./file-source.ts";
import { formatAccount, formatHistory, getMt5Adapter, mt5Status, mt5Summary, NOT_CONNECTED_TEXT, setMt5AdapterForTests } from "./index.ts";

// These files are SYNTHETIC (the FlipItReporter EA has not run yet — MT5 wasn't installed when this was
// written). They prove SAM's parser is strict, not that any particular terminal produces this exact output.
const sample = (over: Record<string, any> = {}) => ({
  schema: "flipit-mt5/1", asOf: new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, "Z"),
  terminal: { build: 5000, company: "Test Broker", server: "Test-Demo" },
  account: { loginMasked: "***321", currency: "USD", balance: 10000, equity: 10012.5, margin: 100, freeMargin: 9912.5, leverage: 100, mode: "demo", tradeAllowed: false },
  positions: [{ ticket: 1, symbol: "EURUSD", side: "buy", volume: 0.1, openPrice: 1.085, price: 1.088, profit: 30, swap: 0, sl: 0, tp: null, openedAt: "2026-09-26T08:00:00Z" }],
  deals: [
    { ticket: 9, symbol: "GBPUSD", side: "sell", volume: 0.1, price: 1.27, profit: -12.5, commission: -0.7, swap: -0.3, closedAt: new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, "Z") },
    { ticket: 8, symbol: "EURUSD", side: "buy", volume: 0.2, price: 1.09, profit: 40, commission: -1, swap: 0, closedAt: new Date(Date.now() - 7200_000).toISOString().replace(/\.\d+Z$/, "Z") },
  ],
  historyDays: 30, truncated: { positions: false, deals: false }, ...over,
});
const write = (obj: unknown) => { const d = mkdtempSync(join(tmpdir(), "mt5-")); const f = join(d, "mt5.json"); writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj)); return f; };

afterEach(() => { setMt5AdapterForTests(null); delete process.env.MT5_BACKEND; delete process.env.MT5_FILE; delete process.env.MT5_ALLOW_LIVE_READ; });

describe("REAL DATA ONLY — nothing configured is 'not connected', never fake numbers", () => {
  it("default: no MT5_FILE ⇒ Mt5NotConnected with the setup steps", () => {
    expect(() => getMt5Adapter()).toThrow(Mt5NotConnected);
    expect(() => getMt5Adapter()).toThrow(/never sample data/);
  });
  it("mt5Status reports {connected:false} as a normal state", async () => {
    const s = await mt5Status();
    expect(s).toEqual({ connected: false, reason: NOT_CONNECTED_TEXT });
  });
  it("mt5Summary rejects (there is nothing to summarise) — no fabricated account", async () => {
    await expect(mt5Summary()).rejects.toBeInstanceOf(Mt5NotConnected);
  });
  it("MT5_BACKEND=mock is REFUSED, loudly — the mock cannot be switched on in a running SAM", () => {
    process.env.MT5_BACKEND = "mock";
    expect(() => getMt5Adapter()).toThrow(/no longer exists/);
    process.env.MT5_FILE = write(sample());          // even with a real file configured, 'mock' stays refused
    expect(() => getMt5Adapter()).toThrow(/no longer exists/);
  });
  it("the product code never imports the mock (only tests may)", () => {
    const root = join(__dirname, "..");
    const { execSync } = require("node:child_process");
    const hits = String(execSync(`grep -rln "mt5/mock\\|from \\"./mock" ${root} --include=*.ts --exclude=*.test.ts || true`)).trim().split("\n").filter(Boolean);
    expect(hits).toEqual([]);                        // mock.ts itself has no self-import; index.ts etc. must not pull it in
  });
  it("a configured path that doesn't exist yet is 'not connected' (the EA hasn't written yet), not an error", async () => {
    process.env.MT5_FILE = "/nonexistent/mt5.json";
    const s = await mt5Status();
    expect(s.connected).toBe(false);
    expect((s as any).reason).toMatch(/doesn't exist yet/);
  });
});

describe("file source — a real reading", () => {
  it("summarises the file: masked login, net-of-costs deals, as-of, not stale", async () => {
    process.env.MT5_FILE = write(sample());
    const s = await mt5Summary(30);
    expect(s.backend).toBe("file:mt5.json"); expect(s.readOnly).toBe(true);
    expect(s.account).toMatchObject({ login: "***321", server: "Test-Demo", currency: "USD", balance: 10000, demo: true });
    expect(s.positions).toHaveLength(1); expect(s.positions[0]).toMatchObject({ ticket: "1", currentPrice: 1.088, profit: 30 });
    expect(s.positions[0]).not.toHaveProperty("sl");                     // a 0 stop is "no stop", not a stop at 0
    // realised P/L = profit + commission + swap:  -12.5-0.7-0.3 = -13.5  and  40-1 = 39
    expect(s.deals.map((d) => d.profit).sort((a, b) => a - b)).toEqual([-13.5, 39]);
    expect(s.metrics.trades).toBe(2); expect(s.metrics.netProfit).toBe(25.5);
    expect(s.stale).toBe(false); expect(s.asOf).toBeTruthy();
    expect(formatAccount(s)).toMatch(/\*\*\*321.*DEMO/s); expect(formatAccount(s)).toMatch(/As of /);
    expect(formatAccount(s)).not.toMatch(/mock/i);
  });
  it("labels an old reading STALE instead of presenting it as current", async () => {
    process.env.MT5_FILE = write(sample({ asOf: "2026-01-01T00:00:00Z" }));
    const s = await mt5Summary(365);
    expect(s.stale).toBe(true);
    expect(formatHistory(s)).toMatch(/STALE/);
  });
  it("the history window filters by close time", async () => {
    process.env.MT5_FILE = write(sample());
    const a = createFileAdapter(process.env.MT5_FILE);
    expect(await a.getHistory(Date.now() - 90 * 60_000)).toHaveLength(1);   // only the deal closed 1h ago
  });
  it("is read-only by construction (no write methods) and offers no fake quotes", async () => {
    const a = createFileAdapter(write(sample())) as any;
    for (const k of ["placeOrder", "order", "buy", "sell", "closePosition", "modify", "cancel"]) expect(a[k]).toBeUndefined();
    await expect(a.getQuote("EURUSD")).rejects.toThrow(/aren't available/);
  });
  it("never writes to the file it reads", async () => {
    const f = write(sample()); const before = readFileSync(f, "utf8");
    process.env.MT5_FILE = f; await mt5Summary(); await mt5Summary();
    expect(readFileSync(f, "utf8")).toBe(before);
  });
  it("a LIVE (real-money) file is refused unless MT5_ALLOW_LIVE_READ=1", async () => {
    process.env.MT5_FILE = write(sample({ account: { ...sample().account, mode: "real" } }));
    await expect(mt5Summary()).rejects.toThrow(/LIVE/);
    process.env.MT5_ALLOW_LIVE_READ = "1";
    await expect(mt5Summary()).resolves.toMatchObject({ account: { demo: false } });
  });
});

describe("file source — untrusted input is rejected loudly, never guessed around", () => {
  const bad: [string, (o: any) => void, RegExp][] = [
    ["wrong schema", (o) => { o.schema = "other/1"; }, /schema/],
    ["an unmasked (full) account number", (o) => { o.account.loginMasked = "1234567890"; }, /loginMasked/],
    ["a non-finite balance", (o) => { o.account.balance = "lots"; }, /balance/],
    ["an unknown account mode", (o) => { o.account.mode = "banana"; }, /mode/],
    ["a malformed position", (o) => { o.positions[0].side = "long"; }, /positions\[0\]/],
    ["a malformed deal", (o) => { o.deals[0].profit = null; }, /deals\[0\]/],
    ["a bad timestamp", (o) => { o.asOf = "yesterday"; }, /asOf/],
    ["too many deals", (o) => { o.deals = Array.from({ length: 1001 }, () => o.deals[0]); }, /more than 1000/],
  ];
  for (const [name, mutate, re] of bad) {
    it(`rejects ${name}`, () => { const o = sample(); mutate(o); expect(() => parseMt5File(JSON.stringify(o))).toThrow(re); });
  }
  it("rejects half-written / truncated JSON", () => {
    expect(() => parseMt5File(JSON.stringify(sample()).slice(0, 90))).toThrow(Mt5FileError);
    expect(() => parseMt5File("[1,2,3]")).toThrow(/not a JSON object/);
  });
  it("rejects an oversize file", async () => {
    process.env.MT5_FILE = write(" ".repeat(1_000_001));
    await expect(mt5Summary()).rejects.toThrow(/larger than/);
  });
  it("drops fields the schema doesn't define (nothing extra is passed on)", async () => {
    const o: any = sample(); o.secretNote = "hi"; o.positions[0].comment = "my strategy"; o.account.name = "Someone";
    process.env.MT5_FILE = write(o);
    expect(JSON.stringify(await mt5Summary())).not.toMatch(/secretNote|my strategy|Someone/);
  });
});
