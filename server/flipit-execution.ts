import { EventEmitter } from "node:events";
import { type OrderBookTick } from "./flipit-ingest.ts";
import { type SentimentSignal } from "./flipit-oracle.ts";
import { computeKellyRiskShield } from "./flipit-scale.ts";

export interface ExecutionOptions {
  startingCapitalGbp: number;
}

export interface TradeOrder {
  id: string;
  asset: string;
  direction: "BUY" | "SELL";
  amountGbp: number;
  routes: Array<{ exchange: string; allocationPct: number; expectedPrice: number }>;
  timestamp: number;
}

/**
 * The Strategy & Execution Engine (Smart Order Router).
 * Subscribes to the Ingestion Engine (Ticks) and the Oracle (Sentiment).
 * Evaluates real-time opportunities and routes trades across multiple exchanges
 * to minimize slippage, while gating them through the Risk Manager.
 */
export class FlipItExecutionEngine extends EventEmitter {
  private capitalGbp: number;
  private currentSentiment: SentimentSignal | null = null;
  private activeOrders: Map<string, TradeOrder> = new Map();
  private lastTickCache: Map<string, OrderBookTick> = new Map();

  constructor(options: ExecutionOptions) {
    super();
    this.capitalGbp = options.startingCapitalGbp;
  }

  /**
   * Called by the main loop to ingest a new market tick.
   */
  public onTick(tick: OrderBookTick) {
    this.lastTickCache.set(`${tick.exchange}:${tick.pair}`, tick);
    
    // Evaluate cross-exchange arbitrage if we have ticks from both Binance and Kraken
    if (tick.pair === "BTC/GBP") {
      this.evaluateArbitrage("BTC/GBP");
    }
  }

  /**
   * Called by the main loop when the Oracle issues a new sentiment score.
   */
  public onSentiment(signal: SentimentSignal) {
    this.currentSentiment = signal;
    console.log(`[EXECUTION] Updated global risk scalar based on sentiment: ${signal.score}`);
    // If extreme fear, we might liquidate or tighten risk parameters.
    if (signal.score < -0.5) {
      console.log(`[EXECUTION] ⚠️ Extreme Fear Detected! Tightening Kelly risk constraints.`);
    }
  }

  private evaluateArbitrage(pair: string) {
    const binance = this.lastTickCache.get(`binance:${pair}`);
    const kraken = this.lastTickCache.get(`kraken:${pair}`);

    if (!binance || !kraken) return;

    // Check age of ticks to prevent stale arb execution
    const now = Date.now();
    if (now - binance.timestamp > 1000 || now - kraken.timestamp > 1000) return;

    // Arb condition: Binance Bid > Kraken Ask
    const spread1 = binance.bid - kraken.ask;
    const spreadPct1 = spread1 / kraken.ask;

    // Arb condition: Kraken Bid > Binance Ask
    const spread2 = kraken.bid - binance.ask;
    const spreadPct2 = spread2 / binance.ask;

    const threshold = 0.001; // 10 bps threshold

    if (spreadPct1 > threshold) {
      this.executeArbitrage(pair, "binance", "kraken", spreadPct1, binance.bid, kraken.ask);
    } else if (spreadPct2 > threshold) {
      this.executeArbitrage(pair, "kraken", "binance", spreadPct2, kraken.bid, binance.ask);
    }
  }

  private executeArbitrage(pair: string, sellEx: string, buyEx: string, spreadPct: number, sellPrice: number, buyPrice: number) {
    console.log(`[EXECUTION] ⚡ ARB FOUND: ${pair} | Buy on ${buyEx} @ ${buyPrice}, Sell on ${sellEx} @ ${sellPrice} (Spread: ${(spreadPct * 100).toFixed(2)}%)`);

    // 1. Ask Risk Manager for Kelly sizing
    // In a real system, we'd pass historical stats. We mock them here.
    const riskShield = computeKellyRiskShield({
      currentEquityGbp: this.capitalGbp,
      peakEquityGbp: this.capitalGbp * 1.05,
      winRate: 0.65,
      avgWinGbp: 150,
      avgLossGbp: 80,
      maxDrawdownThresholdPct: 5.0
    });

    if (riskShield.status === "DRAWDOWN_HALT" || riskShield.status === "INSUFFICIENT_DATA") {
      this.emit("execution_rejected", {
        reason: `Risk Gate: ${riskShield.status}`
      });
      return;
    }

    let tradeSize = riskShield.recommendedTradeSizeGbp;

    // 2. Adjust for AI Sentiment
    if (this.currentSentiment) {
      if (this.currentSentiment.score < -0.3) {
        tradeSize *= 0.5; // Halve size on fear
      } else if (this.currentSentiment.score > 0.3) {
        tradeSize *= 1.2; // Boost size on greed
      }
    }

    if (tradeSize < 10) return; // Minimum order size

    const orderId = `ARB-${Date.now()}`;
    const order: TradeOrder = {
      id: orderId,
      asset: pair,
      direction: "BUY", // Leg 1 (simplified representation)
      amountGbp: tradeSize,
      routes: [
        { exchange: buyEx, allocationPct: 100, expectedPrice: buyPrice }
      ],
      timestamp: Date.now()
    };

    this.activeOrders.set(orderId, order);
    console.log(`[EXECUTION] 🚀 Executed order ${orderId} for £${tradeSize.toFixed(2)}`);
    
    // Broadcast trade event to update ledger/UI
    this.emit("trade_executed", order);
  }
}
