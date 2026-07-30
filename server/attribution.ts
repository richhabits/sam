// ─────────────────────────────────────────────────────────────
//  S.A.M. · B5 — ATTRIBUTION
//  Every remote action logged with device identity and capability used, so a single
//  view can answer "what did the phone do yesterday." Distinct from autonomy-log.ts
//  (everything SAM did on its OWN) and security.ts's in-memory alert log (anomalies,
//  lost on restart): this is a persisted, ordinary record of REMOTE devices' own
//  actions — routine, not just dodgy ones, and it must survive a restart to answer
//  "yesterday" honestly.
//
//  What gets logged is the SHAPE of the action (device, capability, job kind), never
//  its content — same discipline as B4's push redaction. "iPhone · Safari assigned a
//  project.build task" is useful and safe; the task's prompt or its answer is neither
//  this file's business nor stored here.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "attribution-log.json");
const MAX = 1000;

// The capabilities this log actually sees exercised — matches the write paths that call
// logAttribution below. Not the same list as pairing.ts's Grant type: this also covers
// the always-free tier (assign-task, cancel, retry) that needs no grant to use.
export type Capability = "assign-task" | "cancel" | "retry" | "raise-budget" | "revoke-device" | "set-grants";

export interface AttributionEntry {
  at: string;          // ISO timestamp
  deviceId: string;    // the session hash from server/pairing.ts — stable even if the device is later revoked
  deviceLabel: string; // a SNAPSHOT of the label at the time of the action, not a live lookup — a
                        // revoked or re-labelled device must not rewrite its own history
  capability: Capability;
  detail: string;      // short, already-safe context (a job kind, not a job's content)
}

function read(): AttributionEntry[] {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []; } catch { return []; }
}

// `at` is stamped by the caller (server code has a real clock) so this stays pure + testable,
// same convention as autonomy-log.ts's logAutonomy.
export function logAttribution(e: Omit<AttributionEntry, "at"> & { at?: string }): void {
  const list = read();
  list.push({ ...e, at: e.at ?? new Date().toISOString(), detail: String(e.detail || "").slice(0, 200) });
  const trimmed = list.length > MAX ? list.slice(list.length - MAX) : list;
  try { writeFileAtomic(FILE, JSON.stringify(trimmed, null, 2)); } catch { /* best-effort — attribution is an audit aid, not a control */ }
}

// "What did the phone do yesterday" — filterable by device and/or a time window, newest first.
export function readAttribution(opts: { deviceId?: string; sinceMs?: number; limit?: number } = {}): AttributionEntry[] {
  let list = read();
  if (opts.deviceId) list = list.filter((e) => e.deviceId === opts.deviceId);
  if (opts.sinceMs !== undefined) list = list.filter((e) => new Date(e.at).getTime() >= opts.sinceMs!);
  const limit = opts.limit ?? 100;
  return list.slice(Math.max(0, list.length - limit)).reverse();
}

export function clearAttribution(): void {
  try { if (existsSync(FILE)) writeFileAtomic(FILE, "[]"); } catch { /* best-effort */ }
}
