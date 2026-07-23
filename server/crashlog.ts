// ─────────────────────────────────────────────────────────────
//  S.A.M. · CRASH SAFETY NET  (v1.5 Phase 2)
//
//  A LOCAL-ONLY, rotating crash log — nothing is ever uploaded (the zero-
//  telemetry promise holds). When something throws unexpectedly it's appended
//  here, and the user can voluntarily "copy a diagnostic bundle" to paste into
//  a GitHub issue. The bundle is REDACTED — keys, tokens and home paths are
//  scrubbed before it ever reaches the clipboard.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync, mkdirSync, appendFileSync, statSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform, release, totalmem, arch } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const LOG = join(VAULT_DIR, "crash.log");
const LOG_PREV = join(VAULT_DIR, "crash.log.1");
const MAX_BYTES = 512 * 1024;   // rotate at 512KB, keep one previous — bounded forever

// Scrub anything that could be sensitive before it's shown or copied.
export function redact(s: string): string {
  return (s || "")
    .replace(new RegExp(homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "~")   // home path → ~
    .replace(/\b(sk-[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{10,}|gsk_[A-Za-z0-9]{10,}|nvapi-[A-Za-z0-9_-]{10,}|vcp_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, "«redacted-key»")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "«redacted-token»")                             // long opaque secrets
    .replace(/(authorization|api[_-]?key|token|password|passphrase|secret)("?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1$2«redacted»");
}

function rotateIfNeeded() {
  try { if (existsSync(LOG) && statSync(LOG).size > MAX_BYTES) renameSync(LOG, LOG_PREV); } catch { /* best-effort */ }
}

// Record a crash/exception. `iso` is passed in (no Date.now() surprises for callers/tests).
export function recordCrash(kind: string, err: unknown, iso: string): void {
  try {
    if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true });
    rotateIfNeeded();
    const e = err as any;
    const msg = redact(String(e?.stack || e?.message || e));
    appendFileSync(LOG, `\n─── ${iso} · ${kind} ───\n${msg}\n`);
  } catch { /* never let the crash logger itself crash the process */ }
}

export function recentCrashes(maxBytes = 20_000): string {
  try {
    if (!existsSync(LOG)) return "";
    const raw = readFileSync(LOG, "utf8");
    return redact(raw.length > maxBytes ? raw.slice(-maxBytes) : raw);
  } catch { return ""; }
}

export function crashStats() {
  try { return { hasLog: existsSync(LOG), bytes: existsSync(LOG) ? statSync(LOG).size : 0 }; }
  catch { return { hasLog: false, bytes: 0 }; }
}

// A voluntary, redacted diagnostic bundle the user can paste into a GitHub issue.
export function diagnosticBundle(version: string, iso: string): string {
  const env = {
    version, when: iso,
    platform: platform(), release: release(), arch: arch(),
    node: process.version, memGB: Math.round(totalmem() / 1e9),
    channel: process.env.SAM_UPDATE_CHANNEL || "stable",
  };
  return [
    "### SAM diagnostic bundle (local-only until you paste it — redacted)",
    "```json",
    JSON.stringify(env, null, 2),
    "```",
    "### Recent crash log",
    "```",
    recentCrashes(12_000) || "(no crashes recorded)",
    "```",
  ].join("\n");
}

// Install process-level handlers. Call once at boot. `now()` supplies the timestamp.
export function installCrashHandlers(now: () => string = () => new Date().toISOString()): void {
  process.on("uncaughtException", (err) => recordCrash("uncaughtException", err, now()));
  process.on("unhandledRejection", (reason) => recordCrash("unhandledRejection", reason, now()));
}
