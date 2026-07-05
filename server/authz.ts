// ─────────────────────────────────────────────────────────────
//  S.A.M. · AUTHORIZATIONS  — standing "yes, I authorise you".
//  When the user says "always allow this", the tool is added here and
//  future calls run WITHOUT asking. Persisted locally.
//  Safety floor stays ON regardless: the catastrophic-command
//  denylist in tools.ts still blocks rm -rf, mkfs, etc. even if
//  run_command is authorized.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const FILE = join(VAULT_DIR, "authorized.json");

let allowed: Set<string> | null = null;

function load(): Set<string> {
  if (allowed) return allowed;
  try { allowed = new Set(existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []); }
  catch { allowed = new Set(); }
  return allowed;
}
function save() {
  try { mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify([...load()])); } catch {}
}

export function isAllowed(tool: string): boolean { return load().has(tool); }
export function allow(tool: string) { load().add(tool); save(); }
export function disallow(tool: string) { load().delete(tool); save(); }
export function listAllowed(): string[] { return [...load()]; }

// ── AUTOPILOT — "lift the silly work". When on, SAM runs low-consequence actions
//  autonomously (no asking). But these ALWAYS ask, even in autopilot, because
//  they're outward-facing, cost money, or can't be undone. Safety never sleeps.
const ALWAYS_ASK = new Set([
  "send_email", "send_imessage", "call", "facetime", "run_command", "run_script",
  "git_commit", "git_push", "github_pr", "github_create_issue", "play",
]);
let AUTOPILOT = false;
export function setAutopilot(on: boolean) { AUTOPILOT = !!on; }
export function autopilotOn(): boolean { return AUTOPILOT; }

// ── ELON MODE — the ruthless automation override.
// When active, SAM bypasses ALL ALWAYS_ASK safety checks. Used for massive, unattended
// engineering swarms. Comes with a 30-day safety bin for destructive bash commands.
let ELON_MODE = process.env.SAM_ELON_MODE === "true";
export function setElonMode(on: boolean) { ELON_MODE = !!on; }
export function isElonMode(): boolean { return ELON_MODE; }

// True when a risky tool may run without asking (authorized OR autopilot + not always-ask).
export function mayAutoRun(tool: string): boolean {
  if (ELON_MODE) return true;
  return isAllowed(tool) || (AUTOPILOT && !ALWAYS_ASK.has(tool));
}
