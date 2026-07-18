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
  // A failed write here is genuinely dangerous: the in-memory grant/revoke diverges from disk,
  // so on the next boot a revoked standing authorization can come BACK, or a granted one vanish.
  // Don't throw (callers are on hot paths and doctrine #8 keeps the loops alive) — but never
  // let it be invisible.
  try { mkdirSync(VAULT_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify([...load()])); }
  catch (e: any) { console.error("[SAM] authz: FAILED to persist standing authorizations —", e?.message || e); }
}

export function isAllowed(tool: string): boolean { return load().has(tool); }
export function allow(tool: string) { if (isDangerous(tool)) return; load().add(tool); save(); }   // dangerous tools can NEVER be standing-allowed
export function disallow(tool: string) { load().delete(tool); save(); }
export function listAllowed(): string[] { return [...load()]; }

// ── PERMISSION TIERS (v1.2) ─────────────────────────────────────────────────────
// Every tool is one of three tiers:
//   • safe      — read-only / harmless (tool.safe === true) → runs without asking.
//   • confirm   — recoverable-but-notable (in CONFIRM below) → asks by default; Autopilot / a
//                 standing "always allow" / Elon Mode may skip it.
//   • dangerous — outward-facing, destructive, or security-altering (DANGEROUS below) → ALWAYS
//                 asks. No bypass by Autopilot, Swarm, or a standing "always allow" — the ONLY
//                 skip is an interactive, opt-in Elon-Mode session (user present, accepts the risk).
//
// DANGEROUS covers: shell/code-exec, send (outward), push/publish, delete/wipe, and security-settings.
export const DANGEROUS = new Set([
  // shell + code-execution-equivalent (a terminal can be driven via these)
  "run_command", "run_script", "applescript", "type_text", "press_key", "click",
  // send / outward-facing (can't be un-sent; may reach real people)
  "send_email", "send_mail", "send_imessage", "call", "facetime", "post_everywhere",
  // push / publish (changes remote/public state)
  "git_push", "github_pr", "github_create_issue",
  // delete / wipe (data + device destruction)
  "empty_trash", "trash_file", "eject_disk", "kill_process", "kill_port",
  "clear_all_memories", "forget_memory", "forget_docs", "prune_vault",
  // security settings — an agent must NEVER silently change its own permissions/keys (privilege escalation)
  "manage_api_keys", "manage_authorizations", "manage_autopilot",
]);

// Dynamically-registered dangerous tools — forged tools (v1.5) that declare a `net` or `fs:write`
// capability are marked dangerous AT REGISTRATION, so the gate treats them exactly like the static
// dangerous set (always ask, never standing-allowable). A forged tool can never mark itself safe.
const DYNAMIC_DANGEROUS = new Set<string>();
export function markDangerous(name: string) { DYNAMIC_DANGEROUS.add(name); }
export function unmarkDangerous(name: string) { DYNAMIC_DANGEROUS.delete(name); }
export function isDangerous(name: string): boolean { return DANGEROUS.has(name) || DYNAMIC_DANGEROUS.has(name); }

let AUTOPILOT = false;
export function setAutopilot(on: boolean) { AUTOPILOT = !!on; }
export function autopilotOn(): boolean { return AUTOPILOT; }

// ── ELON MODE — the explicit, opt-in "off-leash" override (huge warning in the UI).
// When active, SAM skips the confirm prompt for everything. Used for massive engineering pushes with
// the user present. Deletes still land in a 30-day bin. A background SWARM never inherits this for
// dangerous tools (see mayAutoRun's swarm flag) — nothing outward/destructive fires unattended.
let ELON_MODE = process.env.SAM_ELON_MODE === "true";
export function setElonMode(on: boolean) { ELON_MODE = !!on; }
export function isElonMode(): boolean { return ELON_MODE; }

// The tier of a tool, given its `safe` flag. Single classifier used by the gate + /api/tools.
export function toolTier(name: string, safe: boolean): "safe" | "confirm" | "dangerous" {
  if (isDangerous(name)) return "dangerous";
  if (safe) return "safe";
  return "confirm";
}

// May this !safe tool run WITHOUT asking? `swarm` = true means it's an unattended background agent.
//   • dangerous → NEVER, except an interactive Elon-Mode session (never a swarm).
//   • confirm   → yes if Autopilot is on, a standing "always allow" covers it, or Elon Mode.
export function mayAutoRun(tool: string, swarm = false): boolean {
  if (isDangerous(tool)) return ELON_MODE && !swarm;
  if (ELON_MODE) return true;
  return isAllowed(tool) || AUTOPILOT;
}
