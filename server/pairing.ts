// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE PAIRING — how a BROWSER earns the Handshake.
//
//  The Handshake (a per-launch passkey delivered via Electron preload) authenticates the desktop
//  app, but a browser tab / Chrome-App / phone CANNOT read that preload secret. Turning the
//  Handshake off to let them in trades a real lock for none: an unauthenticated mutating API on
//  127.0.0.1 is reachable by any local process AND — via DNS rebinding — by a malicious webpage that
//  re-points its own domain at loopback. SAM holds deploy tokens, file and git tools; that is far too
//  much to leave on the latch.
//
//  So browsers authenticate the way local web tools have since Jupyter: a one-time pairing code is
//  exchanged, ONCE, for a long-lived server-side SESSION, carried by an HttpOnly + SameSite=Strict
//  cookie. Why that closes rebinding where a JS-readable token would not: the cookie is scoped to the
//  origin it was set on (localhost:PORT), so a rebound attacker.com→127.0.0.1 request carries
//  attacker.com's cookies, never SAM's — the session simply isn't presented, and the Host guard
//  rejects the domain name on top. HttpOnly keeps script from reading it; SameSite=Strict keeps it
//  off cross-site requests entirely.
//
//  Sessions are revocable and roll a 30-day expiry. The raw token is NEVER stored — only its SHA-256,
//  so a database read cannot resurrect a live session. Pairing codes are single-use and short-lived.
// ─────────────────────────────────────────────────────────────

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";

export const SESSION_COOKIE = "sam_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30-day rolling expiry
const CODE_TTL_MS = 5 * 60 * 1000;                 // a pairing code is good for 5 minutes
const TOUCH_THROTTLE_MS = 60 * 60 * 1000;          // only rewrite last_seen once an hour (roll without write-amplifying)

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const db = openDb(join(VAULT_DIR, "sessions.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    hash      TEXT PRIMARY KEY,   -- SHA-256 of the cookie token (never the token itself)
    created   INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    label     TEXT NOT NULL DEFAULT ''
  )
`);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// Pending single-use pairing codes: hash → expiry. In memory — they live for minutes and must not
// survive a restart (a leaked-but-stale code should never pair). Keyed by hash so the log/heap never
// holds a usable code.
const pendingCodes = new Map<string, number>();

/** Mint a one-time pairing code (returned raw, ONCE). Exchange it via claimCode() for a session. */
export function mintPairingCode(now: number): string {
  for (const [h, exp] of pendingCodes) if (exp <= now) pendingCodes.delete(h);   // prune
  const code = randomBytes(16).toString("hex");   // 32 hex chars, single-use, short-lived
  pendingCodes.set(sha(code), now + CODE_TTL_MS);
  return code;
}

/** Exchange a valid, unexpired, single-use code for a new session. Returns the raw session token
 *  (to set as the cookie) or null if the code is unknown/expired/already used. */
export function claimCode(code: string, now: number, label = "browser"): string | null {
  const h = sha(String(code || ""));
  const exp = pendingCodes.get(h);
  if (!exp || exp <= now) { pendingCodes.delete(h); return null; }
  pendingCodes.delete(h);   // SINGLE USE — consumed whether or not the session write succeeds below
  const token = randomBytes(32).toString("base64url");
  db.prepare(`INSERT INTO sessions (hash, created, last_seen, label) VALUES (?, ?, ?, ?)`)
    .run(sha(token), now, now, String(label).slice(0, 60));
  return token;
}

/** Is this raw session token a live session? Rolls the 30-day window on use (throttled). */
export function validateSession(token: string | undefined, now: number): boolean {
  if (!token) return false;
  const h = sha(token);
  const row = db.prepare(`SELECT hash, last_seen FROM sessions WHERE hash = ?`).get(h) as { hash: string; last_seen: number } | undefined;
  if (!row) return false;
  // Constant-time compare on the (already-hashed) lookup key — the SELECT matched, this is belt-and-braces.
  if (row.hash.length !== h.length || !timingSafeEqual(Buffer.from(row.hash), Buffer.from(h))) return false;
  if (now - row.last_seen > SESSION_TTL_MS) { db.prepare(`DELETE FROM sessions WHERE hash = ?`).run(h); return false; }   // expired → prune
  if (now - row.last_seen > TOUCH_THROTTLE_MS) db.prepare(`UPDATE sessions SET last_seen = ? WHERE hash = ?`).run(now, h);
  return true;
}

/** Pull the session token out of a Cookie header (defensive decode — a bad cookie is just no session). */
export function sessionTokenFromCookie(cookieHeader: string | undefined): string {
  const m = (cookieHeader || "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch { return ""; }
}

/** The Set-Cookie value for a freshly-minted session. Same-origin local app: HttpOnly + Strict +
 *  Max-Age; no Secure flag because loopback is plain http (Strict + HttpOnly carry the weight). */
export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

/** Clear the cookie on the client (used by revoke). */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function revokeAllSessions(): number {
  const n = sessionCount();
  db.prepare(`DELETE FROM sessions`).run();
  return n;
}
export function revokeSession(token: string): boolean {
  const r = db.prepare(`DELETE FROM sessions WHERE hash = ?`).run(sha(String(token || "")));
  return r.changes > 0;
}
export function sessionCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n;
}
