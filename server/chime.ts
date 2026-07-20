// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE CHIME
//  Real alarms + named, cancellable timers. SAM's old set_timer was a
//  throwaway setTimeout that died with the process and couldn't be
//  listed or cancelled. The Chime persists every timer/alarm to the
//  vault so they survive restarts, can be listed/cancelled/snoozed,
//  and fire from a single tick driven by the main loop.
//
//  A Chime fires by (1) calling a caller-provided `notify` (the app's
//  audible bell / in-app card) and (2) a desktop notification, so it
//  reaches you even with the window closed. Firing is a SAFE act — it
//  only notifies, never runs a tool — but firing UNATTENDED is still
//  autonomy in scheduling, so the tick is OFF BY DEFAULT behind
//  SAM_CHIME and every fire is written to the autonomy log.
//
//  Recurring alarms reuse scheduler.parseCron — the cron grammar is
//  NOT duplicated here.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCron } from "./scheduler.ts";
import { desktopNotify } from "./proactive.ts";
import { logAutonomy } from "./autonomy-log.ts";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "chimes.json");

export interface Chime {
  id: string;
  label: string;
  kind: "timer" | "alarm";
  fireAt?: string;        // ISO — one-shot (a timer, or a one-time alarm)
  recur?: string;         // human cron (see scheduler.parseCron) — a recurring alarm
  enabled: boolean;       // a one-shot flips to false once it has fired
  snoozedUntil?: string;  // ISO — while set + in the future, the chime is suppressed until then
  created: string;        // ISO
  lastFired?: string;     // ISO — dedupe for recurring + audit
  fireCount: number;
}

// What the caller supplies to create a Chime. Exactly one of afterMs / fireAt / recur.
export interface ChimeSpec {
  label: string;
  kind: "timer" | "alarm";
  afterMs?: number;   // relative — fire this many ms from now (a timer, or a relative alarm)
  fireAt?: string;    // absolute ISO instant
  recur?: string;     // recurring cron string (validated via scheduler.parseCron)
}

// ── Store (atomic persistence; read fresh each call so a reload sees the truth) ──
function load(): Chime[] {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")); }
  catch { /* missing or corrupt — start empty rather than crash the loop */ }
  return [];
}

function persist(list: Chime[]): void {
  // Atomic: write a sibling temp file then rename over the target, so a crash
  // mid-write can never leave a half-written chimes.json. A failed write is NOT
  // swallowed — losing chimes silently is exactly SAM's #1 failure class.
  try {
    mkdirSync(VAULT_DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(list, null, 2));
    renameSync(tmp, FILE);
  } catch (e: any) {
    console.error("[SAM] chime: FAILED to persist chimes —", e?.message || e);
  }
}

// ── Create ──
// Convenience: a named countdown (one-shot timer, `afterMs` from now).
export function setTimer(label: string, afterMs: number, now = Date.now()): Chime {
  return setChime({ label, kind: "timer", afterMs }, now);
}
// Convenience: an alarm — one-shot at an ISO instant (`at`) OR recurring (`recur`, parseCron format).
export function setAlarm(label: string, when: { at?: string; recur?: string }, now = Date.now()): Chime {
  return setChime({ label, kind: "alarm", fireAt: when.at, recur: when.recur }, now);
}

export function setChime(spec: ChimeSpec, now = Date.now()): Chime {
  const label = String(spec?.label ?? "").trim().slice(0, 200);
  if (!label) throw new Error("chime: label is required");
  if (spec.kind !== "timer" && spec.kind !== "alarm") throw new Error(`chime: unknown kind "${spec.kind}"`);

  const chime: Chime = {
    id: "chm-" + Math.random().toString(36).slice(2, 9),
    label,
    kind: spec.kind,
    enabled: true,
    created: new Date(now).toISOString(),
    fireCount: 0,
  };

  if (spec.recur != null) {
    if (!parseCron(spec.recur)) throw new Error(`chime: invalid recur "${spec.recur}"`);
    chime.recur = spec.recur.toLowerCase().trim();
  } else if (spec.afterMs != null) {
    if (!Number.isFinite(spec.afterMs) || spec.afterMs <= 0) throw new Error("chime: afterMs must be > 0");
    chime.fireAt = new Date(now + spec.afterMs).toISOString();
  } else if (spec.fireAt != null) {
    const t = new Date(spec.fireAt).getTime();
    if (Number.isNaN(t)) throw new Error(`chime: invalid fireAt "${spec.fireAt}"`);
    chime.fireAt = new Date(t).toISOString();
  } else {
    throw new Error("chime: must specify one of afterMs, fireAt, or recur");
  }

  const list = load();
  list.push(chime);
  persist(list);
  return chime;
}

// ── Read ──
export function listChimes(): Chime[] { return load(); }
export function getChime(id: string): Chime | undefined { return load().find((c) => c.id === id); }

// ── Cancel ──
export function cancelChime(id: string): boolean {
  const list = load();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return false;   // no silent success — caller learns nothing matched
  list.splice(idx, 1);
  persist(list);
  return true;
}

// ── Snooze — re-arm a chime to fire `ms` from now, suppressing it until then. ──
// Re-enables a one-shot that already fired (the classic "snooze 9 minutes").
export function snoozeChime(id: string, ms: number, now = Date.now()): Chime | null {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error("chime: snooze ms must be > 0");
  const list = load();
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  c.snoozedUntil = new Date(now + ms).toISOString();
  c.enabled = true;
  persist(list);
  return c;
}

// Is this chime due to fire at `now`?
function isDue(c: Chime, now: Date): boolean {
  if (!c.enabled) return false;
  if (c.snoozedUntil) return now.getTime() >= new Date(c.snoozedUntil).getTime();  // snoozed → nothing else matters
  if (c.recur) {
    const p = parseCron(c.recur);
    return !!p && p.shouldRun(now, c.lastFired ? new Date(c.lastFired) : null);
  }
  if (c.fireAt) return now.getTime() >= new Date(c.fireAt).getTime();
  return false;
}

export interface FireOptions {
  announce?: (title: string, msg: string) => void;  // OS banner; defaults to desktopNotify, injectable for tests
}

// ── The tick — fire every due chime. Call from the main loop with the clock. ──
// OFF BY DEFAULT: does nothing unless SAM_CHIME === "1". Firing is safe (a
// notification only), but unattended scheduling is still autonomy, so it stays
// opt-in and every fire lands in the autonomy log. Returns the chimes that fired.
//
// Each due chime rings via (1) the caller-provided `notify` (SAM's own bell /
// in-app card) and (2) a desktop notification (reaches you with the window shut).
export function fireDue(now: Date, notify: (c: Chime) => void, opts: FireOptions = {}): Chime[] {
  if (process.env.SAM_CHIME !== "1") return [];
  const announce = opts.announce ?? desktopNotify;

  const list = load();
  const due = list.filter((c) => isDue(c, now));
  if (!due.length) return [];

  // CLAIM before firing (mirrors the scheduler): mutate + persist first so neither
  // a crash nor the next tick can double-fire a chime we've already committed to.
  // One-shots flip enabled→false; recurring alarms re-arm implicitly off lastFired.
  const nowIso = now.toISOString();
  for (const c of due) {
    c.lastFired = nowIso;
    c.fireCount = (c.fireCount || 0) + 1;
    c.snoozedUntil = undefined;
    if (!c.recur) c.enabled = false;
  }
  persist(list);

  const fired: Chime[] = [];
  for (const c of due) {
    // A failing notifier is surfaced, never swallowed — but must not stop the other chimes.
    try { notify(c); }
    catch (e: any) { console.error("[SAM] chime: notify failed for", c.id, "—", e?.message || e); }
    try { announce(`SAM — ${c.kind}`, c.label); } catch { /* desktop notify is fire-and-forget */ }
    logAutonomy({ at: nowIso, behavior: "chime", kind: "acted", summary: `Chime fired: ${c.label}` });
    fired.push(c);
  }
  return fired;
}
