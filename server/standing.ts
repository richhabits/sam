// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE STANDING CREW  (flag SAM_STANDING, default OFF)
//
//  A specialist normally runs only on-demand via /team. The Standing Crew lets you ARM any one of
//  SAM's specialists to run its lane's task in the BACKGROUND on a trigger (a cron schedule, reusing
//  scheduler.parseCron), surface the result, and stand back down. It runs ONE specialist per armed
//  entry — never the whole /team — via the same per-agent path the swarm uses (swarm=true), so a
//  risky action returns as PENDING and is routed through the Ask (handleUnattended); a dangerous
//  action can NEVER auto-run unattended. Every run is recorded in the autonomy log.
//
//  Two independent OFF-by-default gates must BOTH be true before an armed agent fires:
//    1. the flag  SAM_STANDING === "1"                 (the feature is on at all)
//    2. consent   isEnabled("standing-crew") === true  (the user granted this autonomy)
//  Arming/disarming/listing is pure bookkeeping and works regardless — nothing FIRES until both gates
//  pass. State persists to vault/standing.json (read fresh each call, like the scheduler) so armed
//  agents survive a restart.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCron } from "./scheduler.ts";
import { SPECIALISTS, NINJAS } from "./agents.ts";
import { runAgent, type AgentResult } from "./agent.ts";
import type { Tier } from "./models.ts";
import { handleUnattended } from "./ask.ts";
import { logAutonomy } from "./autonomy-log.ts";
import { isEnabled, type Behavior } from "./consent.ts";
import { desktopNotify } from "./proactive.ts";
import { pushNotify } from "./push.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function file(): string {
  // Resolve the VAULT_DIR each call so tests can point it at a scratch dir per-run.
  return join(process.env.VAULT_DIR || join(ROOT, "vault"), "standing.json");
}

// The consent behavior id that grants this autonomy. Registered in consent.ts (see integration
// notes); until then isEnabled() returns false for it — i.e. fail-closed, exactly what we want.
export const STANDING_BEHAVIOR = "standing-crew" as Behavior;

// Background specialists run on the free local brain by default — zero cloud quota, in keeping with
// SAM's free-first doctrine. (Standing runs are unattended; they must never burn paid tiers.)
const STANDING_TIER: Tier = "local";

export interface StandingAgent {
  id: string;
  specialistId: string;
  task: string;
  cron: string;
  armed: boolean;
  lastRunAt?: string;   // ISO timestamp of the last time it fired (also the claim marker)
  lastResult?: string;  // short summary of what happened
  createdAt: string;
}

export type RunOutcome = "ran" | "deferred" | "error";
export interface StandingRunResult {
  id: string;
  specialistId: string;
  outcome: RunOutcome;
  result: string;
}

// A stubbable runner: (system, task) → agent result. Default drives the SAME per-agent path the swarm
// uses (swarm=true), so a dangerous tool comes back as `pending` instead of executing. Tests inject a
// stub so no model/quota is touched.
export type SpecialistRunner = (system: string, task: string) => Promise<AgentResult>;

export interface RunDueDeps {
  now?: number;
  runner?: SpecialistRunner;
  notify?: (title: string, msg: string) => void;
  push?: (title: string, body: string) => void | Promise<void>;
  consentOk?: () => boolean;   // default: the real consent gate; injectable so tests need not touch consent.ts
}

// ── the roster lookup (specialists + ninjas) ──
const byId = (id: string) => [...SPECIALISTS, ...NINJAS].find((s) => s.id === id);

// ── gates: the flag is on by default; the "standing-crew" CONSENT is the real guard and stays opt-in ──
export function standingEnabled(): boolean {
  return process.env.SAM_STANDING !== "0";   // available by default (SAM_STANDING=0 kills it); no agent RUNS until it's consented AND armed, and risky steps route via the Ask
}

// ── persistence (read fresh each call, atomic-ish write, NO silent failure) ──
function load(): StandingAgent[] {
  try {
    const f = file();
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  } catch { /* no state file yet, or corrupt — start empty */ }
  return [];
}

function save(agents: StandingAgent[]): void {
  // A silent failure here would drop the user's armed crew on the next restart with no trace.
  try {
    // Atomic: a crash mid-write must not truncate the file and drop the crew on next boot.
    writeFileAtomic(file(), JSON.stringify(agents, null, 2));
  } catch (e: any) {
    console.error("[SAM] standing: FAILED to persist standing crew —", e?.message || e);
  }
}

// ── management API (works regardless of the flag; nothing FIRES until runDue + both gates) ──

/** Arm a specialist to run `task` in the background on `cron`. Throws on an unknown specialist or an
 *  unparseable cron — never silently no-ops. */
export function arm(specialistId: string, task: string, cron: string): StandingAgent {
  if (!byId(specialistId)) throw new Error(`Unknown specialist: ${specialistId}`);
  const t = (task || "").trim();
  if (!t) throw new Error("A standing agent needs a task.");
  if (!parseCron(cron)) throw new Error(`Invalid cron format: ${cron}`);
  const agents = load();
  const a: StandingAgent = {
    id: "std-" + Math.random().toString(36).slice(2, 9),
    specialistId,
    task: t.slice(0, 1000),
    cron: cron.toLowerCase().trim(),
    armed: true,
    createdAt: new Date().toISOString(),
  };
  agents.push(a);
  save(agents);
  return a;
}

/** Stand an agent down: it stays in the list (so it can be re-armed) but never fires. Returns the
 *  updated agent, or null if the id is unknown. */
export function disarm(id: string): StandingAgent | null {
  const agents = load();
  const a = agents.find((x) => x.id === id);
  if (!a) return null;
  a.armed = false;
  save(agents);
  return a;
}

/** Re-arm a stood-down agent. Returns the updated agent, or null if unknown. */
export function rearm(id: string): StandingAgent | null {
  const agents = load();
  const a = agents.find((x) => x.id === id);
  if (!a) return null;
  a.armed = true;
  save(agents);
  return a;
}

/** Remove an agent from the crew entirely. */
export function remove(id: string): boolean {
  const agents = load();
  const i = agents.findIndex((x) => x.id === id);
  if (i === -1) return false;
  agents.splice(i, 1);
  save(agents);
  return true;
}

export function list(): StandingAgent[] { return load(); }

// The system prompt that turns a specialist into a focused background operator (the swarm's per-agent
// framing, adapted for an unattended, on-a-schedule run).
function systemFor(a: StandingAgent): string {
  const spec = byId(a.specialistId)!;
  return `You are ${spec.name} ${spec.emoji} — one of SAM's specialists, channelling ${spec.modeledOn}.\n` +
    `Your lane: ${spec.brief}\n` +
    `You are running in the BACKGROUND on a schedule, unattended. Do YOUR lane's task precisely and ` +
    `concisely, then report the result in a few lines. If the task needs a risky or destructive action, ` +
    `propose it — it will be held for the user's approval, never run on its own.`;
}

/**
 * Fire every armed + due agent ONCE. Returns a result per fired agent. Fails CLOSED:
 *   • flag off  ⇒ nothing fires (returns []).
 *   • consent off ⇒ nothing fires (returns []).
 * For each due agent it CLAIMS the slot (writes lastRunAt before firing, so a crash or a re-entrant
 * call can't double-fire), runs that ONE specialist, and:
 *   • final answer  ⇒ record it, notify, log `acted`.
 *   • risky pending ⇒ route through the Ask (handleUnattended); record as DEFERRED, log `blocked`.
 *                     Nothing dangerous ever runs unattended.
 */
export async function runDue(now: Date = new Date(), deps: RunDueDeps = {}): Promise<StandingRunResult[]> {
  if (!standingEnabled()) return [];
  const consentOk = deps.consentOk ?? (() => isEnabled(STANDING_BEHAVIOR));
  if (!consentOk()) return [];

  const nowMs = deps.now ?? now.getTime();
  const nowClock = new Date(nowMs);

  const all = load();
  const due = all.filter((a) => {
    if (!a.armed) return false;
    const parsed = parseCron(a.cron);
    return !!parsed && parsed.shouldRun(nowClock, a.lastRunAt ? new Date(a.lastRunAt) : null);
  });
  if (!due.length) return [];

  // Claim all due slots in one write BEFORE firing — this is what stops a re-entrant call or a
  // crash-restart from re-firing them.
  const nowIso = nowClock.toISOString();
  for (const d of due) {
    const a = all.find((x) => x.id === d.id);
    if (a) a.lastRunAt = nowIso;
  }
  save(all);

  const runner: SpecialistRunner = deps.runner
    ?? ((system, task) => runAgent(system, task, STANDING_TIER, undefined, false, /* swarm */ true));
  const notify = deps.notify ?? desktopNotify;
  const push = deps.push ?? pushNotify;

  const results: StandingRunResult[] = [];
  for (const a of due) {
    const spec = byId(a.specialistId);
    const label = spec ? `${spec.name}` : a.specialistId;
    let outcome: RunOutcome;
    let summary: string;
    try {
      const r = await runner(systemFor(a), a.task);
      if (r.kind === "final") {
        summary = (r.text || "(no output)").slice(0, 300);
        outcome = "ran";
        logAutonomy({ at: nowIso, behavior: STANDING_BEHAVIOR, kind: "acted",
          summary: `${label} ran “${a.task.slice(0, 80)}” → ${summary.slice(0, 120)}` });
        try { notify(`SAM — ${label}`, summary); } catch { /* notify is best-effort */ }
        try { void push(`🛰️ SAM — ${label}`, summary); } catch { /* push is best-effort */ }
      } else {
        // Risky pending action: NEVER auto-run. Route it through the Ask (out-of-band approval).
        const unatt = handleUnattended(r, {
          tier: STANDING_TIER, source: "standing",
          why: `${label} (a background standing agent) needs this to finish “${a.task.slice(0, 80)}”`,
        });
        summary = (unatt.text || `Deferred — “${r.activity || r.tool || "an action"}” needs your approval; nothing was done.`).slice(0, 300);
        outcome = "deferred";
        logAutonomy({ at: nowIso, behavior: STANDING_BEHAVIOR, kind: "blocked",
          summary: `${label} wanted “${r.activity || r.tool || "a risky action"}” for “${a.task.slice(0, 80)}” — DEFERRED, not performed`,
          tool: r.tool });
      }
    } catch (e: any) {
      summary = `Error: ${e?.message || e}`.slice(0, 300);
      outcome = "error";
      logAutonomy({ at: nowIso, behavior: STANDING_BEHAVIOR, kind: "acted",
        summary: `${label} errored on “${a.task.slice(0, 80)}”: ${summary}` });
    }
    // Record the outcome (the claim already wrote lastRunAt).
    const fresh = load();
    const rec = fresh.find((x) => x.id === a.id);
    if (rec) { rec.lastResult = summary; save(fresh); }
    results.push({ id: a.id, specialistId: a.specialistId, outcome, result: summary });
  }
  return results;
}
