// ─────────────────────────────────────────────────────────────
//  S.A.M. · ISSUES  — strictly-local error capture + breadcrumbs.
//
//  SAM's black box. No network EVER — nothing is transmitted. SAM's recurring
//  failure mode is SILENT failures — swallowed catches, no-op "successes". This gives them a place
//  to land: a caught error records a structured ISSUE (message + stack + recent breadcrumbs + host
//  context), grouped by fingerprint so a recurring fault reads "seen N times", surfaced in doctor.
//
//  Three non-negotiables:
//   • STRICTLY LOCAL. Nothing is transmitted — there is no transport. Honors telemetry-off by
//     construction (a local log the user reads in their own app is not telemetry).
//   • REDACTED. Breadcrumbs carry tool args / file paths / model output, which can hold API keys.
//     Everything is scrubbed before storage — a local issue log must never become a secrets log.
//   • NEVER SWALLOWS ITS OWN ERRORS. An observability layer that fails silently is the worst irony;
//     if capture() itself throws, it falls back to console.error, never to nothing.
// ─────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { arch, platform, totalmem } from "node:os";

export type Crumb = { at: string; kind: "tool" | "model" | "file" | "state" | "note"; msg: string; data?: Record<string, unknown> };
export interface Issue {
  fingerprint: string;
  message: string;
  stack?: string;
  count: number;
  firstAt: string;
  lastAt: string;
  context: Record<string, unknown>;
  breadcrumbs: Crumb[];
}

const MAX_CRUMBS = 40;    // bounded ring — recent activity only
const MAX_ISSUES = 100;   // distinct fault groups kept; oldest-seen evicted past this
const MAX_STR = 200;      // truncate any single stored string (file contents etc.)

const crumbs: Crumb[] = [];
const issues = new Map<string, Issue>();

// ── redaction ──
const SECRET_RES: RegExp[] = [
  /\b(?:sk|gsk|csk|xai|pplx|fw)[-_][A-Za-z0-9-]{16,}\b/g, // provider key prefixes
  /\bAIza[A-Za-z0-9_-]{30,}\b/g, // google
  /\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // github
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // slack
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, // bearer tokens
  /\b[A-Fa-f0-9]{32,}\b/g, // long hex — tokens/hashes/session ids
];

/** Scrub secrets from a string and cap its length. Exported for the redaction tests. */
export function redact(input: unknown): string {
  let s = typeof input === "string" ? input : safeString(input);
  for (const re of SECRET_RES) s = s.replace(re, "[redacted]");
  // key: value / key=value where the key name reads sensitive.
  s = s.replace(/\b(token|api[_-]?key|key|secret|password|passphrase|authorization|auth)\b(\s*[=:]\s*)(["']?)[^\s"',}]+\3/gi, "$1$2[redacted]");
  return s.length > MAX_STR ? `${s.slice(0, MAX_STR)}…[+${s.length - MAX_STR}]` : s;
}

function safeString(v: unknown): string {
  try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); }
}

function redactData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    // A key whose NAME is sensitive is redacted wholesale, regardless of value shape.
    out[k] = /token|key|secret|password|passphrase|auth/i.test(k) ? "[redacted]" : redact(v);
  }
  return out;
}

// ── breadcrumbs ──
/** Record a recent-activity crumb. Bounded ring; data is redacted before storage. */
export function breadcrumb(kind: Crumb["kind"], msg: string, data?: Record<string, unknown>): void {
  try {
    crumbs.push({ at: new Date().toISOString(), kind, msg: redact(msg), data: redactData(data) });
    while (crumbs.length > MAX_CRUMBS) crumbs.shift();
  } catch (e) {
    // Never let observability break the thing it observes — but never vanish either.
    console.error("issues.breadcrumb failed:", e);
  }
}

function hostContext(): Record<string, unknown> {
  return { version: process.env.SAM_APP_VERSION || "dev", os: `${platform()} ${arch()}`, ramGb: Math.round(totalmem() / 2 ** 30), node: process.version };
}

// Fingerprint groups the SAME fault across occurrences: error name + a message with the volatile
// bits (numbers, paths, quoted ids) normalised out, so "read /a/1.md" and "read /b/2.md" are one
// group. Deliberately NOT keyed on the stack frame: the same fault recurring from one call site and
// the same fault from two sites should still read as one recurring issue, and message+name is the
// signal a human recognises. (The full stack is still STORED for diagnosis, just not in the key.)
function fingerprintOf(name: string, message: string): string {
  const norm = message
    .replace(/([/\\][\w.\-@]+)+/g, "/…")
    .replace(/0x[0-9a-f]+|\b\d[\d.,:]*\b/gi, "#")
    .replace(/["'`][^"'`]*["'`]/g, "'…'");
  return createHash("sha256").update(`${name}|${norm}`).digest("hex").slice(0, 16);
}

/**
 * Record a caught error as a grouped local issue. Returns the issue (or null if capture itself
 * failed — logged, never swallowed). context is merged over the host context and redacted.
 */
export function capture(err: unknown, context?: Record<string, unknown>): Issue | null {
  try {
    const e = err instanceof Error ? err : new Error(safeString(err));
    const fp = fingerprintOf(e.name || "Error", e.message || "");
    const now = new Date().toISOString();
    const existing = issues.get(fp);
    if (existing) {
      existing.count++;
      existing.lastAt = now;
      existing.breadcrumbs = crumbs.slice(-MAX_CRUMBS); // freshest trail for the latest occurrence
      return existing;
    }
    const issue: Issue = {
      fingerprint: fp,
      message: redact(e.message || e.name || "unknown error"),
      stack: e.stack ? redact(e.stack) : undefined,
      count: 1,
      firstAt: now,
      lastAt: now,
      context: { ...hostContext(), ...(redactData(context) ?? {}) },
      breadcrumbs: crumbs.slice(-MAX_CRUMBS),
    };
    issues.set(fp, issue);
    // Bounded: evict the least-recently-seen group past the cap.
    if (issues.size > MAX_ISSUES) {
      let oldest: Issue | null = null;
      for (const i of issues.values()) if (!oldest || i.lastAt < oldest.lastAt) oldest = i;
      if (oldest) issues.delete(oldest.fingerprint);
    }
    return issue;
  } catch (metaErr) {
    console.error("issues.capture failed (the observability layer must not swallow its own errors):", metaErr);
    return null;
  }
}

/** All grouped issues, most-recently-seen first. */
export function listIssues(): Issue[] {
  return [...issues.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Compact summary for the doctor/status surface. */
export function issuesSummary(): { total: number; distinct: number; clear: boolean; top: { message: string; count: number; lastAt: string }[] } {
  const all = listIssues();
  return {
    total: all.reduce((n, i) => n + i.count, 0),
    distinct: all.length,
    clear: all.length === 0,
    top: all.slice(0, 5).map((i) => ({ message: i.message, count: i.count, lastAt: i.lastAt })),
  };
}

/** Test/maintenance helper — clears breadcrumbs + issues. */
export function _reset(): void { crumbs.length = 0; issues.clear(); }
