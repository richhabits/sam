import { EventEmitter } from "node:events";

export interface OracleOptions {
  modelName: string;
}

export interface SentimentSignal {
  asset: string;
  score: number; // -1.0 to 1.0 (fear to greed)
  confidence: number;
  sourcesScanned: number;
  timestamp: number;
}

/**
 * The AI Sentiment & LLM Oracle.
 * Interfaces with a local resident LLM (e.g. llama3.2:3b) to parse news,
 * Twitter feeds, and macro data, distilling it into actionable numerical sentiment
 * that the Kelly Criterion engine can use to dynamically adjust risk (e.g., lower risk on fear).
 */
export class FlipItOracleEngine extends EventEmitter {
  private modelName: string;
  private scanning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;

  constructor(options: OracleOptions) {
    super();
    this.modelName = options.modelName;
  }

  public start() {
    if (this.scanning) return;
    this.scanning = true;
    console.log(`[ORACLE] Booting AI Sentiment Oracle using resident model: ${this.modelName}`);

    // Poll sentiment every 5 minutes
    this.scanInterval = setInterval(() => this.scanMarketSentiment(), 300_000);
    
    // Initial scan
    setImmediate(() => this.scanMarketSentiment());
  }

  public stop() {
    this.scanning = false;
    if (this.scanInterval) clearInterval(this.scanInterval);
    console.log("[ORACLE] Sentiment Oracle halted.");
  }

  private async scanMarketSentiment() {
    console.log(`[ORACLE] Scanning external data sources via ${this.modelName}...`);
    
    // In production, this would make an RPC/HTTP call to the local LLM inference server
    // (e.g. Ollama, vLLM) and pass it a prompt with the latest scraped news headlines.
    // We simulate the LLM output here for the architectural prototype.
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate inference latency

    // Simulate varying market regimes (e.g. mostly neutral, sometimes fearful or greedy)
    const rawVal = Math.random();
    let score = 0;
    if (rawVal > 0.9) score = 0.8; // High Greed
    else if (rawVal < 0.1) score = -0.8; // High Fear
    else score = (Math.random() - 0.5) * 0.4; // Neutral/Choppy (-0.2 to 0.2)

    const signal: SentimentSignal = {
      asset: "MACRO_CRYPTO",
      score: Number(score.toFixed(3)),
      confidence: Number((0.6 + Math.random() * 0.3).toFixed(2)),
      sourcesScanned: Math.floor(Math.random() * 500) + 100,
      timestamp: Date.now()
    };

    console.log(`[ORACLE] Generated sentiment signal: ${signal.score} (Confidence: ${signal.confidence})`);
    
    // Broadcast the signal so the Execution Engine / Risk Manager can consume it
    this.emit("sentiment", signal);
  }
}
