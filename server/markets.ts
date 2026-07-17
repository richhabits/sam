// ── Live market quotes — keyless, free (clean-room port of a financial-terminal's data view) ──
// The genuinely portable part of a Bloomberg-style terminal for a free/local assistant: glanceable
// prices, no API key, no cost. Reimplemented from scratch in SAM's stack — FinceptTerminal is
// AGPL/C++ (the idea is portable, its code is not), and Yahoo's chart endpoint needs no key.
// Works for stocks, ETFs, indices (^GSPC), FX (GBPUSD=X) and crypto (BTC-USD).

export interface Quote {
  ok: true;
  symbol: string;
  price: number;
  currency: string;
  prevClose: number;
  change: number;
  changePct: number;
  exchange: string;
}
export interface QuoteError { ok: false; symbol: string; error: string; }

const UA = "Mozilla/5.0 (SAM markets)";

// Pure parser — separated from the network so it can be unit-tested against a fixture.
export function parseChart(json: any, symbol: string): Quote | QuoteError {
  const m = json?.chart?.result?.[0]?.meta;
  if (!m || typeof m.regularMarketPrice !== "number") {
    const err = json?.chart?.error?.description;
    return { ok: false, symbol: symbol.toUpperCase(), error: err || "no data" };
  }
  const price = m.regularMarketPrice;
  const prev = typeof m.previousClose === "number" ? m.previousClose
    : typeof m.chartPreviousClose === "number" ? m.chartPreviousClose : price;
  const change = price - prev;
  return {
    ok: true,
    symbol: String(m.symbol || symbol).toUpperCase(),
    price, currency: m.currency || "",
    prevClose: prev, change,
    changePct: prev ? (change / prev) * 100 : 0,
    exchange: m.exchangeName || "",
  };
}

async function fetchOne(symbol: string): Promise<Quote | QuoteError> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { ok: false, symbol: symbol.toUpperCase(), error: `HTTP ${r.status}` };
    return parseChart(await r.json(), symbol);
  } catch (e: any) {
    return { ok: false, symbol: symbol.toUpperCase(), error: e?.name === "TimeoutError" ? "timed out" : (e?.message || "failed") };
  }
}

export async function quotes(symbols: string[]): Promise<(Quote | QuoteError)[]> {
  const clean = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  if (!clean.length) return [];
  return Promise.all(clean.map(fetchOne));   // a watchlist is small — parallel keyless calls
}

export function formatQuotes(rows: (Quote | QuoteError)[]): string {
  if (!rows.length) return "No tickers given. Try: AAPL, MSFT, BTC-USD.";
  return rows.map((q) => {
    if (!q.ok) return `${q.symbol.padEnd(8)} —  (${q.error})`;
    const arrow = q.change > 0 ? "▲" : q.change < 0 ? "▼" : "→";
    const sign = q.change > 0 ? "+" : "";
    const cur = q.currency && q.currency !== "USD" ? ` ${q.currency}` : "";
    return `${q.symbol.padEnd(8)} ${q.price.toFixed(2)}${cur}  ${arrow} ${sign}${q.change.toFixed(2)} (${sign}${q.changePct.toFixed(2)}%)`;
  }).join("\n");
}
