// ─────────────────────────────────────────────────────────────
//  S.A.M. · WORLD  — on startup SAM grabs the user's whole operation
//  so it walks in already knowing his apps, brands and socials.
//  Kept LEAN: repos are pulled async + cached (never blocks boot),
//  and only a one-line summary goes into the prompt. Details load
//  on demand via the my_apps / my_socials tools.
// ─────────────────────────────────────────────────────────────

import { promisify } from "node:util";
import { exec } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECTS } from "./projects.ts";

const sh = promisify(exec);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");   // spaces-safe
const SOCIALS_PATH = join(process.env.VAULT_DIR || join(ROOT, "vault"), "socials.json");

export interface App { name: string; desc: string; visibility: string; updated?: string }

let APPS: App[] = [];
let grabbedAt = 0;

// ── In-house apps = the user's GitHub repos (pulled via gh, cached ~30min) ──
export async function grabRepos(force = false): Promise<App[]> {
  if (APPS.length && !force && Date.now() - grabbedAt < 30 * 60_000) return APPS;
  try {
    const { stdout } = await sh(`gh repo list --limit 100 --json name,description,visibility,updatedAt`, { timeout: 20000 });
    const list = JSON.parse(stdout);
    APPS = list.map((r: any) => ({ name: r.name, desc: r.description || "", visibility: r.visibility, updated: r.updatedAt }));
    grabbedAt = Date.now();
  } catch { /* gh missing/not logged in — SAM still works, just without the app list */ }
  return APPS;
}
// ── Socials registry (vault/socials.json) — SAM knows the accounts/links ──
// worldContext() runs on every business turn, so avoid a read+parse each time — but
// key the cache on the file's mtime so a MANUAL edit (the my_socials tool tells users
// to edit the file) is picked up without a restart. A statSync is far cheaper than
// read+parse, so this keeps almost all the perf win.
let _socialsCache: Record<string, any> | null = null;
let _socialsMtime = -1;
export function loadSocials(): Record<string, any> {
  try {
    if (!existsSync(SOCIALS_PATH)) { _socialsCache = {}; _socialsMtime = -1; return _socialsCache; }
    const mtime = statSync(SOCIALS_PATH).mtimeMs;
    if (_socialsCache && mtime === _socialsMtime) return _socialsCache;
    _socialsMtime = mtime;
    const parsed = JSON.parse(readFileSync(SOCIALS_PATH, "utf8"));
    _socialsCache = parsed;
    return parsed;
  } catch { const c = _socialsCache || {}; _socialsCache = c; return c; }
}
export function saveSocials(data: Record<string, any>) {
  try {
    mkdirSync(dirname(SOCIALS_PATH), { recursive: true });
    writeFileSync(SOCIALS_PATH, JSON.stringify(data, null, 2));
    _socialsCache = data; _socialsMtime = statSync(SOCIALS_PATH).mtimeMs;   // keep cache + mtime fresh
  } catch { /* ignore */ }
}

// Seed from the brands (website known; handle slots blank for the user to fill / SAM to find).
export function seedSocials(): Record<string, any> {
  const existing = loadSocials();
  if (Object.keys(existing).length) return existing;
  const seed: Record<string, any> = {};
  for (const p of PROJECTS) {
    seed[p.name] = { website: p.domain ? `https://${p.domain}` : "", instagram: "", youtube: "", tiktok: "", x: "", facebook: "" };
  }
  saveSocials(seed);
  return seed;
}

// One-line, cheap awareness injected into the prompt (details via tools).
export function worldContext(): string {
  const socials = loadSocials();
  const withHandles = Object.values(socials).filter((s: any) => s && (s.instagram || s.youtube || s.tiktok || s.x)).length;
  return `Your operation (loaded at startup): ${APPS.length} in-house apps/repos, ${PROJECTS.length} brands, ${Object.keys(socials).length} social profiles on file (${withHandles} with handles). Pull specifics with the my_apps and my_socials tools — don't guess.`;
}

// Called once at boot. Non-blocking. Returns a short line for the boot log.
export async function grabWorld(): Promise<string> {
  seedSocials();
  await grabRepos();
  const socials = loadSocials();
  return `🌍 world grabbed · ${APPS.length} apps · ${PROJECTS.length} brands · ${Object.keys(socials).length} socials on file`;
}
