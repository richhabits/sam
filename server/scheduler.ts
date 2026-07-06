// ─────────────────────────────────────────────────────────────
//  S.A.M. · SCHEDULED TASKS (THE CRON)
//  Recurring work SAM does on a schedule. Persisted in the vault
//  so schedules survive restarts. Uses plain setInterval (no
//  external cron deps). Each schedule fires a standard SAM command.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")); } catch {}
  return [];
}

function save(schedules: Schedule[]) {
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(schedules, null, 2)); } catch {}
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
}

const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function parseCron(cron: string): ParsedSchedule | null {
  const c = cron.toLowerCase().trim();

  // "hourly"
  if (c === "hourly") {
    return { intervalMs: 3600_000, shouldRun: (_now, last) => !last || Date.now() - last.getTime() >= 3500_000 };
  }

  // "every 30m" / "every 2h"
  const everyMatch = c.match(/^every\s+(\d+)\s*(m|min|h|hr|hours?)$/);
  if (everyMatch) {
    const val = parseInt(everyMatch[1]);
    if (val <= 0) return null;   // "every 0m" would fire every tick — reject as invalid
    const unit = everyMatch[2].startsWith("h") ? 3600_000 : 60_000;
    const ms = val * unit;
    return { intervalMs: ms, shouldRun: (_now, last) => !last || Date.now() - last.getTime() >= ms - 30_000 };
  }

  // "daily 09:00" / "daily 14:30"
  const dailyMatch = c.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    const hour = parseInt(dailyMatch[1]);
    const minute = parseInt(dailyMatch[2]);
    return {
      intervalMs: 60_000, // check every minute
      shouldRun: (now, last) => {
        if (now.getHours() !== hour || now.getMinutes() !== minute) return false;
        if (last && now.toDateString() === last.toDateString()) return false; // already ran today
        return true;
      },
    };
  }

  // "weekly mon 09:00"
  const weeklyMatch = c.match(/^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+(\d{1,2}):(\d{2})$/);
  if (weeklyMatch) {
    const day = DAYS[weeklyMatch[1]];
    const hour = parseInt(weeklyMatch[2]);
    const minute = parseInt(weeklyMatch[3]);
    return {
      intervalMs: 60_000,
      shouldRun: (now, last) => {
        if (now.getDay() !== day || now.getHours() !== hour || now.getMinutes() !== minute) return false;
        if (last && Date.now() - last.getTime() < 82800_000) return false; // within 23h = already ran
        return true;
      },
    };
  }

  return null; // unrecognised format
}

// ── The scheduler loop ──
let running = false;
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
      const parsed = parseCron(s.cron);
      return !!parsed && parsed.shouldRun(now, s.lastRun ? new Date(s.lastRun) : null);
    });
    if (!due.length) return;

    // Claim all due schedules in one write (set lastRun) — this is what stops the
    // next tick, or a crash-restart, from re-firing them.
    const all = load();
    const nowIso = now.toISOString();
    for (const d of due) { const s = all.find((x) => x.id === d.id); if (s) s.lastRun = nowIso; }
    save(all);

    // Fire each without blocking the scheduler.
    for (const d of due) {
      executor!(d.command)
        .then((result) => markRan(d.id, result))
        .catch((e: any) => markRan(d.id, `Error: ${e?.message || e}`));
    }
  }, 60_000);

  console.log(`  ⏰ scheduler     · ${load().filter((s) => s.enabled).length} active schedules`);
}
