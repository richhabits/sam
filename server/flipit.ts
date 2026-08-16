// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE MONEY DESK  (read model)
//
//  A READ-ONLY window onto the sibling £5 money rig. This module opens files
//  for READING and nothing else — it never writes, never repairs, never shells
//  out, and imports nothing from the rig. If the rig's state is missing or
//  corrupt, every affected key degrades to null and the rest still serves; a
//  partial read is a render problem, never a 500.
//
//  Its real job is the WATCHDOG. The rig steps forward on a weekday-evening
//  schedule; a step that silently fails to run is the most expensive failure
//  the desk can catch, because nothing else would say so. `loop.stale` is that
//  alarm, and the schedule maths below (weekends, GMT/BST) is the only genuinely
//  tricky logic here — which is why it's the most heavily tested.
// ─────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { pushNotify } from "./push.ts";

// The rig's own thresholds. Mirrored here so the desk labels a day the same way the
// rig does; they are read-only constants, not settings — the rig remains the authority.
const TARGET_DAYS = 60;
const TARGET_TRADES = 20;
const BAND_SIGMA = 2.0;

const RUN_HOUR = 22;                 // the forward step runs at 22:00, Mon–Fri
const ZONE = "Europe/London";
const GRACE_MS = 90 * 60 * 1000;     // overdue by more than this with no clean step ⇒ stale
const CACHE_MS = 5000;

// ── TIME ─────────────────────────────────────────────────────────────────────
// Everything about the schedule is expressed in the rig's own wall clock, so the
// desk must reason in that zone rather than the host's. These helpers convert
// between an instant and that zone's calendar without pulling in a date library.

export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number; dow: number }

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// The zone's wall-clock reading of an instant. `dow`: 0=Sun … 6=Sat.
export function wallAt(instant: number): Wall {
  const p: Record<string, string> = {};
  for (const part of PARTS.formatToParts(instant)) if (part.type !== "literal") p[part.type] = part.value;
  const y = Number(p.year), mo = Number(p.month), d = Number(p.day);
  // `hour12:false` renders midnight as 24 in some ICU builds — normalise before use.
  const h = Number(p.hour) % 24, mi = Number(p.minute), s = Number(p.second);
  return { y, mo, d, h, mi, s, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

// Offset (ms) the zone is ahead of UTC at `instant`.
function offsetAt(instant: number): number {
  const w = wallAt(instant);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(instant / 1000) * 1000;
}

// The instant at which the given zone-local calendar date reads `h:mi`.
// Safe for the run hour specifically: this zone's clocks shift in the small hours,
// so a 22:00 wall time is never skipped or repeated and needs no ambiguity handling.
export function instantForWall(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
  const noon = Date.UTC(y, mo - 1, d, 12);          // midday is always unambiguous
  return Date.UTC(y, mo - 1, d, h, mi, s) - offsetAt(noon);
}

const isWeekday = (dow: number) => dow >= 1 && dow <= 5;

// Most recent scheduled step at or before `now` (null if none within a fortnight — only
// possible with a nonsense clock, and null is the honest answer rather than a guess).
export function previousRun(now: number): number | null {
  const w = wallAt(now);
  for (let back = 0; back < 14; back++) {
    const probe = Date.UTC(w.y, w.mo - 1, w.d - back);
    const p = wallAt(probe);
    if (!isWeekday(p.dow)) continue;
    const at = instantForWall(p.y, p.mo, p.d, RUN_HOUR);
    if (at <= now) return at;
  }
  return null;
}

// Next scheduled step strictly after `now`.
export function nextRun(now: number): number | null {
  const w = wallAt(now);
  for (let fwd = 0; fwd < 14; fwd++) {
    const probe = Date.UTC(w.y, w.mo - 1, w.d + fwd);
    const p = wallAt(probe);
    if (!isWeekday(p.dow)) continue;
    const at = instantForWall(p.y, p.mo, p.d, RUN_HOUR);
    if (at > now) return at;
  }
  return null;
}

// ── THE STEP LOG ─────────────────────────────────────────────────────────────
// Each attempt writes a `=== <wall clock> ===` banner; a step that got far enough to
// report itself then writes a STEP line. Other lines (briefings) are not attempts and
// must not be mistaken for one. "Clean" therefore means: a banner with a STEP line
// under it. That is the strongest claim the log actually supports — we do not have an
// exit code here, and inventing one would be a fake receipt.

export interface StepRun { at: number; ok: boolean; detail: string }

const BANNER = /^===\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+[A-Z]{3,4}\s*===$/;

export function parseStepLog(text: string): StepRun[] {
  const runs: StepRun[] = [];
  let cur: { at: number; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const step = cur.lines.find((l) => l.startsWith("STEP "));
    runs.push({ at: cur.at, ok: !!step, detail: (step || cur.lines.find((l) => l.trim()) || "").trim().slice(0, 300) });
  };
  for (const line of String(text || "").split("\n")) {
    const m = BANNER.exec(line.trim());
    if (m) {
      flush();
      // The banner is wall-clock in the rig's zone, with a zone abbreviation we
      // deliberately ignore — the zone itself is authoritative for that date.
      cur = { at: instantForWall(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  flush();
  return runs.sort((a, b) => a.at - b.at);
}

export interface LoopState {
  lastRun: number | null; lastOk: boolean; lastDetail: string;
  previousScheduled: number | null; nextScheduled: number | null; stale: boolean;
}

// The alarm. Stale ⇒ a scheduled step is more than the grace period overdue and no clean
// step has been recorded since it was due. Deliberately conservative: a missing log is
// NOT stale on its own until a scheduled step has actually come and gone unanswered.
export function loopState(runs: StepRun[], now: number): LoopState {
  const last = runs.length ? runs[runs.length - 1] : null;
  const prev = previousRun(now);
  const cleanSince = prev !== null && runs.some((r) => r.ok && r.at >= prev);
  const stale = prev !== null && now - prev > GRACE_MS && !cleanSince;
  return {
    lastRun: last?.at ?? null, lastOk: last?.ok ?? false, lastDetail: last?.detail ?? "",
    previousScheduled: prev, nextScheduled: nextRun(now), stale,
  };
}

// ── THE FORWARD LEDGER ───────────────────────────────────────────────────────
// An append-only journal: one header, then one line per lived day carrying that day's
// return. Equity is NOT stored — it is folded from the returns, so the desk computes it
// the same way the rig does (compound the returns; dedupe by date, first line wins).

export interface DayPoint { date: string; ret: number; equity: number; cumNet: number; tradesCum: number }
export interface Fold {
  strategy: string | null; days: number; trades: number;
  cumNet: number; cumSimple: number; inBand: boolean; status: string;
  series: DayPoint[];
}

export function foldLedger(text: string): Fold | null {
  const lines: any[] = [];
  for (const raw of String(text || "").split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    try { lines.push(JSON.parse(t)); } catch { /* a torn final line is normal for an append-only journal */ }
  }
  const header = lines.find((l) => l?.kind === "header");
  if (!header) return null;   // no header ⇒ nothing anchors the band; refuse to guess

  const seen = new Set<string>();
  const days = lines.filter((l) => l?.kind === "day" && typeof l.date === "string")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .filter((l) => { if (seen.has(l.date)) return false; seen.add(l.date); return true; });

  const series: DayPoint[] = [];
  let equity = 1, cumSimple = 0, trades = 0;
  for (const d of days) {
    const ret = Number(d.ret) || 0;
    equity *= 1 + ret;
    cumSimple += ret;
    trades = Number(d.trades_cum ?? trades) || 0;
    series.push({ date: String(d.date), ret, equity, cumNet: equity - 1, tradesCum: trades });
  }
  const n = series.length;
  const cumNet = equity - 1;

  // The rig anchors an expected drift and spread at the outset; the band is that drift
  // widened by the spread over elapsed days. Judged on the simple sum, as the rig does.
  const mu = Number(header.anchor_mu) || 0;
  const sigma = Number(header.anchor_sigma) || 0;
  const half = BAND_SIGMA * sigma * Math.sqrt(Math.max(n, 1));
  const lo = mu * n - half, hi = mu * n + half;
  const inBand = cumSimple >= lo && cumSimple <= hi;

  let status: string;
  if (cumSimple < lo) status = "OUT-LOW";
  else if (n < TARGET_DAYS || trades < TARGET_TRADES) status = "IN PROGRESS";
  else if (cumNet <= 0) status = "BELOW COSTS";
  else status = "READY";

  return { strategy: header.strategy ?? null, days: n, trades, cumNet, cumSimple, inBand, status, series };
}

// Fall from the high-water mark, as a positive fraction. Guards a zero/absent mark so a
// fresh rig reads 0% rather than NaN or Infinity leaking into the UI.
export function drawdown(equity: number, hwm: number): number {
  if (!Number.isFinite(equity) || !Number.isFinite(hwm) || hwm <= 0) return 0;
  return Math.max(0, (hwm - equity) / hwm);
}

// ── ASSEMBLY ─────────────────────────────────────────────────────────────────

export interface Desk {
  schema: 2; present: boolean;
  now: { equity: number; rung: number; hwm: number; drawdown: number; seeded: boolean; status: string | null;
         days: number; target: number; trades: number; tradeTarget: number; inBand: boolean | null; cumNet: number | null } | null;
  series: DayPoint[] | null;
  holdings: { ticker: string; score: number; price?: number; chg7?: number; chg30?: number; spark?: number[]; weight: number }[] | null;
  trades: never[];               // the journal keeps a running count, not individual fills
  tradesAvailable: false;
  pending: { count: number; items: any[] } | null;
  law: { constitution: string | null; amendments: any[] } | null;
  loop: LoopState | null;
  strategy: string | null;
  breadth: any; movers: any; targetVol: number | null;
  degraded: string[];            // which keys could not be read — shown, never hidden
}

export function rigRoot(): string {
  return process.env.FLIPIT_DIR || join(os.homedir(), "flip-it");
}

// READ ONLY. Every call here is a read; there is no write path in this module.
function readText(root: string, rel: string): string | null {
  try { return readFileSync(join(root, rel), "utf8"); } catch { return null; }
}
function readJson<T>(root: string, rel: string): T | null {
  const t = readText(root, rel);
  if (t === null) return null;
  try { return JSON.parse(t) as T; } catch { return null; }
}

export function buildDesk(root: string, now: number): Desk {
  const degraded: string[] = [];
  const miss = (k: string) => { degraded.push(k); return null; };

  const ladder = readJson<any>(root, "state/ladder.json");
  if (!ladder) {
    // No ladder ⇒ the rig isn't set up on this machine. Say so plainly; don't half-render.
    return { schema: 2, present: false, now: null, series: null, holdings: null, trades: [], tradesAvailable: false,
             pending: null, law: null, loop: null, strategy: null, degraded: ["ladder"],
             breadth: null, movers: null, targetVol: null };
  }

  const amendments = readJson<any[]>(root, "state/amendments.json") || miss("amendments") || [];
  const base = String((Array.isArray(amendments) && amendments[0]?.strategy) || ladder.strategy || "mom_12_1");

  const ledgerText = readText(root, `ledger/forward_${base}.jsonl`);
  const fold = ledgerText === null ? null : foldLedger(ledgerText);
  if (!fold) degraded.push("ledger");

  const market = readJson<any>(root, "state/market.json");
  const held = readJson<any>(root, `state/holdings_${base}.json`);
  if (!market && !held) miss("holdings");
  const rawHoldings: any[] = market?.holdings || held?.names || [];
  // Score-proportional weights — the rig holds its names by relative score, so the desk
  // shows the same shape rather than implying an equal split it doesn't have.
  const totalScore = rawHoldings.reduce((a, h) => a + (Number(h?.score) > 0 ? Number(h.score) : 0), 0);
  const holdings = rawHoldings.map((h) => ({
    ticker: String(h?.ticker ?? "?"), score: Number(h?.score) || 0,
    price: h?.price !== undefined ? Number(h.price) : undefined,
    chg7: h?.chg7 !== undefined ? Number(h.chg7) : undefined,
    chg30: h?.chg30 !== undefined ? Number(h.chg30) : undefined,
    spark: Array.isArray(h?.spark) ? h.spark.map(Number).filter((n: number) => Number.isFinite(n)) : undefined,
    weight: totalScore > 0 ? (Number(h?.score) > 0 ? Number(h.score) / totalScore : 0) : 0,
  }));

  const pendingRaw = readJson<any>(root, "state/pending_orders.json");
  const pendingItems = Array.isArray(pendingRaw) ? pendingRaw : Array.isArray(pendingRaw?.orders) ? pendingRaw.orders : [];
  const pending = { count: pendingItems.length, items: pendingItems };

  const constitution = readText(root, "FLIP_IT.md");
  if (constitution === null) degraded.push("constitution");

  const logText = readText(root, "logs/daily_step.log");
  if (logText === null) degraded.push("steplog");
  const loop = loopState(logText === null ? [] : parseStepLog(logText), now);

  const equity = Number(ladder.equity ?? 0);
  const hwm = Number(ladder.hwm ?? 0);

  return {
    schema: 2, present: true, strategy: fold?.strategy ?? base,
    now: {
      equity, rung: Number(ladder.rung ?? 0), hwm, drawdown: drawdown(equity, hwm),
      seeded: !!ladder.seeded, status: fold?.status ?? ladder.status ?? null,
      days: fold?.days ?? 0, target: TARGET_DAYS,
      trades: fold?.trades ?? 0, tradeTarget: TARGET_TRADES,
      inBand: fold ? fold.inBand : null, cumNet: fold ? fold.cumNet : null,
    },
    series: fold?.series ?? null,
    holdings: holdings.length ? holdings : null,
    trades: [], tradesAvailable: false,
    pending, law: { constitution, amendments: Array.isArray(amendments) ? amendments : [] },
    loop, degraded,
    breadth: market?.breadth ?? null, movers: market?.movers ?? null,
    targetVol: Array.isArray(amendments) && amendments[0]?.target_vol !== undefined ? Number(amendments[0].target_vol) : null,
  };
}

// A short cache so a visible desk polling every half-minute — or several tabs at once —
// costs one set of reads, and can never contend with the rig's own scheduled step.
let cached: { at: number; desk: Desk } | null = null;
export function desk(now = Date.now()): Desk {
  if (cached && now - cached.at < CACHE_MS) return cached.desk;
  const d = buildDesk(rigRoot(), now);
  cached = { at: now, desk: d };
  return d;
}
export function clearDeskCache() { cached = null; }

let lastAlertedState = { rung: -1, stale: false };
export async function checkFlipItAlerts(now = Date.now()): Promise<string | null> {
  const d = desk(now);
  if (!d.present || !d.loop || !d.now) return null;
  
  if (d.loop.stale && !lastAlertedState.stale) {
    lastAlertedState.stale = true;
    await pushNotify(
      "FlipIt Watchdog Alert ⚠️",
      `The forward step is overdue (stale). Next step was expected by ${new Date(d.loop.nextScheduled || 0).toLocaleTimeString()}.`,
      "/flipit"
    );
    return "stale_alert_sent";
  } else if (!d.loop.stale) {
    lastAlertedState.stale = false;
  }

  const currentRung = d.now.rung;
  if (lastAlertedState.rung !== -1 && currentRung > lastAlertedState.rung) {
    await pushNotify(
      "FlipIt Ladder Unlocked! 🚀",
      `Target reached! Advanced to Rung ${currentRung}. Equity: £${d.now.equity.toFixed(2)}.`,
      "/flipit"
    );
    lastAlertedState.rung = currentRung;
    return "rung_alert_sent";
  }
  lastAlertedState.rung = currentRung;
  return null;
}

// ── 100x QUANTITATIVE ENGINE: HIGH-SPEED MONTE CARLO & RISK ──

export interface MonteCarloConfig {
  initialCapital?: number;
  mu: number;              // Expected daily drift (e.g. 0.001 = +0.1%/day)
  sigma: number;           // Daily volatility (e.g. 0.015 = 1.5%/day)
  days?: number;           // Projection horizon (default: 60 days)
  paths?: number;          // Number of simulated paths (default: 10,000, up to 100,000)
  ruinThreshold?: number;  // Capital level considered total ruin (default: 0.5 = 50% loss)
}

export interface MonteCarloResult {
  paths: number;
  days: number;
  meanFinalEquity: number;
  medianFinalEquity: number;
  quantiles: {
    p1: number;
    p5: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
  var95: number;           // 95% Value at Risk (max expected loss at 95% confidence)
  var99: number;           // 99% Value at Risk
  cvar95: number;          // 95% Expected Shortfall (mean loss beyond VaR 95)
  cvar99: number;          // 99% Expected Shortfall
  sharpeRatio: number;     // Annualized Sharpe ratio (assuming 252 trading days)
  sortinoRatio: number;    // Annualized Sortino ratio (downside deviation only)
  maxDrawdownMean: number; // Mean maximum peak-to-trough drawdown
  maxDrawdownP95: number;  // 95th percentile max drawdown
  ruinProbability: number; // Fraction of paths that breached the ruin threshold
  trajectory: {
    day: number;
    median: number;
    p5: number;
    p95: number;
  }[];
}

// Box-Muller standard normal generator
function generateGaussianPair(): [number, number] {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const r = Math.sqrt(-2.0 * Math.log(u1));
  const theta = 2.0 * Math.PI * u2;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

export function monteCarlo100x(config: MonteCarloConfig): MonteCarloResult {
  const cap = Math.max(1, config.initialCapital || 1);
  const mu = Number(config.mu) || 0.0005;
  const sigma = Math.max(0.0001, Number(config.sigma) || 0.01);
  const days = Math.min(Math.max(5, config.days || 60), 365);
  const paths = Math.min(Math.max(100, config.paths || 10_000), 100_000);
  const ruinFloor = cap * (config.ruinThreshold ?? 0.5);

  const finalEquities = new Float64Array(paths);
  const finalReturns = new Float64Array(paths);
  const maxDrawdowns = new Float64Array(paths);
  let ruinCount = 0;

  // Track quantile trajectories over time for summary
  const trajectoryDays = Math.min(days, 20);
  const stepInterval = Math.max(1, Math.floor(days / trajectoryDays));
  const sampleSteps: number[] = [];
  for (let d = stepInterval; d <= days; d += stepInterval) sampleSteps.push(d);
  if (!sampleSteps.includes(days)) sampleSteps.push(days);

  const stepEquities: Float64Array[] = sampleSteps.map(() => new Float64Array(paths));

  for (let p = 0; p < paths; p++) {
    let eq = cap;
    let peak = cap;
    let mdd = 0;
    let ruined = false;
    let stepIdx = 0;

    for (let d = 1; d <= days; d += 2) {
      const [z1, z2] = generateGaussianPair();

      // Day 1
      const ret1 = mu + sigma * z1;
      eq *= (1 + ret1);
      if (eq > peak) peak = eq;
      const dd1 = (peak - eq) / peak;
      if (dd1 > mdd) mdd = dd1;
      if (eq <= ruinFloor) ruined = true;

      if (stepIdx < sampleSteps.length && d === sampleSteps[stepIdx]) {
        stepEquities[stepIdx][p] = eq;
        stepIdx++;
      }

      // Day 2 (if within horizon)
      if (d + 1 <= days) {
        const ret2 = mu + sigma * z2;
        eq *= (1 + ret2);
        if (eq > peak) peak = eq;
        const dd2 = (peak - eq) / peak;
        if (dd2 > mdd) mdd = dd2;
        if (eq <= ruinFloor) ruined = true;

        if (stepIdx < sampleSteps.length && (d + 1) === sampleSteps[stepIdx]) {
          stepEquities[stepIdx][p] = eq;
          stepIdx++;
        }
      }
    }

    finalEquities[p] = eq;
    finalReturns[p] = (eq - cap) / cap;
    maxDrawdowns[p] = mdd;
    if (ruined) ruinCount++;
  }

  // Sort returns for quantile analysis
  finalReturns.sort();
  finalEquities.sort();
  maxDrawdowns.sort();

  const getPercentile = (arr: Float64Array, pct: number) => {
    const idx = Math.min(Math.floor((pct / 100) * arr.length), arr.length - 1);
    return arr[idx];
  };

  const p1 = getPercentile(finalEquities, 1);
  const p5 = getPercentile(finalEquities, 5);
  const p10 = getPercentile(finalEquities, 10);
  const p25 = getPercentile(finalEquities, 25);
  const p50 = getPercentile(finalEquities, 50);
  const p75 = getPercentile(finalEquities, 75);
  const p90 = getPercentile(finalEquities, 90);
  const p95 = getPercentile(finalEquities, 95);
  const p99 = getPercentile(finalEquities, 99);

  let sumEq = 0;
  for (let i = 0; i < paths; i++) sumEq += finalEquities[i];
  const meanFinalEquity = sumEq / paths;

  // VaR and CVaR calculations on returns
  const var95 = Math.max(0, -getPercentile(finalReturns, 5));
  const var99 = Math.max(0, -getPercentile(finalReturns, 1));

  let cvar95Sum = 0, cvar95Count = 0;
  let cvar99Sum = 0, cvar99Count = 0;
  const cutoff95Idx = Math.floor(0.05 * paths);
  const cutoff99Idx = Math.floor(0.01 * paths);

  for (let i = 0; i < cutoff95Idx; i++) {
    cvar95Sum += -finalReturns[i];
    cvar95Count++;
  }
  for (let i = 0; i < cutoff99Idx; i++) {
    cvar99Sum += -finalReturns[i];
    cvar99Count++;
  }

  const cvar95 = cvar95Count > 0 ? cvar95Sum / cvar95Count : var95;
  const cvar99 = cvar99Count > 0 ? cvar99Sum / cvar99Count : var99;

  // Annualized metrics (252 days)
  const annualFactor = Math.sqrt(252);
  const annualReturn = mu * 252;
  const annualVol = sigma * annualFactor;
  const sharpeRatio = annualVol > 0 ? annualReturn / annualVol : 0;

  // Downside deviation for Sortino
  let downsideSumSq = 0;
  for (let i = 0; i < paths; i++) {
    const r = finalReturns[i];
    if (r < 0) downsideSumSq += r * r;
  }
  const downsideDev = Math.sqrt(downsideSumSq / paths);
  const sortinoRatio = downsideDev > 0 ? (annualReturn / (downsideDev * Math.sqrt(252 / days))) : sharpeRatio;

  let sumMdd = 0;
  for (let i = 0; i < paths; i++) sumMdd += maxDrawdowns[i];
  const maxDrawdownMean = sumMdd / paths;
  const maxDrawdownP95 = getPercentile(maxDrawdowns, 95);

  const trajectory = sampleSteps.map((day, sIdx) => {
    const arr = stepEquities[sIdx];
    arr.sort();
    return {
      day,
      median: getPercentile(arr, 50),
      p5: getPercentile(arr, 5),
      p95: getPercentile(arr, 95),
    };
  });

  return {
    paths,
    days,
    meanFinalEquity,
    medianFinalEquity: p50,
    quantiles: { p1, p5, p10, p25, p50, p75, p90, p95, p99 },
    var95,
    var99,
    cvar95,
    cvar99,
    sharpeRatio,
    sortinoRatio,
    maxDrawdownMean,
    maxDrawdownP95,
    ruinProbability: ruinCount / paths,
    trajectory,
  };
}

// ── MULTI-STRATEGY 100-ASSET PORTFOLIO ENGINE ──

export interface AssetProfile {
  id: string;
  name: string;
  expectedDailyReturn: number;
  dailyVolatility: number;
  weight?: number;
}

export interface PortfolioAnalysis {
  assets: {
    id: string;
    name: string;
    expectedDailyReturn: number;
    dailyVolatility: number;
    equalWeight: number;
    inverseVolWeight: number;
    riskParityWeight: number;
  }[];
  portfolioExpectedReturn: number;
  portfolioVolatility: number;
  diversificationRatio: number;
  volatilityScaleFactor: number; // Scale needed to match targetVol
  correlationMatrix: Record<string, Record<string, number>>;
}

export function analyzeMultiStrategy(
  assets: AssetProfile[],
  options: {
    targetDailyVol?: number;
    assumedCorrelation?: number; // default pairwise correlation when not given
  } = {}
): PortfolioAnalysis {
  const n = Math.min(Math.max(1, assets.length), 100);
  const targetVol = options.targetDailyVol || 0.01;
  const rho = options.assumedCorrelation ?? 0.25;

  // 1. Compute Weights
  const equalWeight = 1 / n;

  // Inverse volatility weights
  let invVolSum = 0;
  for (const a of assets) invVolSum += 1 / Math.max(0.0001, a.dailyVolatility);
  const invVolWeights = assets.map(a => (1 / Math.max(0.0001, a.dailyVolatility)) / invVolSum);

  const riskParityWeights = invVolWeights; // under constant pairwise correlation

  // 2. Correlation & Covariance Matrix
  const correlationMatrix: Record<string, Record<string, number>> = {};
  for (let i = 0; i < n; i++) {
    const a1 = assets[i];
    correlationMatrix[a1.id] = {};
    for (let j = 0; j < n; j++) {
      const a2 = assets[j];
      correlationMatrix[a1.id][a2.id] = (i === j) ? 1.0 : rho;
    }
  }

  // 3. Portfolio Variance & Volatility: w^T * Cov * w
  let portVar = 0;
  let weightedVolSum = 0;
  let portReturn = 0;

  for (let i = 0; i < n; i++) {
    const w_i = riskParityWeights[i];
    const s_i = assets[i].dailyVolatility;
    const r_i = assets[i].expectedDailyReturn;
    portReturn += w_i * r_i;
    weightedVolSum += w_i * s_i;

    for (let j = 0; j < n; j++) {
      const w_j = riskParityWeights[j];
      const s_j = assets[j].dailyVolatility;
      const cov_ij = (i === j) ? (s_i * s_i) : (rho * s_i * s_j);
      portVar += w_i * w_j * cov_ij;
    }
  }

  const portVol = Math.sqrt(Math.max(0.000001, portVar));
  const diversificationRatio = weightedVolSum / portVol;
  const volatilityScaleFactor = targetVol / portVol;

  const enrichedAssets = assets.map((a, idx) => ({
    id: a.id,
    name: a.name,
    expectedDailyReturn: a.expectedDailyReturn,
    dailyVolatility: a.dailyVolatility,
    equalWeight,
    inverseVolWeight: invVolWeights[idx],
    riskParityWeight: riskParityWeights[idx],
  }));

  return {
    assets: enrichedAssets,
    portfolioExpectedReturn: portReturn,
    portfolioVolatility: portVol,
    diversificationRatio,
    volatilityScaleFactor,
    correlationMatrix,
  };
}

// ── 100-RUNG COMPOUND LADDER ENGINE ──

export interface LadderRung {
  rung: number;
  targetEquity: number;
  stepMultiplier: number;
  estimatedDaysToReach: number;
  kellyFractionFull: number;
  kellyFractionHalf: number;
}

export interface LadderProjection {
  currentEquity: number;
  currentRung: number;
  totalRungs: number;
  mu: number;
  sigma: number;
  optimalKellyFraction: number;
  rungs: LadderRung[];
  milestones: {
    tenXDays: number;
    fiftyXDays: number;
    hundredXDays: number;
  };
}

export function project100xLadder(
  currentEquity = 5.0,
  options: {
    mu?: number;
    sigma?: number;
    totalRungs?: number;
    stepMultiplier?: number;
  } = {}
): LadderProjection {
  const eq = Math.max(0.01, Number(currentEquity) || 5.0);
  const mu = Math.max(0.0001, Number(options.mu) || 0.002); // 0.2% daily drift
  const sigma = Math.max(0.001, Number(options.sigma) || 0.012); // 1.2% daily vol
  const totalRungs = Math.min(Math.max(10, options.totalRungs || 100), 100);
  const stepMultiplier = options.stepMultiplier || 1.15; // +15% equity per rung step

  // Continuous Kelly Criterion: f* = mu / sigma^2
  const kellyFull = Math.min(1.0, Math.max(0.01, mu / (sigma * sigma)));
  const kellyHalf = kellyFull * 0.5;

  const rungs: LadderRung[] = [];
  let currentTarget = eq;
  let cumDays = 0;

  for (let r = 1; r <= totalRungs; r++) {
    currentTarget *= stepMultiplier;
    // Expected compounded growth per day: g = mu - 0.5 * sigma^2
    const dailyGrowth = Math.max(0.00001, mu - 0.5 * sigma * sigma);
    const stepRatio = stepMultiplier;
    const daysForStep = Math.log(stepRatio) / dailyGrowth;
    cumDays += daysForStep;

    rungs.push({
      rung: r,
      targetEquity: Number(currentTarget.toFixed(2)),
      stepMultiplier,
      estimatedDaysToReach: Math.round(cumDays),
      kellyFractionFull: Number(kellyFull.toFixed(3)),
      kellyFractionHalf: Number(kellyHalf.toFixed(3)),
    });
  }

  const dailyGrowth = Math.max(0.00001, mu - 0.5 * sigma * sigma);
  const tenXDays = Math.round(Math.log(10) / dailyGrowth);
  const fiftyXDays = Math.round(Math.log(50) / dailyGrowth);
  const hundredXDays = Math.round(Math.log(100) / dailyGrowth);

  return {
    currentEquity: eq,
    currentRung: 0,
    totalRungs,
    mu,
    sigma,
    optimalKellyFraction: Number(kellyHalf.toFixed(3)), // half-Kelly safe default
    rungs,
    milestones: {
      tenXDays,
      fiftyXDays,
      hundredXDays,
    },
  };
}



