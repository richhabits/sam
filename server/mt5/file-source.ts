// ─────────────────────────────────────────────────────────────
//  S.A.M. · MT5 file source — the ONLY real MT5 source.
//
//  Reads the JSON that the FlipItReporter Expert Advisor (FLIP IT repo, mt5/) writes from inside a
//  MetaTrader 5 terminal. There is deliberately NO simulated source in the product: with nothing
//  configured SAM says "not connected" instead of showing numbers that are not yours.
//
//  The file comes from a program running in a terminal SAM cannot see, so it is treated as UNTRUSTED
//  input: strict schema (flipit-mt5/1), finite numbers, a MASKED login only, hard size/row caps, and
//  unknown fields ignored. Real-money accounts are reported as non-demo (and refused upstream unless
//  MT5_ALLOW_LIVE_READ=1). Mirrors scripts/mt5_validate.py in the FLIP IT repo.
//
//  Read-only by construction: this module only ever calls fs.readFileSync / statSync.
// ─────────────────────────────────────────────────────────────

import { readFileSync, statSync } from "node:fs";
import type { Mt5Account, Mt5Deal, Mt5Position, Mt5Quote, Mt5ReadAdapter } from "./adapter.ts";

export const MT5_SCHEMA = "flipit-mt5/1";
const MAX_BYTES = 1_000_000;
const MAX_POSITIONS = 200;
const MAX_DEALS = 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MASKED = /^\*\*\*\d{1,3}$/;
const MODES = ["demo", "contest", "real", "unknown"];

/** Nothing is configured, or the terminal has not written its first file yet. Not a failure — an honest empty state. */
export class Mt5NotConnected extends Error {
  constructor(message: string) { super(message); this.name = "Mt5NotConnected"; }
}
/** The file exists but is not a valid flipit-mt5/1 document. Loud, never guessed around. */
export class Mt5FileError extends Error {
  constructor(message: string) { super(message); this.name = "Mt5FileError"; }
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const cleanStr = (v: unknown, max = 64): v is string => typeof v === "string" && v.length <= max && ![...v].some((c) => c.charCodeAt(0) < 32);
const optNum = (v: unknown) => v === null || v === undefined || finite(v);

export interface Mt5File {
  asOf: string;
  server: string;
  account: Mt5Account;
  positions: Mt5Position[];
  deals: Mt5Deal[];
}

export function parseMt5File(raw: string): Mt5File {
  let o: any;
  try { o = JSON.parse(raw); } catch (e: any) { throw new Mt5FileError(`the MT5 file is not valid JSON (${e?.message}) — it may be half-written`); }
  const errs: string[] = [];
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Mt5FileError("the MT5 file is not a JSON object");
  if (o.schema !== MT5_SCHEMA) errs.push(`schema must be "${MT5_SCHEMA}"`);
  if (!(typeof o.asOf === "string" && ISO.test(o.asOf))) errs.push("asOf must be an ISO-8601 UTC timestamp");
  const a = o.account;
  if (!a || typeof a !== "object") errs.push("account missing");
  else {
    if (!(typeof a.loginMasked === "string" && MASKED.test(a.loginMasked))) errs.push("account.loginMasked must look like ***123 — a full account number is never accepted");
    if (!(typeof a.currency === "string" && /^[A-Za-z]{2,6}$/.test(a.currency))) errs.push("account.currency invalid");
    for (const k of ["balance", "equity", "margin", "freeMargin"]) if (!finite(a[k])) errs.push(`account.${k} must be a finite number`);
    if (!(isInt(a.leverage) && a.leverage >= 0)) errs.push("account.leverage invalid");
    if (!MODES.includes(a.mode)) errs.push("account.mode invalid");
  }
  if (!Array.isArray(o.positions)) errs.push("positions must be a list");
  else if (o.positions.length > MAX_POSITIONS) errs.push(`more than ${MAX_POSITIONS} positions`);
  if (!Array.isArray(o.deals)) errs.push("deals must be a list");
  else if (o.deals.length > MAX_DEALS) errs.push(`more than ${MAX_DEALS} deals`);
  if (errs.length) throw new Mt5FileError(errs.slice(0, 6).join("; "));

  const positions: Mt5Position[] = o.positions.map((p: any, i: number) => {
    const bad = !p || typeof p !== "object" || !isInt(p.ticket) || !cleanStr(p.symbol) || !["buy", "sell"].includes(p.side)
      || !["volume", "openPrice", "price", "profit"].every((k) => finite(p[k])) || !optNum(p.sl) || !optNum(p.tp) || !(typeof p.openedAt === "string" && ISO.test(p.openedAt));
    if (bad) throw new Mt5FileError(`positions[${i}] is malformed`);
    return { ticket: String(p.ticket), symbol: p.symbol, side: p.side, volume: p.volume, openPrice: p.openPrice, currentPrice: p.price,
             profit: p.profit, openedAt: p.openedAt, ...(p.sl ? { sl: p.sl } : {}), ...(p.tp ? { tp: p.tp } : {}) };
  });
  const deals: Mt5Deal[] = o.deals.map((d: any, i: number) => {
    const bad = !d || typeof d !== "object" || !isInt(d.ticket) || !cleanStr(d.symbol) || !["buy", "sell"].includes(d.side)
      || !["volume", "price", "profit", "commission", "swap"].every((k) => finite(d[k])) || !(typeof d.closedAt === "string" && ISO.test(d.closedAt));
    if (bad) throw new Mt5FileError(`deals[${i}] is malformed`);
    // Realised P/L is profit + commission + swap (the EA exports them separately; commission/swap are negative costs).
    return { ticket: String(d.ticket), symbol: d.symbol, side: d.side, volume: d.volume, closePrice: d.price,
             profit: d.profit + d.commission + d.swap, closedAt: d.closedAt };
  });
  const server = cleanStr(o.terminal?.server) ? o.terminal.server : "";
  return {
    asOf: o.asOf, server, positions, deals,
    account: { login: a.loginMasked, server, currency: a.currency, balance: a.balance, equity: a.equity, margin: a.margin,
               freeMargin: a.freeMargin, leverage: a.leverage, demo: a.mode === "demo" || a.mode === "contest" },
  };
}

/** Adapter over the reporter's file. Re-reads on every call so it is always the latest thing the terminal wrote. */
export function createFileAdapter(path: string): Mt5ReadAdapter {
  const load = (): Mt5File => {
    let raw: string;
    try {
      if (statSync(path).size > MAX_BYTES) throw new Mt5FileError(`the MT5 file is larger than ${MAX_BYTES} bytes`);
      raw = readFileSync(path, "utf8");
    } catch (e: any) {
      if (e instanceof Mt5FileError) throw e;
      if (e?.code === "ENOENT") throw new Mt5NotConnected(`MT5_FILE points at ${path}, which doesn't exist yet. Is MetaTrader 5 running with the FlipItReporter EA attached?`);
      throw new Mt5FileError(`couldn't read the MT5 file (${e?.code || e?.message})`);
    }
    return parseMt5File(raw);
  };
  return {
    name: "file:mt5.json",
    readOnly: true,
    async getAccount() { return load().account; },
    async getPositions() { return load().positions; },
    async getHistory(sinceMs: number) { return load().deals.filter((d) => Date.parse(d.closedAt) >= sinceMs); },
    async getQuote(_symbol: string): Promise<Mt5Quote> { throw new Error("Live quotes aren't available from the reporter file."); },
    async asOf() { return load().asOf; },
  };
}
