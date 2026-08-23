import { EventEmitter } from "node:events";
import { type OrderBookTick } from "./flipit-ingest.ts";
import { type PolymarketOrderParams } from "./flipit-execution.ts";

export class FlipItLocalSimulator extends EventEmitter {
  private mockDelayMs: number;

  constructor(options: { mockDelayMs?: number } = {}) {
    super();
    this.mockDelayMs = options.mockDelayMs ?? 100;
  }

  public getMockFetcher(): typeof fetch {
    return async (url: string | URL | globalThis.Request, options?: RequestInit): Promise<Response> => {
      const urlStr = url.toString();

      // Delay to simulate network
      await new Promise((r) => setTimeout(r, this.mockDelayMs));

      if (urlStr.includes("clob.polymarket.com/order")) {
        const body = options?.body ? JSON.parse(String(options.body)) : {};
        
        let isAuth = false;
        if (options && options.headers) {
           isAuth = "POLY_SIGNATURE" in options.headers;
        }

        if (!isAuth) {
          return new Response(JSON.stringify({ error: "Missing POLY_SIGNATURE" }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }

        const mockOrderId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.emit("order_placed", { ...body, orderID: mockOrderId });

        return new Response(JSON.stringify({
          orderID: mockOrderId,
          status: "simulated_accepted",
          token_id: body.token_id,
          size: body.size,
          side: body.side
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ error: "Not Found" }), { status: 404 });
    };
  }

  public simulateOrderBookTick(exchange: "binance" | "kraken", pair: string, bid: number, ask: number): OrderBookTick {
    const tick: OrderBookTick = {
      exchange,
      pair,
      bid,
      ask,
      bidVol: 1.0,
      askVol: 1.0,
      timestamp: Date.now()
    };
    this.emit("tick", tick);
    return tick;
  }
}
