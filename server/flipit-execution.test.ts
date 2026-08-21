import { describe, it, expect } from "vitest";
import { FlipItExecutionEngine, submitPolymarketClobOrder } from "./flipit-execution.ts";

describe("FlipIt Execution Engine & Polymarket CLOB Adapter", () => {
  it("submits paper orders cleanly when credentials are absent", async () => {
    const res = await submitPolymarketClobOrder({
      tokenId: "0x1234567890abcdef",
      price: 0.55,
      size: 100,
      side: "BUY",
    });

    expect(res.success).toBe(true);
    expect(res.mode).toBe("paper");
    expect(res.orderId).toContain("poly_paper_");
  });

  it("submits live orders with proper Polymarket signature headers", async () => {
    const mockFetcher = async (url: any, init: any) => {
      expect(url).toContain("clob.polymarket.com/order");
      expect(init.headers.POLY_ADDRESS).toBe("0xmy_polymarket_wallet_address");
      expect(init.headers.POLY_SIGNATURE).toBe("my_poly_api_key");
      return {
        ok: true,
        json: async () => ({
          orderID: "0xlive_poly_order_998877",
          status: "MATCHED",
        }),
      } as any;
    };

    const res = await submitPolymarketClobOrder(
      {
        tokenId: "0x1234567890abcdef",
        price: 0.62,
        size: 50,
        side: "BUY",
      },
      {
        address: "0xmy_polymarket_wallet_address",
        apiKey: "my_poly_api_key",
      },
      { fetcher: mockFetcher as any }
    );

    expect(res.success).toBe(true);
    expect(res.mode).toBe("live");
    expect(res.orderId).toBe("0xlive_poly_order_998877");
  });

  it("executes arbitrage order sized by Kelly risk shield", () => {
    const engine = new FlipItExecutionEngine({ startingCapitalGbp: 1000, mode: "paper" });
    let emittedOrder: any = null;

    engine.on("trade_executed", (ord) => {
      emittedOrder = ord;
    });

    const order = engine.executeArbitrage("BTC/GBP", "binance", "kraken", 0.005, 52000, 51740);
    expect(order).toBeDefined();
    expect(order?.status).toBe("FILLED");
    expect(order?.amountGbp).toBeGreaterThan(10);
    expect(emittedOrder).toBeDefined();
  });
});
