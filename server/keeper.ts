// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE KEEPER  — one level-triggered pass that keeps reality matching intent.
//
//  SAM's health checks are mostly EDGE-triggered: they react to an event (a cron tick, a boot warm)
//  and, if the event is missed, stay broken silently. The Keeper re-OBSERVES actual state on a timer,
//  diffs it against a tiny desired-state list, and corrects safe drift. If nothing drifted the tick
//  is a cheap no-op. Every correction records a Black Box issue and bumps a Pulse metric, so drift is
//  never silent — and a fix that itself fails surfaces too.
//
//  Deliberately minimal: ONE loop, ONE list of guards, no controllers/queues/frameworks. And a hard
//  line — a guard whose fix is destructive is NOT auto-healed. It's surfaced for the approval path.
// ─────────────────────────────────────────────────────────────
import { statfsSync } from "node:fs";
import { join } from "node:path";
import { capture } from "./issues.ts";
import { sweepStaleLatches, staleLatches } from "./latch.ts";
import { count } from "./pulse.ts";

export interface GuardResult { ok: boolean; detail?: string }
export interface Guard {
  name: string;
  observe: () => GuardResult | Promise<GuardResult>;
  /** Correct the drift. Omit (or set autoHeal:false) for drift that must NOT be auto-fixed. */
  heal?: () => GuardResult | Promise<GuardResult>;
  /** false → drift is SURFACED (recorded, routed to the user), never silently auto-corrected. */
  autoHeal: boolean;
}

export interface TickReport {
  checked: number;
  ok: string[];
  healed: string[];
  surfaced: string[];   // drifted but not auto-healable (needs the user)
  failed: string[];     // observe threw, or a heal failed
}

/** Run one pass over the guards. Idempotent: a guard that's already ok is a no-op. */
export async function tick(guards: Guard[]): Promise<TickReport> {
  const r: TickReport = { checked: 0, ok: [], healed: [], surfaced: [], failed: [] };
  for (const g of guards) {
    r.checked++;
    let res: GuardResult;
    try {
      res = await g.observe();
    } catch (e) {
      capture(e, { keeper: g.name, phase: "observe" });
      count("keeper.error", 1, { guard: g.name });
      r.failed.push(g.name);
      continue;
    }
    if (res.ok) { r.ok.push(g.name); continue; }   // no drift → cheap no-op

    count("keeper.drift", 1, { guard: g.name });
    if (!g.autoHeal || !g.heal) {
      // Surfaced, never silently corrected — destructive/unfixable drift goes to the user.
      capture(new Error(`drift: ${g.name}${res.detail ? ` — ${res.detail}` : ""}`), { keeper: g.name, action: "surfaced" });
      r.surfaced.push(g.name);
      continue;
    }
    try {
      const h = await g.heal();
      if (h.ok) {
        r.healed.push(g.name);
        count("keeper.heal", 1, { guard: g.name, result: "ok" });
        capture(new Error(`healed: ${g.name}${h.detail ? ` — ${h.detail}` : ""}`), { keeper: g.name, action: "healed" });
      } else {
        r.failed.push(g.name);
        count("keeper.heal", 1, { guard: g.name, result: "fail" });
        capture(new Error(`heal failed: ${g.name}${h.detail ? ` — ${h.detail}` : ""}`), { keeper: g.name, action: "heal-failed" });
      }
    } catch (e) {
      r.failed.push(g.name);
      count("keeper.heal", 1, { guard: g.name, result: "throw" });
      capture(e, { keeper: g.name, phase: "heal" });
    }
  }
  count("keeper.ticks");
  return r;
}

// ── The default guards ───────────────────────────────────────
const VAULT_DIR = process.env.VAULT_DIR || join(process.cwd(), "vault");
const DISK_FLOOR_BYTES = 500 * 1024 * 1024;   // warn under ~500 MB free

export function defaultGuards(): Guard[] {
  return [
    {
      // Lock files left by a crashed process would block writers forever. Sweeping a corpse is safe.
      name: "latch.clean",
      autoHeal: true,
      observe: () => { const s = staleLatches(); return { ok: s.length === 0, detail: s.length ? `${s.length} stale latch(es): ${s.join(", ")}` : undefined }; },
      heal: () => { const cleared = sweepStaleLatches(); return { ok: true, detail: `cleared ${cleared.length}` }; },
    },
    {
      // Low disk breaks the vault/index silently. We can't safely free disk, so this is surfaced only.
      name: "disk.ok",
      autoHeal: false,
      observe: () => {
        try {
          const s = statfsSync(VAULT_DIR);
          const free = Number(s.bavail) * Number(s.bsize);
          return { ok: free >= DISK_FLOOR_BYTES, detail: `${Math.round(free / 1024 / 1024)} MB free` };
        } catch { return { ok: true }; }   // can't measure → don't cry drift
      },
    },
  ];
}

// ── The loop ─────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Start the single timer loop. Opt-in (SAM_KEEPER=1), default off. Backs off rather than overlap. */
export function startKeeper(guards: Guard[] = defaultGuards(), intervalMs = 60_000): boolean {
  if (process.env.SAM_KEEPER !== "1" || timer) return false;
  timer = setInterval(async () => {
    if (running) return;   // a slow tick must not stack — back off
    running = true;
    try { await tick(guards); } catch (e) { capture(e, { keeper: "loop" }); } finally { running = false; }
  }, intervalMs);
  timer.unref?.();   // the Keeper must never keep the process alive on its own
  return true;
}

export function stopKeeper(): void { if (timer) { clearInterval(timer); timer = null; } }
