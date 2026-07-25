import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Pairing is what lets a browser earn the Handshake without ever holding the preload passkey.
// These are its promises: a code pairs ONCE, a session is revocable and expires, and the raw token
// is never recoverable from storage.
let dir: string;
let P: typeof import("./pairing.ts");
const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-pairing-"));
  process.env.VAULT_DIR = dir;
  vi.resetModules();
  P = await import("./pairing.ts");
});
afterEach(() => { delete process.env.VAULT_DIR; rmSync(dir, { recursive: true, force: true }); });

describe("pairing codes → sessions", () => {
  it("a minted code pairs ONCE and yields a working session", () => {
    const code = P.mintPairingCode(NOW);
    const token = P.claimCode(code, NOW);
    expect(token).toBeTruthy();
    expect(P.validateSession(token!, NOW)).toBe(true);
    expect(P.sessionCount()).toBe(1);
  });

  it("refuses to reuse a code (single-use)", () => {
    const code = P.mintPairingCode(NOW);
    expect(P.claimCode(code, NOW)).toBeTruthy();
    expect(P.claimCode(code, NOW)).toBeNull();      // already consumed
    expect(P.sessionCount()).toBe(1);
  });

  it("refuses an expired code (5-minute window)", () => {
    const code = P.mintPairingCode(NOW);
    expect(P.claimCode(code, NOW + 6 * 60 * 1000)).toBeNull();
  });

  it("refuses an unknown / garbage code", () => {
    expect(P.claimCode("deadbeef", NOW)).toBeNull();
    expect(P.claimCode("", NOW)).toBeNull();
  });
});

describe("session validation + lifecycle", () => {
  it("rejects an unknown or empty token", () => {
    expect(P.validateSession("nope", NOW)).toBe(false);
    expect(P.validateSession(undefined, NOW)).toBe(false);
  });

  it("expires a session after the 30-day rolling window", () => {
    const token = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    expect(P.validateSession(token, NOW + 29 * DAY)).toBe(true);   // still good, and rolls last_seen
    expect(P.validateSession(token, NOW + 29 * DAY + 31 * DAY)).toBe(false);   // >30d since last use → gone
    expect(P.validateSession(token, NOW + 100 * DAY)).toBe(false); // pruned, stays gone
  });

  it("revoke-all invalidates every session", () => {
    const a = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    const b = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    expect(P.sessionCount()).toBe(2);
    expect(P.revokeAllSessions()).toBe(2);
    expect(P.validateSession(a, NOW)).toBe(false);
    expect(P.validateSession(b, NOW)).toBe(false);
  });

  it("revokes a single session by token", () => {
    const token = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    expect(P.revokeSession(token)).toBe(true);
    expect(P.validateSession(token, NOW)).toBe(false);
  });
});

describe("cookie handling", () => {
  it("the Set-Cookie is HttpOnly + SameSite=Strict + Max-Age, and never Secure (loopback is http)", () => {
    const h = P.sessionCookieHeader("tok");
    expect(h).toContain("HttpOnly");
    expect(h).toContain("SameSite=Strict");
    expect(h).toMatch(/Max-Age=\d+/);
    expect(h).not.toContain("Secure");
  });

  it("parses the session token out of a Cookie header, ignoring other cookies", () => {
    expect(P.sessionTokenFromCookie("other=1; sam_session=abc123; x=2")).toBe("abc123");
    expect(P.sessionTokenFromCookie("nothing=here")).toBe("");
    expect(P.sessionTokenFromCookie(undefined)).toBe("");
  });

  it("stores only the HASH — the raw token never appears in the db file", () => {
    const token = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    const raw = require("node:fs").readFileSync(join(dir, "sessions.db"));
    expect(raw.includes(Buffer.from(token))).toBe(false);   // the live token is not on disk
  });
});
