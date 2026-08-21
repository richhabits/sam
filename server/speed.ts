// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE HEALTH & SPEED MEMORY
//
//  Measures real-time latency (EWMA), Time-To-First-Token (TTFT),
//  token generation throughput, and terminal failure states (401/404/410).
//  Includes active benchmarking probers to dynamically route prompts
//  to the fastest available zero-cost provider.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Health {
  /** Exponentially-weighted mean latency of the calls that WORKED, in ms. 0 = never succeeded. */
  ewmaMs: number;
  calls: number;
  ok: number;
  /** Epoch ms until which this brain is sunk to the bottom after a terminal failure. */
  sunkUntil: number;
  /** The status that sank it — the sentence the audit would have written. */
  reason?: string;
  lastAt: number;
  tokensPerSec?: number;
}

export interface SpeedProbeResult {
  providerId: string;
  ok: boolean;
  status?: number;
  ttftMs: number;
  totalMs: number;
  tokensPerSec: number;
  sampleText?: string;
  error?: string;
}

export interface SpeedBenchmarkLeaderboard {
  timestamp: number;
  probedCount: number;
  activeCount: number;
  fastestProvider: string | null;
  results: SpeedProbeResult[];
}

/** Statuses that mean "this will fail again in one second exactly as it failed now". */
export const TERMINAL = new Set([401, 402, 403, 404, 410]);
/** How long a terminally-failed brain stays at the bottom before it earns one probe. */
export const SINK_MS = Number(process.env.SAM_SINK_MS) || 6 * 60 * 60 * 1000;
const ALPHA = 0.3;

const vaultDir = () => process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const healthFile = () => join(vaultDir(), "brain-health.json");

let state: Record<string, Health> = {};
let loaded = false;
let dirty = false;
let flushAt = 0;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(healthFile())) state = JSON.parse(readFileSync(healthFile(), "utf8")) || {};
  } catch { state = {}; }
}

function flush(now: number, force = false): void {
  if (!dirty) return;
  if (!force && now - flushAt < 5000) return;
  flushAt = now;
  dirty = false;
  try {
    mkdirSync(vaultDir(), { recursive: true });
    writeFileSync(healthFile(), JSON.stringify(state, null, 2));
  } catch { /* best-effort */ }
}

export function health(id: string): Health | undefined {
  load();
  return state[id];
}

export function allHealth(): Record<string, Health> {
  load();
  return { ...state };
}

/**
 * One brain call, measured.
 */
export function record(id: string, r: { ms: number; ok: boolean; status?: number; now?: number; tokensPerSec?: number }): void {
  load();
  const now = r.now ?? Date.now();
  const h = state[id] ?? { ewmaMs: 0, calls: 0, ok: 0, sunkUntil: 0, lastAt: 0 };
  h.calls++;
  h.lastAt = now;
  if (r.ok) {
    h.ok++;
    h.ewmaMs = h.ewmaMs ? Math.round(ALPHA * r.ms + (1 - ALPHA) * h.ewmaMs) : r.ms;
    if (r.tokensPerSec) h.tokensPerSec = r.tokensPerSec;
    h.sunkUntil = 0;
    h.reason = undefined;
  } else if (r.status && TERMINAL.has(r.status)) {
    h.sunkUntil = now + SINK_MS;
    h.reason = `HTTP ${r.status}`;
  }
  state[id] = h;
  dirty = true;
  flush(now);
}

export function flushNow(): void {
  flush(Date.now(), true);
}

export function sunk(id: string, now = Date.now()): boolean {
  const h = health(id);
  return !!h && h.sunkUntil > now;
}

export function healthOrder<T extends { id: string }>(pool: T[], now = Date.now()): T[] {
  load();
  if (pool.length < 2) return pool;
  const measured = pool.map((p, i) => ({ p, i, h: state[p.id] }));
  const speeds = measured.map((m) => m.h?.ewmaMs || 0).filter((n) => n > 0);
  const best = speeds.length ? Math.min(...speeds) : 0;
  const tolerance = Math.max(best * 3, 1500);

  const grade = (m: { p: T; h?: Health }) => {
    if (m.h && m.h.sunkUntil > now) return 2;
    if (m.h?.ewmaMs && m.h.ewmaMs > tolerance) return 1;
    if (m.h && m.h.calls >= 2 && m.h.ok === 0) return 1;
    return 0;
  };
  return measured.sort((a, b) => grade(a) - grade(b) || a.i - b.i).map((m) => m.p);
}

export function report(now = Date.now()): { id: string; ms: number; calls: number; okRate: number; tokensPerSec?: number; state: string }[] {
  load();
  return Object.entries(state)
    .map(([id, h]) => ({
      id,
      ms: h.ewmaMs,
      calls: h.calls,
      okRate: h.calls ? Math.round((h.ok / h.calls) * 100) : 0,
      tokensPerSec: h.tokensPerSec,
      state: h.sunkUntil > now
        ? `sunk (${h.reason || "failed"})`
        : h.ewmaMs
          ? "ok"
          : h.calls >= 2 ? `failing (${h.calls} tries, no answer)` : "untried",
    }))
    .sort((a, b) => (a.state.startsWith("sunk") ? 1 : 0) - (b.state.startsWith("sunk") ? 1 : 0) || (a.ms || 1e9) - (b.ms || 1e9));
}

/**
 * Actively probes a provider with a fast validation prompt to measure TTFT and throughput.
 */
export async function probeProvider(
  providerId: string,
  runner: () => Promise<{ text: string; ttftMs?: number }>
): Promise<SpeedProbeResult> {
  const t0 = Date.now();
  try {
    const res = await runner();
    const totalMs = Date.now() - t0;
    const ttftMs = res.ttftMs ?? Math.round(totalMs * 0.4);
    const words = (res.text || "").trim().split(/\s+/).length;
    const tokens = Math.max(1, Math.round(words * 1.3));
    const tokenDurationSec = Math.max(0.01, (totalMs - ttftMs) / 1000);
    const tokensPerSec = Math.round(tokens / tokenDurationSec);

    record(providerId, {
      ms: totalMs,
      ok: true,
      tokensPerSec,
      now: t0,
    });

    return {
      providerId,
      ok: true,
      ttftMs,
      totalMs,
      tokensPerSec,
      sampleText: res.text.slice(0, 100),
    };
  } catch (err: any) {
    const totalMs = Date.now() - t0;
    const status = err?.status || (err?.message?.includes("401") ? 401 : err?.message?.includes("429") ? 429 : 500);

    record(providerId, {
      ms: totalMs,
      ok: false,
      status,
      now: t0,
    });

    return {
      providerId,
      ok: false,
      status,
      ttftMs: totalMs,
      totalMs,
      tokensPerSec: 0,
      error: err?.message || "Probe failed",
    };
  }
}

/**
 * Builds a comprehensive speed benchmark leaderboard from current health records.
 */
export function getSpeedLeaderboard(): SpeedBenchmarkLeaderboard {
  const rep = report();
  const active = rep.filter((r) => r.state === "ok");
  const fastest = active.length > 0 ? active[0].id : null;

  return {
    timestamp: Date.now(),
    probedCount: rep.length,
    activeCount: active.length,
    fastestProvider: fastest,
    results: rep.map((r) => ({
      providerId: r.id,
      ok: r.state === "ok",
      ttftMs: Math.round(r.ms * 0.4),
      totalMs: r.ms,
      tokensPerSec: r.tokensPerSec || 0,
    })),
  };
}

export function _reset(): void {
  state = {};
  loaded = true;
  dirty = true;
}
