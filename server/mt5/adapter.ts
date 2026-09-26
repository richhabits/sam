// ─────────────────────────────────────────────────────────────
//  S.A.M. · MT5 ADAPTER  — Phase 1: READ-ONLY.
//  The one interface every MetaTrader 5 backend (mock, MetaApi, a self-hosted bridge) implements.
//
//  DELIBERATELY NO WRITE METHODS. There is no placeOrder / closePosition / modify here, so no
//  code holding an adapter can submit a trade — the type system is the guard, not a prompt or a
//  flag. Order placement is a later phase with its own consent gate and its own interface;
//  it must not be bolted onto this one. Independent of server/flipit-*.ts, which stays untouched.
// ─────────────────────────────────────────────────────────────

export type Mt5Side = "buy" | "sell";

export interface Mt5Account {
  login: string;
  server: string;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  leverage: number;
  /** true = demo/paper account. Live accounts are refused by the tools unless explicitly allowed. */
  demo: boolean;
}

export interface Mt5Position {
  ticket: string;
  symbol: string;
  side: Mt5Side;
  volume: number;        // lots
  openPrice: number;
  currentPrice: number;
  profit: number;        // floating P/L in account currency
  openedAt: string;      // ISO
  sl?: number;
  tp?: number;
}

export interface Mt5Deal {
  ticket: string;
  symbol: string;
  side: Mt5Side;
  volume: number;
  /** Not every source knows the opening leg of a deal (the reporter EA exports CLOSING deals only). */
  openPrice?: number;
  closePrice: number;
  profit: number;        // realised P/L in account currency (after swap/commission)
  openedAt?: string;     // ISO — optional for the same reason
  closedAt: string;      // ISO
}

export interface Mt5Quote {
  symbol: string;
  bid: number;
  ask: number;
  time: string;          // ISO
}

export interface Mt5ReadAdapter {
  readonly name: string;
  /** Always true. Present so a future writable adapter can never be passed here by accident. */
  readonly readOnly: true;
  getAccount(): Promise<Mt5Account>;
  getPositions(): Promise<Mt5Position[]>;
  /** Closed deals with closedAt >= sinceMs (epoch ms). */
  getHistory(sinceMs: number): Promise<Mt5Deal[]>;
  getQuote(symbol: string): Promise<Mt5Quote>;
  /** When the numbers were TAKEN (ISO UTC), if the source knows — lets callers say "as of" and flag staleness. */
  asOf?(): Promise<string | undefined>;
}
