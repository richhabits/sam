// ─────────────────────────────────────────────────────────────
//  S.A.M. · LOCAL ANALYTICS  (v2.0 — your own usage, on your own device)
//
//  SAM tracks its OWN usage locally so it can show YOU your stats ("Your SAM" dashboard) and so an
//  opt-in, anonymous, aggregate ping can tell the maker whether people stay. This file is the LOCAL
//  half: plain counters in vault/analytics.json. It NEVER contains content — no prompts, no file names,
//  no messages — only counts and dates. Nothing here leaves the device on its own; telemetry.ts reads a
//  strict whitelist of these aggregates and only sends them if the user explicitly opts in.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "analytics.json");

export interface Analytics {
  firstSeen: string;              // ISO day of first use — the retention anchor
  lastSeen: string;
  activeDays: string[];           // distinct YYYY-MM-DD the app was used (bounded)
  tasks: number;                  // successful task runs
  toolUses: Record<string, number>;   // tool name → count (tool NAMES only, never inputs)
  workflowRuns: number;
  cacheHits: number;
  activatedAt?: string;           // when the first successful task landed (activation)
  crashes: number;
}

const EMPTY: Analytics = { firstSeen: "", lastSeen: "", activeDays: [], tasks: 0, toolUses: {}, workflowRuns: 0, cacheHits: 0, crashes: 0 };

function read(): Analytics {
  try { if (existsSync(FILE)) return { ...EMPTY, ...JSON.parse(readFileSync(FILE, "utf8")) }; } catch { /* ignore */ }
  return { ...EMPTY };
}
function write(a: Analytics) { try { mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(a, null, 2)); } catch { /* best-effort */ } }

// `at` is injected (the caller owns the clock) so this is pure + testable.
function touch(a: Analytics, at: string): Analytics {
  const day = at.slice(0, 10);
  if (!a.firstSeen) a.firstSeen = day;
  a.lastSeen = at;
  if (!a.activeDays.includes(day)) a.activeDays = [...a.activeDays, day].slice(-400);
  return a;
}

export function recordTask(at: string, ok = true): void {
  const a = touch(read(), at);
  if (ok) { a.tasks += 1; if (!a.activatedAt) a.activatedAt = at; }
  write(a);
}
// Records a tool NAME only — never its input.
export function recordTool(name: string, at: string): void {
  const a = touch(read(), at);
  const k = String(name).slice(0, 40);
  a.toolUses[k] = (a.toolUses[k] || 0) + 1;
  write(a);
}
export function recordWorkflowRun(at: string): void { const a = touch(read(), at); a.workflowRuns += 1; write(a); }
export function recordCacheHit(at: string): void { const a = touch(read(), at); a.cacheHits += 1; write(a); }
export function recordCrash(at: string): void { const a = touch(read(), at); a.crashes += 1; write(a); }

export function getAnalytics(): Analytics { return read(); }
export function resetAnalytics(): void { write({ ...EMPTY }); }

// Derived, human-facing summary for the "Your SAM" dashboard — still 100% local.
export function analyticsSummary(now: string) {
  const a = read();
  const retentionDays = a.firstSeen ? Math.max(1, Math.round((new Date(now).getTime() - new Date(a.firstSeen + "T00:00:00Z").getTime()) / 86_400_000) + 1) : 0;
  const topTools = Object.entries(a.toolUses).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
  const totalToolUses = Object.values(a.toolUses).reduce((s, n) => s + n, 0);
  // A deliberately conservative "hours saved" heuristic (~90s of manual work per successful task).
  const hoursSaved = Math.round((a.tasks * 90) / 3600 * 10) / 10;
  return {
    retentionDays,
    activeDays: a.activeDays.length,
    tasks: a.tasks,
    totalToolUses,
    topTools,
    workflowRuns: a.workflowRuns,
    cacheHits: a.cacheHits,
    hoursSaved,
    activated: !!a.activatedAt,
    dataLeftDevice: 0,          // the whole point — always zero unless the user opts into telemetry
  };
}
