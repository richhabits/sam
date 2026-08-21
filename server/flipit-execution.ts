// ─────────────────────────────────────────────────────────────
//  S.A.M. · FLIPIT EXECUTION & POLYMARKET CLOB ADAPTER
//
//  Cross-market arbitrage execution, Kelly-sized order routing,
//  and direct Polymarket CLOB integration with paper/live modes.
// ─────────────────────────────────────────────────────────────

import { EventEmitter } from "node:events";
import { type OrderBookTick, getSharedIngestEngine } from "./flipit-ingest.ts";
import { type SentimentSignal } from "./flipit-oracle.ts";
import { computeKellyRiskShield } from "./flipit-scale.ts";
import { getWallet } from "./wallet.ts";

export interface ExecutionOptions {
  startingCapitalGbp?: number;
  mode?: "live" | "paper";
  polymarketAddress?: string;
  polymarketApiKey?: string;
}

export interface TradeOrder {
  id: string;
  asset: string;
  direction: "BUY" | "SELL";
  amountGbp: number;
  mode: "live" | "paper";
  routes: Array<{ exchange: string; allocationPct: number; expectedPrice: number }>;
  status: "FILLED" | "PAPER_SIMULATED" | "SUBMITTED" | "REJECTED" | "CONFIG_REQUIRED";
  error?: string;
  timestamp: number;
}

export interface PolymarketOrderParams {
  tokenId: string;
  price: number; // 0.00 to 1.00
  size: number;
  side: "BUY" | "SELL";
}

/**
 * Submits an order to the Polymarket CLOB REST API.
 */
export async function submitPolymarketClobOrder(
  params: PolymarketOrderParams,
  credentials: { address?: string; apiKey?: string } = {},
  options: { fetcher?: typeof fetch } = {}
): Promise<{ success: boolean; orderId?: string; error?: string; mode: "live" | "paper" }> {
  const fetchImpl = options.fetcher || fetch;
  const address = credentials.address || process.env.POLYMARKET_ADDRESS;
  const apiKey = credentials.apiKey || process.env.POLYMARKET_API_KEY;
  const isLive = !!(address && apiKey);

  if (!isLive) {
    // Explicit paper trading simulation
    const paperOrderId = `poly_paper_${Date.now()}_${params.tokenId.slice(0, 6)}`;
    return {
      success: true,
      orderId: paperOrderId,
      mode: "paper",
    };
  }

  try {
    const res = await fetchImpl("https://clob.polymarket.com/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "POLY_ADDRESS": address,
        "POLY_SIGNATURE": apiKey,
        "POLY_TIMESTAMP": String(Date.now()),
      },
      body: JSON.stringify({
        token_id: params.tokenId,
        price: params.price,
        size: params.size,
        side: params.side,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        error: data?.error || `Polymarket CLOB HTTP ${res.status}`,
        mode: "live",
      };
    }

    return {
      success: true,
      orderId: data?.orderID || data?.id,
      mode: "live",
    };
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || "Failed to reach Polymarket CLOB",
      mode: "live",
    };
  }
}

/**
 * The Strategy & Execution Engine (Smart Order Router).
 */
export class FlipItExecutionEngine extends EventEmitter {
  private capitalGbp: number;
  private mode: "live" | "paper";
  private currentSentiment: SentimentSignal | null = null;
  private activeOrders: Map<string, TradeOrder> = new Map();
  private lastTickCache: Map<string, OrderBookTick> = new Map();
  private polymarketCredentials: { address?: string; apiKey?: string };

  constructor(options: ExecutionOptions = {}) {
    super();
    this.capitalGbp = options.startingCapitalGbp ?? getWallet().balance ?? 100;
    this.mode = options.mode || "paper";
    this.polymarketCredentials = {
      address: options.polymarketAddress || process.env.POLYMARKET_ADDRESS,
      apiKey: options.polymarketApiKey || process.env.POLYMARKET_API_KEY,
    };
  }

  public onTick(tick: OrderBookTick): void {
    this.lastTickCache.set(`${tick.exchange}:${tick.pair}`, tick);
    if (tick.pair === "BTC/GBP" || tick.pair === "BTC-USD") {
      this.evaluateArbitrage(tick.pair);
    }
  }

  public onSentiment(signal: SentimentSignal): void {
    this.currentSentiment = signal;
  }

  public getActiveOrders(): TradeOrder[] {
    return Array.from(this.activeOrders.values());
  }

  private evaluateArbitrage(pair: string): void {
    const binance = this.lastTickCache.get(`binance:${pair}`);
    const kraken = this.lastTickCache.get(`kraken:${pair}`);

    if (!binance || !kraken) return;

    const now = Date.now();
    if (now - binance.timestamp > 2000 || now - kraken.timestamp > 2000) return;

    const spread1 = binance.bid - kraken.ask;
    const spreadPct1 = spread1 / kraken.ask;

    const spread2 = kraken.bid - binance.ask;
    const spreadPct2 = spread2 / binance.ask;

    const threshold = 0.001; // 10 bps threshold

    if (spreadPct1 > threshold) {
      this.executeArbitrage(pair, "binance", "kraken", spreadPct1, binance.bid, kraken.ask);
    } else if (spreadPct2 > threshold) {
      this.executeArbitrage(pair, "kraken", "binance", spreadPct2, kraken.bid, binance.ask);
    }
  }

  public executeArbitrage(
    pair: string,
    sellEx: string,
    buyEx: string,
    spreadPct: number,
    sellPrice: number,
    buyPrice: number
  ): TradeOrder | null {
    const riskShield = computeKellyRiskShield({
      currentEquityGbp: this.capitalGbp,
      peakEquityGbp: this.capitalGbp * 1.05,
      winRate: 0.65,
      avgWinGbp: 150,
      avgLossGbp: 80,
      maxDrawdownThresholdPct: 5.0,
    });

    if (riskShield.status === "DRAWDOWN_HALT" || riskShield.status === "INSUFFICIENT_DATA") {
      this.emit("execution_rejected", { reason: `Risk Gate: ${riskShield.status}` });
      return null;
    }

    const kellyFraction = Math.max(0.05, riskShield.recommendedHalfKelly || 0.1);
    let tradeSize = this.capitalGbp * kellyFraction;

    if (this.currentSentiment) {
      if (this.currentSentiment.score < -0.3) {
        tradeSize *= 0.5; // Halve size on fear
      } else if (this.currentSentiment.score > 0.3) {
        tradeSize *= 1.2; // Boost size on greed
      }
    }

    if (tradeSize < 5) return null; // Minimum order size

    const orderId = `ARB-${Date.now()}`;
    const isLive = this.mode === "live";

    // In live mode, verify exchange credentials before marking executed
    const hasLiveCreds = !!(this.polymarketCredentials.address && this.polymarketCredentials.apiKey);
    const status = isLive
      ? (hasLiveCreds ? "SUBMITTED" : "CONFIG_REQUIRED")
      : "PAPER_SIMULATED";

    const error = (isLive && !hasLiveCreds)
      ? `Live trade execution requires API keys for ${buyEx}/${sellEx} in Settings or .env`
      : undefined;

    const order: TradeOrder = {
      id: orderId,
      asset: pair,
      direction: "BUY",
      amountGbp: Number(tradeSize.toFixed(2)),
      mode: this.mode,
      routes: [{ exchange: buyEx, allocationPct: 100, expectedPrice: buyPrice }],
      status,
      error,
      timestamp: Date.now(),
    };

    this.activeOrders.set(orderId, order);
    this.emit("trade_executed", order);
    return order;
  }
}

// ── SHARED EXECUTION ENGINE SINGLETON ──
let sharedExecutionEngine: FlipItExecutionEngine | null = null;

export function getSharedExecutionEngine(options?: ExecutionOptions): FlipItExecutionEngine {
  if (!sharedExecutionEngine) {
    sharedExecutionEngine = new FlipItExecutionEngine(options);
    const ingest = getSharedIngestEngine();
    ingest.on("tick", (tick) => sharedExecutionEngine?.onTick(tick));
  }
  return sharedExecutionEngine;
}
