// ─────────────────────────────────────────────────────────────
//  S.A.M. · PROACTIVE  — the "alive" layer
//  A morning brief + nudges that reach out to you first. Slim:
//  one light timer (checks every 5 min), nudges in a local file,
//  the brief composed once a day. Delivered as a macOS notification
//  (works even if the window's closed) + queued for the app.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { exec } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NUDGES = join(ROOT, "vault", "nudges.json");
const STATE = join(ROOT, "vault", "proactive-state.json");

export interface Nudge { id: string; text: string; due?: string; done: boolean; notified: boolean; created: string }

function load<T>(p: string, fallback: T): T {
  try { if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")); } catch { /* ignore */ }
  return fallback;
}
function save(p: string, data: any) {
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(data, null, 2)); } catch { /* ignore */ }
}

// ── Nudge store ──
export function addNudge(text: string, due?: string): Nudge {
  const list = load<Nudge[]>(NUDGES, []);
  const n: Nudge = { id: Math.random().toString(36).slice(2, 9), text: String(text).slice(0, 200), due, done: false, notified: false, created: new Date().toISOString() };
  list.push(n); save(NUDGES, list); return n;
}
export function listNudges(): Nudge[] { return load<Nudge[]>(NUDGES, []).filter((n) => !n.done); }
export function completeNudge(idOrText: string): string {
  const list = load<Nudge[]>(NUDGES, []);
  const n = list.find((x) => !x.done && (x.id === idOrText || x.text.toLowerCase().includes(String(idOrText).toLowerCase())));
  if (!n) return "No matching nudge.";
  n.done = true; save(NUDGES, list); return `Done: “${n.text}”`;
}
function dueNudges(): Nudge[] {
  const now = Date.now();
  return load<Nudge[]>(NUDGES, []).filter((n) => !n.done && !n.notified && n.due && new Date(n.due).getTime() <= now);
}
function markNotified(ids: string[]) {
  const list = load<Nudge[]>(NUDGES, []);
  for (const n of list) if (ids.includes(n.id)) n.notified = true;
  save(NUDGES, list);
}

// ── Delivery ──
function macNotify(title: string, msg: string) {
  if (process.platform !== "darwin") return;
  const esc = (s: string) => s.replace(/"/g, '\\"').replace(/\n/g, " ");
  exec(`osascript -e 'display notification "${esc(msg).slice(0, 220)}" with title "${esc(title)}"'`, () => {});
}

// Queue of things for the app to show next time it checks.
let pending: { type: "brief" | "nudge"; text: string; at: string }[] = [];
export function takePending() { const p = pending; pending = []; return p; }

// ── Scheduler ──
const briefTime = () => (process.env.SAM_BRIEF_TIME || "08:00");
function hhmm(d = new Date()) { return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
function today() { return new Date().toLocaleDateString("en-GB"); }

export function startProactive(composeBrief: () => Promise<string>) {
  if (process.env.SAM_NO_PROACTIVE === "1") return;
  const tick = async () => {
    try {
      // 1) due nudges → notify + queue
      const due = dueNudges();
      if (due.length) {
        for (const n of due) { macNotify("SAM — reminder", n.text); pending.push({ type: "nudge", text: `⏰ ${n.text}`, at: hhmm() }); }
        markNotified(due.map((n) => n.id));
      }
      // 2) morning brief — once per day, at/after the brief time
      const st = load<{ lastBrief?: string }>(STATE, {});
      if (st.lastBrief !== today() && hhmm() >= briefTime()) {
        save(STATE, { ...st, lastBrief: today() });   // mark first (avoid double-fire)
        const brief = await composeBrief().catch(() => "");
        if (brief) { macNotify("SAM — morning brief", brief.replace(/[#*`]/g, "").slice(0, 200)); pending.push({ type: "brief", text: brief, at: hhmm() }); }
      }
    } catch { /* never let the timer crash the app */ }
  };
  void tick();                          // run once on boot (catches a nudge already due)
  setInterval(tick, 5 * 60_000);        // every 5 min — negligible
}
