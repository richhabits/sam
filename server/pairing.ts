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
const CODE_TTL_MS = 15 * 60 * 1000;                // a pairing code is good for 15 minutes (forgiving for a walk-to-the-phone hand-off; still single-use + short-lived)
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
// B3 — per-device capability tiers. A device from before this existed has no row here yet;
// the additive ALTER (same pattern as server/yard/store.ts's own migrations) means it just
// gets the default '{}' — no grants — rather than the app failing to open its own db.
try { db.exec(`ALTER TABLE sessions ADD COLUMN grants TEXT NOT NULL DEFAULT '{}'`); } catch { /* already there */ }

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

// C2 — a native app has no browser cookie jar shared with its own HTTP client, so the
// HttpOnly cookie that protects a WEB session (see this file's header — it exists to defeat
// DNS-rebinding-style attacks from a malicious PAGE's JS) doesn't even apply: there is no
// page, no JS-in-a-browser-context that could read it either way. The standard native-app
// equivalent is a bearer token held in the OS keychain, sent explicitly on every request —
// which is what this reads, as a fallback ONLY when no session cookie was presented. A
// browser paired via the cookie flow is completely unaffected; this never replaces or
// weakens that path, only adds a second valid carrier for the exact same kind of token.
export function sessionTokenFromRequest(req: { headers?: { cookie?: string; authorization?: string } }): string {
  const fromCookie = sessionTokenFromCookie(req.headers?.cookie);
  if (fromCookie) return fromCookie;
  const auth = req.headers?.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

// The same "id" listSessions()/getGrants() use, derived from a raw cookie token — so a
// caller that already has the token (a request handler, mid-request) can look up or check
// that device's own grants without a second round-trip or exposing the hashing itself.
export function sessionIdFromToken(token: string): string {
  return sha(String(token || ""));
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

// ── B2 — the device registry ──────────────────────────────────────────────
// Every session already IS a device credential (first-seen/last-seen/label);
// nothing about the sessions table itself needed to change, only a way to see
// and manage it one row at a time instead of only "how many" (sessionCount)
// and "burn them all" (revokeAllSessions).

export interface DeviceSession { id: string; created: number; lastSeen: number; label: string; grants: Grants }

// `hash` is the primary key and safe to hand back as an "id": it's a one-way SHA-256 of
// the raw token, so exposing it in a device list can never be used to reconstruct a
// working session cookie — the same reason the raw token itself is never stored.
export function listSessions(): DeviceSession[] {
  const rows = db.prepare(`SELECT hash, created, last_seen, label, grants FROM sessions ORDER BY last_seen DESC`).all() as
    { hash: string; created: number; last_seen: number; label: string; grants: string }[];
  return rows.map((r) => {
    let grants: Grants = {};
    try { grants = JSON.parse(r.grants) || {}; } catch { /* corrupt row — treat as no grants, never as all-granted */ }
    return { id: r.hash, created: r.created, lastSeen: r.last_seen, label: r.label, grants };
  });
}

// Revoke ONE device by the id listSessions() handed out — distinct from revokeSession(),
// which takes the raw token (only the browser holding the cookie has that). This is what
// an operator clicking "revoke" on a device THEY are looking at, not holding, calls.
export function revokeSessionById(id: string): boolean {
  const r = db.prepare(`DELETE FROM sessions WHERE hash = ?`).run(String(id || ""));
  return r.changes > 0;
}

// A friendly label from the one thing every pairing request already carries — the User-
// Agent — so a device registry says "iPhone · Safari" instead of "browser" for every
// single row. Best-effort and cosmetic only: nothing security-relevant reads this string.
// C2 — the native app can't be identified from a User-Agent: React Native's is a bare
// "CFNetwork/… Darwin/…" with no device or product in it, so a paired iPhone landed in the
// registry as "device · browser". That matters more than cosmetics suggests — this list IS
// the operator's revoke surface, and a row that misnames what it is makes "which of these
// do I kill?" a guess. So a native client names its PLATFORM through a dedicated header.
// Deliberately a closed allowlist and not a free-text label: the client is naming itself,
// and a device that could write its own row in the security list could write "Romeo's Mac".
const NATIVE_CLIENTS: Record<string, string> = {
  "ios-iphone": "iPhone · SAM app",
  "ios-ipad": "iPad · SAM app",
  android: "Android · SAM app",
};

// A friendly label from the one thing every pairing request already carries — the User-
// Agent — so a device registry says "iPhone · Safari" instead of "browser" for every
// single row. Best-effort and cosmetic only: nothing security-relevant reads this string.
export function guessLabel(userAgent: string | undefined, client?: string | string[] | undefined): string {
  const hint = Array.isArray(client) ? client[0] : client;
  const native = NATIVE_CLIENTS[String(hint || "").toLowerCase()];
  if (native) return native;
  const ua = String(userAgent || "");
  const device = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /CriOS\//.test(ua) ? "Chrome" : /FxiOS\//.test(ua) ? "Firefox" : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${device} · ${browser}`;
}

// ── B3 — capability tiers per device ────────────────────────────────────────
// A newly paired device gets read/chat/assign-task for free — that's just "isPairedSession
// returns true" elsewhere in the codebase, nothing to store here for it. What DOES need
// storing is the tier ABOVE that: deploy, raw shell exec, and spending past the default
// floor are each an explicit, named, per-device grant — off until the operator turns it
// on, from the Mac, looking at the specific device. There is no grant, and can never be
// one, for anything touching ~/flip-it: that module is read-only end to end (see its own
// header) and no yard job kind reaches it, so there is no capability to accidentally grant
// in the first place — the ungrantable rule holds by construction, not by a check here.
// B3+ — "approve" lets a paired device resolve an Ask (server/index.ts /api/ask/:id): the
// parked, dangerous action SAM stopped to check on. It is the highest-consequence grant here,
// because approving IS the safety mechanism — so it is off until the operator turns it on for
// one named device, from the Mac. Without it a phone can SEE nothing and resolve nothing; the
// endpoints stay loopback-only exactly as before.
export type Grant = "deploy" | "shellExec" | "spendAbove" | "approve";
export type Grants = Partial<Record<Grant, boolean>>;
const KNOWN_GRANTS: Grant[] = ["deploy", "shellExec", "spendAbove", "approve"];

export function getGrants(id: string): Grants {
  const row = db.prepare(`SELECT grants FROM sessions WHERE hash = ?`).get(String(id || "")) as { grants: string } | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.grants);
    const out: Grants = {};
    for (const k of KNOWN_GRANTS) if (parsed?.[k] === true) out[k] = true;   // only ever the known keys, only ever `true`
    return out;
  } catch { return {}; }
}

// Whole-object replace, not a patch — an operator looking at one device's toggles sets
// exactly what they see, so a stale client can never silently leave an old grant standing.
export function setGrants(id: string, grants: Grants): boolean {
  const clean: Grants = {};
  for (const k of KNOWN_GRANTS) if (grants?.[k] === true) clean[k] = true;
  const r = db.prepare(`UPDATE sessions SET grants = ? WHERE hash = ?`).run(JSON.stringify(clean), String(id || ""));
  return r.changes > 0;
}

export function hasGrant(id: string, grant: Grant): boolean {
  return getGrants(id)[grant] === true;
}
