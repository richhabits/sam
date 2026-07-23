// ─────────────────────────────────────────────────────────────
//  S.A.M. · AUTONOMY LOG  (v1.8)
//  An append-only, local record of everything SAM did or suggested ON ITS OWN. Paired with the consent
//  pane, this is the audit half of the trust contract: the user can always see exactly what autonomy
//  has produced. Never uploaded. Bounded so it can't grow without limit.
//    • suggested — SAM surfaced a suggestion card (nothing ran)
//    • acted     — an autonomous path ran a SAFE tool automatically
//    • blocked   — an autonomous path WANTED a dangerous action; the gate stopped it and asked instead
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "autonomy-log.json");
const MAX = 500;

export type AutonomyKind = "suggested" | "acted" | "blocked";
export interface AutonomyEntry { at: string; behavior: string; kind: AutonomyKind; summary: string; tool?: string }

function read(): AutonomyEntry[] {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []; } catch { return []; }
}

// `at` is stamped by the caller (server code has a real clock) so this stays pure + testable.
export function logAutonomy(e: AutonomyEntry): void {
  const list = read();
  list.push(e);
  const trimmed = list.length > MAX ? list.slice(list.length - MAX) : list;
  // Atomic: the trust-contract audit trail must not be truncated to nothing by a crash mid-write.
  try { writeFileAtomic(FILE, JSON.stringify(trimmed, null, 2)); } catch { /* best-effort */ }
}

export function readAutonomyLog(limit = 100): AutonomyEntry[] {
  const list = read();
  return list.slice(Math.max(0, list.length - limit)).reverse();   // newest first
}

export function clearAutonomyLog(): void {
  try { if (existsSync(FILE)) writeFileAtomic(FILE, "[]"); } catch { /* best-effort */ }
}
