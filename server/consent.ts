// ─────────────────────────────────────────────────────────────
//  S.A.M. · AUTONOMY CONSENT  (v1.8 — the trust contract)
//
//  The single source of truth for "what can SAM do on its own?". Every proactive / autonomous
//  behavior is registered here and is OFF BY DEFAULT. SAM may only *surface* a proactive behavior
//  when the user has explicitly enabled it.
//
//  CRITICAL: enabling a behavior is autonomy in SCHEDULING, never autonomy in PERMISSIONS. A proactive
//  path may surface a suggestion, but EXECUTING any action still goes through the v1.2 permission gate
//  (authz.ts) — dangerous tools ALWAYS ask first, with no bypass from any consent flag. Consent decides
//  whether SAM speaks up unprompted; the gate decides whether anything actually runs.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const FILE = join(VAULT_DIR, "consent.json");

// Every autonomous behavior SAM can be granted. Add new proactive features here so they inherit
// off-by-default + a single visible toggle. `dangerousCapable` = this behavior could, if it proposed
// a dangerous action, need the gate — surfaced in the UI so the user knows nothing runs unattended.
export type Behavior =
  | "daily-briefing"
  | "file-watch-suggestions"
  | "reminders"
  | "workflow-schedule"
  | "standing-crew"
  | "cameras"
  | "learn-preferences";

export const BEHAVIORS: { id: Behavior; label: string; detail: string; dangerousCapable: boolean }[] = [
  { id: "daily-briefing", label: "Morning briefing", detail: "Once a day, summarise what changed in watched folders + overnight task results. Runs on your local brain (free).", dangerousCapable: false },
  { id: "file-watch-suggestions", label: "File-watch suggestions", detail: "When something lands in a watched folder, offer a suggestion card (e.g. “summarise this contract?”). Only a suggestion — nothing runs until you accept.", dangerousCapable: false },
  { id: "reminders", label: "Reminders", detail: "Notify you when a reminder you set comes due.", dangerousCapable: false },
  { id: "workflow-schedule", label: "Run saved workflows on schedule", detail: "Let workflows you've saved run on their schedule. A workflow that hits a dangerous step PAUSES for your confirmation — it never runs a dangerous action unattended.", dangerousCapable: true },
  { id: "standing-crew", label: "Standing Crew (background specialists)", detail: "Let specialists you've armed run their task in the background on a schedule. A run that needs a risky/destructive step PAUSES for your approval via the Ask — it never runs a dangerous action unattended.", dangerousCapable: true },
  { id: "cameras", label: "Cameras (local only)", detail: "Let SAM show you cameras on your own network — a nursery, dog, or doorway cam. Local-only and enforced: SAM refuses any camera that isn't on your network, records nothing, uploads nothing, and never stores camera credentials. Cloud cams (Ring) need your login and aren't wired.", dangerousCapable: false },
  { id: "learn-preferences", label: "Learn my preferences", detail: "Notice durable patterns (wording, preferred brains, formats) and adapt. 100% on-device — nothing learned about you ever leaves the machine.", dangerousCapable: false },
];

const IDS = new Set<Behavior>(BEHAVIORS.map((b) => b.id));

type State = Partial<Record<Behavior, boolean>>;

let cache: State | null = null;
function load(): State {
  if (cache) return cache;
  try { cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}; } catch { cache = {}; }
  return cache!;
}
function persist() { try { mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(load(), null, 2)); } catch { /* best-effort */ } }

// The ONLY gate for surfacing a proactive behavior. Unknown or unset ⇒ false (off by default).
export function isEnabled(b: Behavior): boolean {
  if (!IDS.has(b)) return false;
  return load()[b] === true;
}

export function setEnabled(b: Behavior, on: boolean): boolean {
  if (!IDS.has(b)) return false;
  load()[b] = !!on; persist(); return true;
}

// Full state for the "What can SAM do on its own?" pane — every behavior, with its current value
// (defaulted OFF), label, detail, and whether it can propose dangerous actions.
export function consentState() {
  const s = load();
  return BEHAVIORS.map((b) => ({ ...b, enabled: s[b.id] === true }));
}

// Turn everything off in one action (the "pause all autonomy" switch).
export function disableAll() { cache = {}; persist(); }
