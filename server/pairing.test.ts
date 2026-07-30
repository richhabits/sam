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

  it("refuses an expired code (15-minute window)", () => {
    const code = P.mintPairingCode(NOW);
    expect(P.claimCode(code, NOW + 16 * 60 * 1000)).toBeNull();
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

// B2 — the device registry: named devices, first/last-seen, individual revocation.
describe("the device registry", () => {
  it("lists every paired device with a safe id, never the raw token", () => {
    const token = P.claimCode(P.mintPairingCode(NOW), NOW, "Test Device")!;
    const devices = P.listSessions();
    expect(devices).toHaveLength(1);
    expect(devices[0].label).toBe("Test Device");
    expect(devices[0].created).toBe(NOW);
    expect(devices[0].lastSeen).toBe(NOW);
    expect(devices[0].id).not.toBe(token);       // the id is the hash, not the live token
    expect(devices[0].id.length).toBeGreaterThan(20);
  });

  it("sorts by most-recently-seen first", () => {
    P.claimCode(P.mintPairingCode(NOW), NOW, "Older");
    // A code is only good for 15 minutes, so "seen a day later" needs a code minted then too.
    P.claimCode(P.mintPairingCode(NOW + DAY), NOW + DAY, "Newer");
    const devices = P.listSessions();
    expect(devices.map((d) => d.label)).toEqual(["Newer", "Older"]);
  });

  it("revokes ONE device by its listed id, leaving the others paired", () => {
    P.claimCode(P.mintPairingCode(NOW), NOW, "Keep me");
    P.claimCode(P.mintPairingCode(NOW), NOW, "Revoke me");
    const devices = P.listSessions();
    const toRevoke = devices.find((d) => d.label === "Revoke me")!;
    expect(P.revokeSessionById(toRevoke.id)).toBe(true);
    const remaining = P.listSessions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].label).toBe("Keep me");
  });

  it("revoking an unknown id is reported honestly, not thrown", () => {
    expect(P.revokeSessionById("not-a-real-id")).toBe(false);
  });

  it("a device revoked by id can no longer validate its session", () => {
    const token = P.claimCode(P.mintPairingCode(NOW), NOW, "x")!;
    const id = P.listSessions()[0].id;
    P.revokeSessionById(id);
    expect(P.validateSession(token, NOW)).toBe(false);
  });
});

describe("guessLabel — a friendly device name from the one thing pairing always carries", () => {
  const UA = {
    iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ipadSafari: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  };

  it("names device + browser correctly across common combinations", () => {
    expect(P.guessLabel(UA.iphoneSafari)).toBe("iPhone · Safari");
    expect(P.guessLabel(UA.ipadSafari)).toBe("iPad · Safari");
    expect(P.guessLabel(UA.macChrome)).toBe("Mac · Chrome");
    expect(P.guessLabel(UA.macSafari)).toBe("Mac · Safari");
    expect(P.guessLabel(UA.androidChrome)).toBe("Android · Chrome");
    expect(P.guessLabel(UA.windowsEdge)).toBe("Windows · Edge");
  });

  it("degrades to generic labels rather than guessing, for missing/unrecognised input", () => {
    expect(P.guessLabel(undefined)).toBe("device · browser");
    expect(P.guessLabel("")).toBe("device · browser");
    expect(P.guessLabel("SomeWeirdClient/1.0")).toBe("device · browser");
  });
});

// B3 — capability tiers per device.
describe("grants — per-device capability tiers", () => {
  it("a freshly paired device has no grants at all", () => {
    P.claimCode(P.mintPairingCode(NOW), NOW);
    const id = P.listSessions()[0].id;
    expect(P.getGrants(id)).toEqual({});
    expect(P.hasGrant(id, "deploy")).toBe(false);
    expect(P.hasGrant(id, "shellExec")).toBe(false);
    expect(P.hasGrant(id, "spendAbove")).toBe(false);
  });

  it("setGrants grants exactly what's asked, nothing implied", () => {
    P.claimCode(P.mintPairingCode(NOW), NOW);
    const id = P.listSessions()[0].id;
    expect(P.setGrants(id, { deploy: true })).toBe(true);
    expect(P.getGrants(id)).toEqual({ deploy: true });
    expect(P.hasGrant(id, "deploy")).toBe(true);
    expect(P.hasGrant(id, "shellExec")).toBe(false);   // NOT implied by deploy
  });

  it("setGrants is a whole-object REPLACE, not a patch — an old grant doesn't survive a new call that omits it", () => {
    P.claimCode(P.mintPairingCode(NOW), NOW);
    const id = P.listSessions()[0].id;
    P.setGrants(id, { deploy: true, shellExec: true });
    expect(P.getGrants(id)).toEqual({ deploy: true, shellExec: true });
    P.setGrants(id, { shellExec: true });   // deploy left out this time
    expect(P.getGrants(id)).toEqual({ shellExec: true });   // deploy is GONE, not still true
  });

  it("only the three known keys are ever stored, however the input is shaped", () => {
    P.claimCode(P.mintPairingCode(NOW), NOW);
    const id = P.listSessions()[0].id;
    P.setGrants(id, { deploy: true, notARealGrant: true, spendAbove: "yes" } as any);
    expect(P.getGrants(id)).toEqual({ deploy: true });   // the bogus key and the non-boolean are both dropped
  });

  it("setGrants on an unknown device is reported honestly, not thrown", () => {
    expect(P.setGrants("not-a-real-id", { deploy: true })).toBe(false);
  });

  it("a revoked device's grants go with it — there is no lingering row to query", () => {
    P.claimCode(P.mintPairingCode(NOW), NOW);
    const id = P.listSessions()[0].id;
    P.setGrants(id, { deploy: true });
    P.revokeSessionById(id);
    expect(P.getGrants(id)).toEqual({});
  });

  it("listSessions reports each device's own grants alongside its other metadata", () => {
    P.claimCode(P.mintPairingCode(NOW), NOW, "Grant me");
    const id = P.listSessions()[0].id;
    P.setGrants(id, { shellExec: true });
    const devices = P.listSessions();
    expect(devices[0].grants).toEqual({ shellExec: true });
  });
});
