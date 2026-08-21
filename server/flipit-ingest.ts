// ─────────────────────────────────────────────────────────────
//  S.A.M. · FLIPIT REAL-TIME MARKET DATA INGESTION ENGINE
//
//  Production WebSocket connections to Binance and Kraken for
//  live order book ticker data. Falls back to REST polling when
//  WebSocket is unavailable. No random simulation.
// ─────────────────────────────────────────────────────────────

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
  exchanges?: Array<"binance" | "kraken">;
  restFallbackIntervalMs?: number;
}

export interface IngestStatus {
  running: boolean;
  pairs: string[];
  exchanges: string[];
  activeSocketsCount: number;
  totalTicksReceived: number;
  latestTicks: Record<string, OrderBookTick>;
}

/**
 * Converts a SAM pair format ("BTC/GBP") to Binance stream format ("btcgbp").
 */
export function toBinanceSymbol(pair: string): string {
  return pair.replace("/", "").toLowerCase();
}

/**
 * Converts a SAM pair format ("BTC/GBP") to Kraken API format ("BTC/GBP" — already correct).
 */
export function toKrakenSymbol(pair: string): string {
  return pair.toUpperCase();
}

/**
 * Parses a Binance bookTicker WebSocket message into an OrderBookTick.
 */
export function parseBinanceTick(data: any, pair: string): OrderBookTick | null {
  try {
    const msg = typeof data === "string" ? JSON.parse(data) : data;
    if (!msg || typeof msg.b !== "string") return null;
    return {
      exchange: "binance",
      pair,
      bid: Number(msg.b),
      ask: Number(msg.a),
      bidVol: Number(msg.B),
      askVol: Number(msg.A),
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Parses a Kraken v2 ticker WebSocket message into an OrderBookTick.
 */
export function parseKrakenTick(data: any, pair: string): OrderBookTick | null {
  try {
    const msg = typeof data === "string" ? JSON.parse(data) : data;
    if (msg?.channel !== "ticker" || !msg?.data?.[0]) return null;
    const d = msg.data[0];
    return {
      exchange: "kraken",
      pair,
      bid: Number(d.bid),
      ask: Number(d.ask),
      bidVol: Number(d.bid_qty || 0),
      askVol: Number(d.ask_qty || 0),
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetches a single REST snapshot from Binance's public bookTicker endpoint.
 */
export async function fetchBinanceRestTick(
  pair: string,
  options: { fetcher?: typeof fetch } = {}
): Promise<OrderBookTick | null> {
  const fetchImpl = options.fetcher || fetch;
  const symbol = toBinanceSymbol(pair).toUpperCase();
  try {
    const res = await fetchImpl(
      `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return {
      exchange: "binance",
      pair,
      bid: Number(d.bidPrice),
      ask: Number(d.askPrice),
      bidVol: Number(d.bidQty),
      askVol: Number(d.askQty),
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Fetches a single REST snapshot from Kraken's public ticker endpoint.
 */
export async function fetchKrakenRestTick(
  pair: string,
  options: { fetcher?: typeof fetch } = {}
): Promise<OrderBookTick | null> {
  const fetchImpl = options.fetcher || fetch;
  const krakenPair = pair.replace("/", "");
  try {
    const res = await fetchImpl(
      `https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.error?.length) return null;
    const entries = Object.values(body?.result || {}) as any[];
    if (!entries.length) return null;
    const d = entries[0];
    return {
      exchange: "kraken",
      pair,
      bid: Number(d.b?.[0] || 0),
      ask: Number(d.a?.[0] || 0),
      bidVol: Number(d.b?.[2] || 0),
      askVol: Number(d.a?.[2] || 0),
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * The Real-Time Data Ingestion Engine.
 */
export class FlipItIngestEngine extends EventEmitter {
  private pairs: string[];
  private exchanges: Array<"binance" | "kraken">;
  private running = false;
  private sockets: any[] = [];
  private restIntervals: NodeJS.Timeout[] = [];
  private restFallbackMs: number;
  private latestTicksMap = new Map<string, OrderBookTick>();
  private totalTicksReceivedCount = 0;

  constructor(options: IngestionOptions) {
    super();
    this.pairs = options.pairs;
    this.exchanges = options.exchanges || ["binance", "kraken"];
    this.restFallbackMs = options.restFallbackIntervalMs || 5000;
  }

  public get isRunning(): boolean {
    return this.running;
  }

  public get totalTicks(): number {
    return this.totalTicksReceivedCount;
  }

  public getLatestTick(key: string): OrderBookTick | undefined {
    return this.latestTicksMap.get(key);
  }

  public getLatestTicks(): OrderBookTick[] {
    return Array.from(this.latestTicksMap.values());
  }

  public getStatus(): IngestStatus {
    const ticksObj: Record<string, OrderBookTick> = {};
    for (const [k, v] of this.latestTicksMap.entries()) {
      ticksObj[k] = v;
    }

    return {
      running: this.running,
      pairs: [...this.pairs],
      exchanges: [...this.exchanges],
      activeSocketsCount: this.sockets.length,
      totalTicksReceived: this.totalTicksReceivedCount,
      latestTicks: ticksObj,
    };
  }

  public recordTick(tick: OrderBookTick): void {
    this.latestTicksMap.set(`${tick.exchange}:${tick.pair}`, tick);
    this.totalTicksReceivedCount++;
    this.emit("tick", tick);
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    for (const exchange of this.exchanges) {
      if (exchange === "binance") this.connectBinance();
      if (exchange === "kraken") this.connectKraken();
    }
  }

  public stop(): void {
    this.running = false;
    for (const ws of this.sockets) {
      try {
        if (typeof ws?.close === "function") ws.close();
      } catch { /* ignore */ }
    }
    this.sockets = [];
    for (const interval of this.restIntervals) {
      clearInterval(interval);
    }
    this.restIntervals = [];
  }

  private connectBinance(): void {
    const streams = this.pairs.map((p) => `${toBinanceSymbol(p)}@bookTicker`).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    try {
      const WsConstructor = (globalThis as any).WebSocket;
      if (!WsConstructor) {
        this.startRestFallback("binance");
        return;
      }

      const ws = new WsConstructor(url);
      this.sockets.push(ws);

      ws.onmessage = (event: any) => {
        try {
          const envelope = JSON.parse(event.data?.toString() || "{}");
          const streamName = envelope?.stream || "";
          const matchedPair = this.pairs.find((p) => streamName.startsWith(toBinanceSymbol(p)));
          if (!matchedPair) return;
          const tick = parseBinanceTick(envelope?.data, matchedPair);
          if (tick) this.recordTick(tick);
        } catch { /* malformed frame */ }
      };

      ws.onerror = () => {
        this.startRestFallback("binance");
      };

      ws.onclose = () => {
        if (this.running) {
          setTimeout(() => this.connectBinance(), 3000);
        }
      };
    } catch {
      this.startRestFallback("binance");
    }
  }

  private connectKraken(): void {
    const url = "wss://ws.kraken.com/v2";

    try {
      const WsConstructor = (globalThis as any).WebSocket;
      if (!WsConstructor) {
        this.startRestFallback("kraken");
        return;
      }

      const ws = new WsConstructor(url);
      this.sockets.push(ws);

      ws.onopen = () => {
        try {
          const subscribeMsg = JSON.stringify({
            method: "subscribe",
            params: {
              channel: "ticker",
              symbol: this.pairs.map(toKrakenSymbol),
              event_trigger: "bbo",
            },
          });
          ws.send(subscribeMsg);
        } catch { /* ignore */ }
      };

      ws.onmessage = (event: any) => {
        try {
          const msg = JSON.parse(event.data?.toString() || "{}");
          if (msg?.channel !== "ticker" || !msg?.data?.[0]) return;
          const symbol = msg.data[0]?.symbol || "";
          const matchedPair = this.pairs.find(
            (p) => toKrakenSymbol(p) === symbol || symbol.includes(p.replace("/", ""))
          );
          if (!matchedPair) return;
          const tick = parseKrakenTick(msg, matchedPair);
          if (tick) this.recordTick(tick);
        } catch { /* malformed frame */ }
      };

      ws.onerror = () => {
        this.startRestFallback("kraken");
      };

      ws.onclose = () => {
        if (this.running) {
          setTimeout(() => this.connectKraken(), 3000);
        }
      };
    } catch {
      this.startRestFallback("kraken");
    }
  }

  private startRestFallback(exchange: "binance" | "kraken"): void {
    const fetchFn = exchange === "binance" ? fetchBinanceRestTick : fetchKrakenRestTick;
    const interval = setInterval(async () => {
      if (!this.running) return;
      for (const pair of this.pairs) {
        const tick = await fetchFn(pair);
        if (tick) this.recordTick(tick);
      }
    }, this.restFallbackMs);
    this.restIntervals.push(interval);
  }
}

// ── SHARED INGESTION ENGINE SINGLETON ──
let sharedIngestEngine: FlipItIngestEngine | null = null;

export function getSharedIngestEngine(options?: IngestionOptions): FlipItIngestEngine {
  if (!sharedIngestEngine) {
    sharedIngestEngine = new FlipItIngestEngine(options || { pairs: ["BTC/GBP", "ETH/GBP", "SOL/GBP"] });
  }
  return sharedIngestEngine;
}

export function startSharedIngestEngine(pairs?: string[]): FlipItIngestEngine {
  const engine = getSharedIngestEngine(pairs ? { pairs } : undefined);
  engine.start();
  return engine;
}

export function stopSharedIngestEngine(): void {
  if (sharedIngestEngine) {
    sharedIngestEngine.stop();
  }
}

export function getSharedIngestStatus(): IngestStatus {
  return getSharedIngestEngine().getStatus();
}
