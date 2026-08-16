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

import { randomBytes, randomInt, createHash, timingSafeEqual } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.ts";

export const SESSION_COOKIE = "sam_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30-day rolling expiry
const CODE_TTL_MS = 15 * 60 * 1000;                // the 32-char hex code is good for 15 minutes (forgiving for a walk-to-the-phone hand-off; 128 bits of entropy makes the window irrelevant to brute force)
// AUDIT: the 6-digit PIN shares the SAME pendingCodes bundle as the hex code, but has only
// ~900,000 possible values — nowhere near enough entropy to reuse a 15-minute, unrate-limited
// window. Both routes that call claimCode() (GET /pair, POST /api/pair/claim) had ZERO rate
// limiting before this fix: an attacker on the network could try all 900k PINs well within 15
// minutes with plain concurrent HTTP requests and pair a malicious device with full session
// access. Fixed two ways: a much shorter PIN-specific expiry, and a per-IP lockout on repeated
// failed claims (keyed on the real socket address, not a spoofable header — see
// sam-shared-ratelimit-signin-lockout for why that distinction matters).
const PIN_TTL_MS = 2 * 60 * 1000;                  // the 6-digit PIN is good for 2 minutes only
const TOUCH_THROTTLE_MS = 60 * 60 * 1000;          // only rewrite last_seen once an hour (roll without write-amplifying)
const CLAIM_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;     // rolling window for counting failed claims per IP
const CLAIM_MAX_ATTEMPTS = 8;                      // generous for genuine typos, tight enough to kill brute force
const CLAIM_LOCKOUT_MS = 10 * 60 * 1000;           // locked out for 10 minutes after exceeding the limit

interface ClaimAttemptState { count: number; windowStart: number; lockedUntil: number; }
const claimAttempts = new Map<string, ClaimAttemptState>();

/** True if this client is currently locked out from claim attempts. */
function isLockedOut(clientIp: string, now: number): boolean {
  const s = claimAttempts.get(clientIp);
  return !!s && s.lockedUntil > now;
}

/** Record a failed claim attempt, locking the IP out once it exceeds the threshold within the window. */
function recordFailedAttempt(clientIp: string, now: number): void {
  let s = claimAttempts.get(clientIp);
  if (!s || now - s.windowStart > CLAIM_ATTEMPT_WINDOW_MS) {
    s = { count: 0, windowStart: now, lockedUntil: 0 };
    claimAttempts.set(clientIp, s);
  }
  s.count++;
  if (s.count >= CLAIM_MAX_ATTEMPTS) s.lockedUntil = now + CLAIM_LOCKOUT_MS;
}

/** A successful claim clears this IP's failure history — a genuine owner shouldn't stay throttled. */
function clearAttempts(clientIp: string): void {
  claimAttempts.delete(clientIp);
}

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

interface PendingPairing {
  expiry: number;      // the 32-char hex code's own expiry (15 min)
  pinExpiry?: number;  // the 6-digit PIN's own, much shorter expiry (2 min) — undefined if this bundle has no PIN
  pin?: string;
  code?: string;
}

// Pending single-use pairing codes: hash → pending entry. In memory — they live for minutes and must not
// survive a restart (a leaked-but-stale code should never pair). Keyed by hash so the log/heap never
// holds a usable code.
const pendingCodes = new Map<string, PendingPairing>();

function normalizeCode(raw: string): string {
  return String(raw || "").trim().replace(/[-\s]/g, "").toLowerCase();
}

/** Mint a one-time pairing bundle containing both a full 32-char hex token and a 6-digit PIN. */
export function mintPairingBundle(now: number): { code: string; pin: string } {
  for (const [h, entry] of pendingCodes) {
    const stillLive = entry.expiry > now || (entry.pinExpiry !== undefined && entry.pinExpiry > now);
    if (!stillLive) pendingCodes.delete(h);
  }
  const code = randomBytes(16).toString("hex");   // 32 hex chars, single-use, short-lived
  // randomInt, not Math.random() — this grants real device access, so it needs the same
  // cryptographically-secure source as the hex code above, not a non-crypto PRNG.
  const pin = String(randomInt(100000, 1000000));  // 6-digit friendly PIN

  const entry: PendingPairing = { expiry: now + CODE_TTL_MS, pinExpiry: now + PIN_TTL_MS, pin, code };
  pendingCodes.set(sha(normalizeCode(code)), entry);
  pendingCodes.set(sha(normalizeCode(pin)), entry);
  return { code, pin };
}

/** Mint a one-time pairing code (returned raw, ONCE). Exchange it via claimCode() for a session. */
export function mintPairingCode(now: number): string {
  return mintPairingBundle(now).code;
}

/** Exchange a valid, unexpired, single-use code or 6-digit PIN for a new session. Returns the raw session token
 *  (to set as the cookie) or null if the code is unknown/expired/already used/rate-limited.
 *  clientIp should be the caller's real socket address (not a client-supplied header) — it
 *  gates the per-IP lockout that specifically protects the low-entropy 6-digit PIN. */
export function claimCode(code: string, now: number, label = "browser", clientIp = "unknown"): string | null {
  if (isLockedOut(clientIp, now)) return null;

  const norm = normalizeCode(code);
  const h = sha(norm);
  const entry = pendingCodes.get(h);
  const isPinMatch = !!entry && entry.pin !== undefined && sha(normalizeCode(entry.pin)) === h;
  const relevantExpiry = isPinMatch ? entry?.pinExpiry : entry?.expiry;

  if (!entry || relevantExpiry === undefined || relevantExpiry <= now) {
    pendingCodes.delete(h);
    recordFailedAttempt(clientIp, now);
    return null;
  }

  // SINGLE USE: Consume both the 32-char hex code and the 6-digit PIN linked to this bundle
  for (const [key, val] of pendingCodes.entries()) {
    if (val === entry || (entry.code && val.code === entry.code) || (entry.pin && val.pin === entry.pin)) {
      pendingCodes.delete(key);
    }
  }

  clearAttempts(clientIp);
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
  // Not `/^Bearer\s+(.+)$/`. That regex backtracks: `\s+` and `(.+)` both match whitespace, so an
  // Authorization header of "Bearer" followed by a few hundred thousand spaces makes the engine
  // re-try every split point — quadratic work on a header any local caller can set. This does the
  // same job in one pass: a fixed, anchored prefix test, then a slice.
  if (!/^Bearer[ \t]/i.test(auth)) return "";
  return auth.slice("Bearer".length).trim();
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
