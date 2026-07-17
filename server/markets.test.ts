import { describe, expect, it } from "vitest";
import { formatQuotes, parseChart, quotes } from "./markets.ts";

const RUN_LIVE = process.env.MARKETS_LIVE === "1";   // opt-in: hits the network

const chart = (meta: any) => ({ chart: { result: [{ meta }] } });

describe("parseChart", () => {
  it("computes change + percent for an up day", () => {
    const q = parseChart(chart({ symbol: "AAPL", regularMarketPrice: 110, previousClose: 100, currency: "USD", exchangeName: "NMS" }), "aapl");
    expect(q.ok).toBe(true);
    if (q.ok) { expect(q.symbol).toBe("AAPL"); expect(q.change).toBeCloseTo(10); expect(q.changePct).toBeCloseTo(10); }
  });

  it("falls back to chartPreviousClose when previousClose is absent", () => {
    const q = parseChart(chart({ symbol: "X", regularMarketPrice: 95, chartPreviousClose: 100 }), "X");
    expect(q.ok && q.change).toBeCloseTo(-5);
  });

  it("returns an error (not a throw) when the payload has no price", () => {
    const q = parseChart(chart({}), "AAPL");
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.symbol).toBe("AAPL");
  });

  it("surfaces Yahoo's error description for a bad symbol", () => {
    const q = parseChart({ chart: { error: { description: "Not Found" }, result: null } }, "nope");
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.error).toBe("Not Found");
  });
});

describe("formatQuotes", () => {
  it("marks direction and shows non-USD currency", () => {
    const out = formatQuotes([
      { ok: true, symbol: "AAPL", price: 110, currency: "USD", prevClose: 100, change: 10, changePct: 10, exchange: "NMS" },
      { ok: true, symbol: "VUSA.L", price: 105, currency: "GBP", prevClose: 106, change: -1, changePct: -0.94, exchange: "LSE" },
      { ok: false, symbol: "BAD", error: "HTTP 404" },
    ]);
    expect(out).toMatch(/AAPL.*▲ \+10\.00 \(\+10\.00%\)/);
    expect(out).toMatch(/VUSA\.L.*GBP.*▼ -1\.00/);
    expect(out).toMatch(/BAD.*—.*HTTP 404/);
  });

  it("guides the user when no tickers are given", () => {
    expect(formatQuotes([])).toMatch(/AAPL/);
  });
});

describe("quotes (live)", () => {
  (RUN_LIVE ? it : it.skip)("fetches a real keyless quote", async () => {
    const [aapl] = await quotes(["AAPL"]);
    expect(aapl.ok).toBe(true);
    if (aapl.ok) expect(aapl.price).toBeGreaterThan(0);
  }, 15000);
});
