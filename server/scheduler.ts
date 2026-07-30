// ─────────────────────────────────────────────────────────────
//  S.A.M. · SCHEDULED TASKS (THE CRON)
//  Recurring work SAM does on a schedule. Persisted in the vault
//  so schedules survive restarts. Uses plain setInterval (no
//  external cron deps). Each schedule fires a standard SAM command.
//
//  A7 — "daily"/"weekly" schedules name a WALL-CLOCK time, so they must be
//  computed in that zone, not the host's — the same reasoning flipit.ts's
//  "the desk" already proved out for the money rig's own Mon-Fri 22:00 step,
//  including the one genuinely tricky part: BST/GMT transitions. Reused here
//  rather than re-derived, so there is exactly one place that gets this right.
//  A schedule that silently stops firing is the failure mode that matters —
//  `scheduleStatus()` is this module's version of the desk's `loop.stale`.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { wallAt, instantForWall } from "./flipit.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(process.env.VAULT_DIR || join(ROOT, "vault"), "schedules.json");

export interface Schedule {
  id: string;
  command: string;         // what SAM should do (plain text, like a chat message)
  cron: string;            // human-readable: "daily 09:00" | "weekly mon 09:00" | "hourly" | "every 30m"
  enabled: boolean;
  lastRun?: string;        // ISO timestamp
  lastResult?: string;     // short summary of what happened
  created: string;
  runCount: number;
}

function load(): Schedule[] {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")); } catch { /* no state file yet, or corrupt — start from the default */ }
  return [];
}

function save(schedules: Schedule[]) {
  // Silent failure here loses the user's schedules on the next restart with no trace.
  // Atomic: a crash mid-write must not truncate the file and lose every schedule on next boot.
  try { writeFileAtomic(FILE, JSON.stringify(schedules, null, 2)); }
  catch (e: any) { console.error("[SAM] scheduler: FAILED to save schedules —", e?.message || e); }
}

export function listSchedules(): Schedule[] { return load(); }

export function addSchedule(command: string, cron: string): Schedule {
  if (!parseCron(cron)) throw new Error(`Invalid cron format: ${cron}`);
  const schedules = load();
  const s: Schedule = {
    id: "sch-" + Math.random().toString(36).slice(2, 9),
    command: command.slice(0, 500),
    cron: cron.toLowerCase().trim(),
    enabled: true,
    created: new Date().toISOString(),
    runCount: 0,
  };
  schedules.push(s);
  save(schedules);
  return s;
}

export function removeSchedule(id: string): boolean {
  const schedules = load();
  const idx = schedules.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  schedules.splice(idx, 1);
  save(schedules);
  return true;
}

export function toggleSchedule(id: string): Schedule | null {
  const schedules = load();
  const s = schedules.find((x) => x.id === id);
  if (!s) return null;
  s.enabled = !s.enabled;
  save(schedules);
  return s;
}

export function markRan(id: string, result: string) {
  const schedules = load();
  const s = schedules.find((x) => x.id === id);
  if (!s) return;
  s.lastRun = new Date().toISOString();
  s.lastResult = result.slice(0, 300);
  s.runCount++;
  save(schedules);
}

// ── Parse the human-friendly cron string into milliseconds + matcher ──
// Supported: "hourly", "every 30m", "every 2h", "daily 09:00", "daily 14:30",
//            "weekly mon 09:00", "weekly fri 17:00"
interface ParsedSchedule {
  intervalMs: number;
  shouldRun: (now: Date, lastRun: Date | null) => boolean;
  // The next/previous scheduled instant, independent of shouldRun's tick — the single
  // source of truth the UI's "next run" and the stale watchdog both read from, so they
  // can never quietly disagree with what actually fires.
  nextAfter: (after: number) => number;
  previousAtOrBefore: (before: number) => number;
}

const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Walk zone-local calendar days from `from`, testing each against `dayOk`, returning the
// first `instantForWall(day, hour, minute)` that also satisfies `keep`. Shared by daily
// (every day matches) and weekly (only one weekday matches) in both directions.
function walkDays(
  from: number, hour: number, minute: number,
  dayOk: (dow: number) => boolean, keep: (at: number) => boolean, direction: 1 | -1,
): number {
  const w = wallAt(from);
  for (let i = 0; i <= 8; i++) {
    const probe = Date.UTC(w.y, w.mo - 1, w.d + direction * i);
    const p = wallAt(probe);
    if (!dayOk(p.dow)) continue;
    const at = instantForWall(p.y, p.mo, p.d, hour, minute);
    if (keep(at)) return at;
  }
  // Unreachable for any real calendar (every weekday cadence resolves within a week);
  // a same-direction fallback keeps the return type honest without ever firing early/late.
  return from + direction * 24 * 3600_000;
}

export function parseCron(cron: string): ParsedSchedule | null {
  const c = cron.toLowerCase().trim();

  // "hourly" — a pure interval, no wall-clock alignment, so no timezone dependency at all.
  if (c === "hourly") {
    return {
      intervalMs: 3600_000,
      shouldRun: (_now, last) => !last || Date.now() - last.getTime() >= 3500_000,
      nextAfter: (after) => after + 3600_000,
      previousAtOrBefore: (before) => before,   // "always due" until it has actually run once
    };
  }

  // "every 30m" / "every 2h" — same reasoning as hourly.
  const everyMatch = c.match(/^every\s+(\d+)\s*(m|min|h|hr|hours?)$/);
  if (everyMatch) {
    const val = parseInt(everyMatch[1], 10);
    if (val <= 0) return null;   // "every 0m" would fire every tick — reject as invalid
    const unit = everyMatch[2].startsWith("h") ? 3600_000 : 60_000;
    const ms = val * unit;
    return {
      intervalMs: ms,
      shouldRun: (_now, last) => !last || Date.now() - last.getTime() >= ms - 30_000,
      nextAfter: (after) => after + ms,
      previousAtOrBefore: (before) => before,
    };
  }

  // "daily 09:00" / "daily 14:30" — a WALL-CLOCK time, so BST/GMT-correct from here down.
  const dailyMatch = c.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    const hour = parseInt(dailyMatch[1], 10);
    const minute = parseInt(dailyMatch[2], 10);
    const anyDay = () => true;
    return {
      intervalMs: 60_000, // check every minute
      shouldRun: (now, last) => {
        const w = wallAt(now.getTime());
        const scheduledToday = instantForWall(w.y, w.mo, w.d, hour, minute);
        if (Math.abs(now.getTime() - scheduledToday) > 30_000) return false;   // not this minute's window, in the zone's own clock
        if (last) { const lw = wallAt(last.getTime()); if (lw.y === w.y && lw.mo === w.mo && lw.d === w.d) return false; }  // already ran today (zone-local date)
        return true;
      },
      nextAfter: (after) => walkDays(after, hour, minute, anyDay, (at) => at > after, 1),
      previousAtOrBefore: (before) => walkDays(before, hour, minute, anyDay, (at) => at <= before, -1),
    };
  }

  // "weekly mon 09:00" — same zone-correctness, restricted to one weekday.
  const weeklyMatch = c.match(/^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+(\d{1,2}):(\d{2})$/);
  if (weeklyMatch) {
    const day = DAYS[weeklyMatch[1]];
    const hour = parseInt(weeklyMatch[2], 10);
    const minute = parseInt(weeklyMatch[3], 10);
    const thisDay = (dow: number) => dow === day;
    return {
      intervalMs: 60_000,
      shouldRun: (now, last) => {
        const w = wallAt(now.getTime());
        if (w.dow !== day) return false;
        const scheduledToday = instantForWall(w.y, w.mo, w.d, hour, minute);
        if (Math.abs(now.getTime() - scheduledToday) > 30_000) return false;
        if (last && Date.now() - last.getTime() < 6 * 24 * 3600_000) return false;   // ran within the last 6 days ⇒ this week is done
        return true;
      },
      nextAfter: (after) => walkDays(after, hour, minute, thisDay, (at) => at > after, 1),
      previousAtOrBefore: (before) => walkDays(before, hour, minute, thisDay, (at) => at <= before, -1),
    };
  }

  return null; // unrecognised format
}

// ── A7's stale watchdog — the desk's loop.stale, generalised ──
// Stale ⇒ enabled, and the most recent instant this cron should have fired is more than
// the grace period in the past with no run recorded since. Deliberately conservative,
// same as the desk: a schedule that has genuinely never had the chance to run yet
// (previousAtOrBefore predates its own creation) is not stale, only overdue-with-no-answer is.
const STALE_GRACE_MS = 15 * 60_000;

export interface ScheduleStatus { nextRun: number | null; stale: boolean }

export function scheduleStatus(s: Schedule, now = Date.now()): ScheduleStatus {
  const parsed = parseCron(s.cron);
  if (!parsed || !s.enabled) return { nextRun: null, stale: false };
  const due = parsed.previousAtOrBefore(now);
  const created = new Date(s.created).getTime();
  const last = s.lastRun ? new Date(s.lastRun).getTime() : null;
  const dueSinceCreation = due >= created;
  const overdue = now - due > STALE_GRACE_MS;
  const answeredSince = last !== null && last >= due;
  return { nextRun: parsed.nextAfter(now), stale: dueSinceCreation && overdue && !answeredSince };
}

// ── The scheduler loop ──
let running = false;
const inFlight = new Set<string>();   // schedule ids currently executing — the real double-fire guard for long jobs
let executor: ((command: string) => Promise<string>) | null = null;

export function startScheduler(run: (command: string) => Promise<string>) {
  if (running) return;
  running = true;
  executor = run;

  // Check every 60 seconds. The tick itself stays SYNCHRONOUS: it decides which
  // schedules are due up front (so one slow job can't push others past their
  // exact-minute window), CLAIMS them by writing lastRun before firing (so neither
  // a crash nor the next tick can double-fire), then runs them without awaiting
  // (so a long agent job never blocks the loop).
  setInterval(() => {
    if (!executor) return;
    const now = new Date();
    const due = load().filter((s) => {
      if (!s.enabled) return false;
      if (inFlight.has(s.id)) return false;   // AUDIT FIX: still executing from a prior tick — never fire it twice
      const parsed = parseCron(s.cron);
      return !!parsed && parsed.shouldRun(now, s.lastRun ? new Date(s.lastRun) : null);
    });
    if (!due.length) return;

    // Claim all due schedules in one write (set lastRun). The lastRun claim alone is NOT enough: a
    // job that outlives its interval finishes after the next tick, so shouldRun() would re-fire it —
    // the in-flight `running` set is the real guard against a long job double-firing.
    const all = load();
    const nowIso = now.toISOString();
    for (const d of due) { const s = all.find((x) => x.id === d.id); if (s) s.lastRun = nowIso; }
    save(all);

    // Fire each without blocking the scheduler.
    for (const d of due) {
      inFlight.add(d.id);
      executor!(d.command)
        .then((result) => markRan(d.id, result))
        .catch((e: any) => markRan(d.id, `Error: ${e?.message || e}`))
        .finally(() => inFlight.delete(d.id));
    }
  }, 60_000);

  console.log(`  ⏰ scheduler     · ${load().filter((s) => s.enabled).length} active schedules`);
}
