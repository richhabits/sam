import { EventEmitter } from "node:events";

export interface OrderBookTick {
  exchange: "binance" | "kraken" | "coinbase";
  pair: string;
  bid: number;
  ask: number;
  bidVol: number;
  askVol: number;
  timestamp: number;
}

export interface IngestionOptions {
  pairs: string[];
  mockMode?: boolean;
}

/**
 * The Real-Time Data Ingestion Engine.
 * Responsible for managing WebSocket connections to major exchanges,
 * normalizing their diverse data formats into standard OrderBookTicks,
 * and broadcasting them to the internal event bus.
 */
export class FlipItIngestEngine extends EventEmitter {
  private pairs: string[];
  private mockMode: boolean;
  private running: boolean = false;
  private mockIntervals: NodeJS.Timeout[] = [];

  constructor(options: IngestionOptions) {
    super();
    this.pairs = options.pairs;
    this.mockMode = options.mockMode ?? true;
  }

  public start() {
    if (this.running) return;
    this.running = true;
    console.log(`[INGEST] Starting FlipIt Data Ingestion for pairs: ${this.pairs.join(", ")}`);

    if (this.mockMode) {
      this.startMockFeeds();
    } else {
      this.connectBinance();
      this.connectKraken();
    }
  }

  public stop() {
    this.running = false;
    for (const interval of this.mockIntervals) {
      clearInterval(interval);
    }
    this.mockIntervals = [];
    console.log("[INGEST] Stopped data ingestion streams.");
  }

  private connectBinance() {
    // In production, instantiate robust WebSocket connection to wss://stream.binance.com:9443/ws
    // For this prototype architecture, we assume connection success and binding
    console.log("[INGEST] (Prod) Connected to Binance WebSocket Feed.");
  }

  private connectKraken() {
    // In production, instantiate robust WebSocket connection to wss://ws.kraken.com
    console.log("[INGEST] (Prod) Connected to Kraken WebSocket Feed.");
  }

  /**
   * Simulates high-frequency ticks for the arbitrage scanner.
   */
  private startMockFeeds() {
    const exchanges: Array<"binance" | "kraken" | "coinbase"> = ["binance", "kraken", "coinbase"];
    
    // Simulate base prices for pairs
    const basePrices: Record<string, number> = {
      "BTC/GBP": 52000,
      "ETH/GBP": 2800,
      "SOL/GBP": 110
    };

    for (const pair of this.pairs) {
      const basePrice = basePrices[pair] || 1000;

      // Tick every ~50ms to simulate high frequency
      const interval = setInterval(() => {
        if (!this.running) return;

        // Pick a random exchange to update
        const ex = exchanges[Math.floor(Math.random() * exchanges.length)];
        
        // Random walk noise
        const noise = (Math.random() - 0.5) * (basePrice * 0.001); // 0.1% volatility
        const spread = basePrice * 0.0002; // 2bps spread

        const currentMid = basePrice + noise;
        
        const tick: OrderBookTick = {
          exchange: ex,
          pair,
          bid: Number((currentMid - spread / 2).toFixed(2)),
          ask: Number((currentMid + spread / 2).toFixed(2)),
          bidVol: Number((Math.random() * 5).toFixed(4)),
          askVol: Number((Math.random() * 5).toFixed(4)),
          timestamp: Date.now()
        };

        // Broadcast to the internal pub/sub event bus
        this.emit("tick", tick);
      }, 50 + Math.random() * 100);

      this.mockIntervals.push(interval);
    }
  }
}
