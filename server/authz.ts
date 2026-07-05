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
