import { describe, it, expect } from "vitest";
import {
  toBinanceSymbol,
  toKrakenSymbol,
  parseBinanceTick,
  parseKrakenTick,
  fetchBinanceRestTick,
  fetchKrakenRestTick,
  FlipItIngestEngine,
} from "./flipit-ingest.ts";

describe("FlipIt Real-Time Market Data Ingestion Engine", () => {
  it("converts SAM pair format to Binance stream symbol", () => {
    expect(toBinanceSymbol("BTC/GBP")).toBe("btcgbp");
    expect(toBinanceSymbol("ETH/USD")).toBe("ethusd");
  });

  it("converts SAM pair format to Kraken symbol", () => {
    expect(toKrakenSymbol("btc/gbp")).toBe("BTC/GBP");
  });

  it("parses a real Binance bookTicker message", () => {
    const raw = JSON.stringify({
      u: 400900217,
      s: "BTCGBP",
      b: "52100.50",
      B: "1.234",
      a: "52101.80",
      A: "0.876",
    });
    const tick = parseBinanceTick(raw, "BTC/GBP");
    expect(tick).toBeDefined();
    expect(tick!.exchange).toBe("binance");
    expect(tick!.pair).toBe("BTC/GBP");
    expect(tick!.bid).toBe(52100.5);
    expect(tick!.ask).toBe(52101.8);
    expect(tick!.bidVol).toBe(1.234);
    expect(tick!.askVol).toBe(0.876);
  });

  it("parses a real Kraken v2 ticker message", () => {
    const raw = JSON.stringify({
      channel: "ticker",
      type: "update",
      data: [
        {
          symbol: "BTC/GBP",
          bid: 52000.0,
          ask: 52005.5,
          bid_qty: 2.5,
          ask_qty: 1.8,
          last: 52002.0,
          volume: 1234.56,
        },
      ],
    });
    const tick = parseKrakenTick(raw, "BTC/GBP");
    expect(tick).toBeDefined();
    expect(tick!.exchange).toBe("kraken");
    expect(tick!.bid).toBe(52000.0);
    expect(tick!.ask).toBe(52005.5);
  });

  it("returns null for non-ticker Kraken messages", () => {
    const heartbeat = JSON.stringify({ channel: "heartbeat" });
    expect(parseKrakenTick(heartbeat, "BTC/GBP")).toBeNull();
  });

  it("fetches Binance REST ticker with mock fetcher", async () => {
    const mockFetcher = async (url: any) => {
      expect(url).toContain("api.binance.com");
      expect(url).toContain("BTCGBP");
      return {
        ok: true,
        json: async () => ({
          symbol: "BTCGBP",
          bidPrice: "52100.00",
          bidQty: "1.5",
          askPrice: "52102.00",
          askQty: "0.9",
        }),
      } as any;
    };
    const tick = await fetchBinanceRestTick("BTC/GBP", { fetcher: mockFetcher as any });
    expect(tick).toBeDefined();
    expect(tick!.bid).toBe(52100);
    expect(tick!.ask).toBe(52102);
  });

  it("fetches Kraken REST ticker with mock fetcher", async () => {
    const mockFetcher = async (url: any) => {
      expect(url).toContain("api.kraken.com");
      return {
        ok: true,
        json: async () => ({
          error: [],
          result: {
            XBTGBP: {
              a: ["52105.00", "1", "1.000"],
              b: ["52100.00", "2", "2.000"],
            },
          },
        }),
      } as any;
    };
    const tick = await fetchKrakenRestTick("BTC/GBP", { fetcher: mockFetcher as any });
    expect(tick).toBeDefined();
    expect(tick!.exchange).toBe("kraken");
    expect(tick!.bid).toBe(52100);
    expect(tick!.ask).toBe(52105);
  });

  it("instantiates engine and stops cleanly without connecting", () => {
    const engine = new FlipItIngestEngine({ pairs: ["BTC/GBP"], exchanges: [] });
    engine.start();
    engine.stop();
    // No crash, no hanging intervals
  });
});
