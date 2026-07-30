import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostAllowed, isLoopback, originAllowed, passkeyRequiredForMutation } from "./http-guards.ts";

// This function is the gate on every privileged write in SAM — API keys, config, remote tokens,
// the vault passphrase. It had no direct test before it was extracted from index.ts: the contract
// test checks that routes CALL it, never that it is right. Those are different claims.

const req = (remoteAddress: string | null | undefined) => ({ socket: { remoteAddress } });

describe("isLoopback", () => {
  it("accepts the three forms Node actually produces for a local request", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopback(req(ip)), ip).toBe(true);
    }
  });

  it("rejects remote addresses, including ones that merely look local", () => {
    for (const ip of [
      "10.0.0.5",
      "192.168.1.7", // the LAN case that matters most — another device in the house
      "0.0.0.0",
      "8.8.8.8",
      "::ffff:192.168.1.7",
      "127.0.0.1.evil.com", // substring attack: fails only because this is exact-match
      "x127.0.0.1",
      " 127.0.0.1", // whitespace-padded — not trimmed, so not accepted
      "2001:4860:4860::8888",
    ]) {
      expect(isLoopback(req(ip)), ip).toBe(false);
    }
  });

  it("fails CLOSED on absent or unparseable addresses", () => {
    // A destroyed socket yields undefined. The dangerous direction is defaulting to "local".
    for (const ip of [undefined, null, "", "unknown"]) {
      expect(isLoopback(req(ip)), String(ip)).toBe(false);
    }
  });

  it("cannot be spoofed by headers — it reads the socket only", () => {
    // X-Forwarded-For is attacker-controlled. If this ever starts consulting headers, anyone on
    // the internet can claim to be localhost and SAM hands over its keys. Pinned as a behaviour:
    // a request with a remote socket stays rejected no matter what the headers claim.
    const spoofed = {
      socket: { remoteAddress: "203.0.113.9" },
      headers: {
        "x-forwarded-for": "127.0.0.1",
        "x-real-ip": "127.0.0.1",
        forwarded: "for=127.0.0.1",
        host: "localhost",
      },
    };
    expect(isLoopback(spoofed)).toBe(false);
  });

  it("accepts 127.0.0.1 but not the rest of 127.0.0.0/8 — documented, deliberate", () => {
    // The whole 127/8 block IS loopback, so this is stricter than the RFC. Recorded as a test
    // rather than left as a surprise: if someone widens it to startsWith("127.") that is a
    // defensible change, and this test is where they will find out it was a choice, not an
    // oversight. Erring strict costs a visible annoyance; erring loose costs the user's keys.
    expect(isLoopback(req("127.0.0.1"))).toBe(true);
    expect(isLoopback(req("127.0.0.2"))).toBe(false);
    expect(isLoopback(req("127.1.2.3"))).toBe(false);
  });
});

describe("originAllowed — CORS gate (must match hostAllowed so phone access works)", () => {
  it("allows localhost / loopback origins on any port (dev HUD included)", () => {
    for (const o of ["http://localhost", "http://localhost:5273", "https://127.0.0.1:8787", "http://[::1]:8787"]) {
      expect(originAllowed(o), o).toBe(true);
    }
  });

  it("allows this machine's own private-LAN origin — the phone-access case that was broken", () => {
    // The HUD served to a phone loads from the machine's LAN IP and sends it as the Origin. Before
    // the fix this returned false and every API call from the phone was CORS-blocked ("crashed").
    for (const o of ["http://192.168.0.252:8787", "http://10.0.0.5:8787", "http://172.16.4.4:8787", "http://169.254.1.2:8787"]) {
      expect(originAllowed(o), o).toBe(true);
    }
  });

  it("allows a missing Origin (non-browser / same-origin request)", () => {
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed("")).toBe(true);
  });

  it("rejects public internet origins and lookalikes", () => {
    for (const o of [
      "http://evil.com",
      "https://sam.attacker.com",
      "http://192.168.0.252.evil.com",      // suffix trick — host is a domain, not the LAN IP
      "http://localhost.evil.com",
      "http://8.8.8.8",                      // public IP, not private-LAN
      "http://172.15.0.1",                   // just below the 172.16/12 private block
      "http://172.32.0.1",                   // just above it
      "javascript://localhost",              // wrong scheme
    ]) {
      expect(originAllowed(o), o).toBe(false);
    }
  });

  it("stays consistent with hostAllowed for the same host", () => {
    for (const host of ["localhost", "127.0.0.1", "192.168.0.252", "10.1.2.3", "8.8.8.8", "evil.com"]) {
      expect(originAllowed(`http://${host}:8787`), host).toBe(hostAllowed(`${host}:8787`));
    }
  });
});

describe("passkeyRequiredForMutation — remote mode must not re-trust loopback", () => {
  const mreq = (method: string, path: string, ip: string) => ({ method, path, socket: { remoteAddress: ip } });
  const LOOP = "127.0.0.1";
  const LAN = "192.168.0.252"; // an off-machine phone

  it("does not gate anything when the Handshake is off", () => {
    expect(passkeyRequiredForMutation(mreq("POST", "/api/x", LOOP), { enforced: false, remote: false })).toBe(false);
  });

  it("gates loopback mutating /api writes in default mode", () => {
    expect(passkeyRequiredForMutation(mreq("POST", "/api/keys", LOOP), { enforced: true, remote: false })).toBe(true);
    for (const m of ["PUT", "PATCH", "DELETE"])
      expect(passkeyRequiredForMutation(mreq(m, "/api/keys", LOOP), { enforced: true, remote: false }), m).toBe(true);
  });

  it("never gates reads or non-/api paths", () => {
    expect(passkeyRequiredForMutation(mreq("GET", "/api/status", LOOP), { enforced: true, remote: false })).toBe(false);
    expect(passkeyRequiredForMutation(mreq("POST", "/pair", LOOP), { enforced: true, remote: false })).toBe(false);
  });

  it("THE FIX: still gates LOOPBACK writes when remote mode is on", () => {
    // The bug: SAM_REMOTE=1 blanket-bypassed the Handshake, so any local process could mutate.
    expect(passkeyRequiredForMutation(mreq("POST", "/api/keys", LOOP), { enforced: true, remote: true })).toBe(true);
  });

  it("defers the off-machine phone (non-loopback) to the remote-token gate in remote mode", () => {
    // A phone has no passkey; it authenticates at the remote-token gate, so this gate lets it past.
    expect(passkeyRequiredForMutation(mreq("POST", "/api/task", LAN), { enforced: true, remote: true })).toBe(false);
  });

  it("a non-loopback write is NOT deferred when remote mode is off (belt and braces)", () => {
    expect(passkeyRequiredForMutation(mreq("POST", "/api/task", LAN), { enforced: true, remote: false })).toBe(true);
  });

  it("THE OTHER FIX: the pairing on-ramp is open, or a browser could never start pairing", () => {
    // Shipped broken from v3.0.0: enforced Handshake ON, and this POST refused every browser that
    // tried to pair — the passkey it demands is the very thing pairing exists to obtain.
    expect(passkeyRequiredForMutation(mreq("POST", "/api/yard/pair/request", LOOP), { enforced: true, remote: false })).toBe(false);
  });

  it("but the pairing APPROVAL (and its siblings) stay gated — only the app approves", () => {
    for (const p of ["/api/yard/pair/approve", "/api/yard/pair/deny", "/api/yard/pair/revoke"])
      expect(passkeyRequiredForMutation(mreq("POST", p, LOOP), { enforced: true, remote: false }), p).toBe(true);
  });
});

// isYardTrusted / isYardReadTrusted honour the same session-cookie Pairing that unblocks the rest
// of SAM's API, so a phone that paired can reach its own task list before Movement B's transport
// exists. Needs a real (isolated) session — pairing.ts opens its db from VAULT_DIR at import time,
// so each test gets its own tmpdir and a fresh module graph, same pattern as pairing.test.ts.
describe("isYardTrusted / isYardReadTrusted / isPairedSession", () => {
  let dir: string;
  let P: typeof import("./pairing.ts");
  let G: typeof import("./http-guards.ts");
  // isPairedSession checks against the real clock (Date.now()), same as production callers — so
  // the session minted here must live near "now", not a fixed epoch (a distant NOW reads as an
  // expired 30-day-old session against wall-clock time and every assertion below flips silently).
  const NOW = Date.now();
  const LOOP = "127.0.0.1";
  const LAN = "192.168.0.252"; // a paired phone, off loopback

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "sam-http-guards-"));
    process.env.VAULT_DIR = dir;
    delete process.env.SAM_REQUIRE_CONTROL_TOKEN; // default: enforced
    process.env.SAM_CONTROL_TOKEN = "b".repeat(64);
    vi.resetModules();
    P = await import("./pairing.ts");
    G = await import("./http-guards.ts");
  });
  afterEach(() => {
    delete process.env.VAULT_DIR;
    delete process.env.SAM_REQUIRE_CONTROL_TOKEN;
    delete process.env.SAM_CONTROL_TOKEN;
    rmSync(dir, { recursive: true, force: true });
  });

  const pairedCookieReq = (ip: string, token: string) => ({
    socket: { remoteAddress: ip },
    headers: { cookie: `${P.SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
  const bareReq = (ip: string) => ({ socket: { remoteAddress: ip }, headers: {} });

  it("isPairedSession: false with no cookie, true with a live session, false once revoked", () => {
    expect(G.isPairedSession(bareReq(LAN))).toBe(false);
    const token = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    expect(G.isPairedSession(pairedCookieReq(LAN, token))).toBe(true);
    P.revokeSession(token);
    expect(G.isPairedSession(pairedCookieReq(LAN, token))).toBe(false);
  });

  it("isYardTrusted: loopback behaviour is unchanged — passkey required, paired session irrelevant", () => {
    expect(G.isYardTrusted(bareReq(LOOP))).toBe(false); // loopback, no passkey → still refused
    const withPasskey = { socket: { remoteAddress: LOOP }, headers: { "x-sam-token": "b".repeat(64) } };
    expect(G.isYardTrusted(withPasskey)).toBe(true);
  });

  it("isYardTrusted: THE FIX — a paired non-loopback device is now trusted", () => {
    expect(G.isYardTrusted(bareReq(LAN))).toBe(false); // not paired
    const token = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    expect(G.isYardTrusted(pairedCookieReq(LAN, token))).toBe(true);
  });

  it("isYardTrusted: a revoked session goes back to refused, not silently trusted", () => {
    const token = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    expect(G.isYardTrusted(pairedCookieReq(LAN, token))).toBe(true);
    P.revokeSession(token);
    expect(G.isYardTrusted(pairedCookieReq(LAN, token))).toBe(false);
  });

  it("isYardReadTrusted: same paired-session grant applies to the read routes", () => {
    expect(G.isYardReadTrusted(bareReq(LAN))).toBe(false);
    const token = P.claimCode(P.mintPairingCode(NOW), NOW)!;
    expect(G.isYardReadTrusted(pairedCookieReq(LAN, token))).toBe(true);
  });

  it("isYardReadTrusted: still refuses a stray x-sam-pair token off loopback (that's yard-write pairing, not this)", () => {
    // Guards against conflating the two pairing systems: the older yard/pairing.ts request/
    // approve token was never meant to satisfy isTrustedLocal's loopback-only reads.
    const req = { socket: { remoteAddress: LAN }, headers: { "x-sam-pair": "not-a-real-token" } };
    expect(G.isYardReadTrusted(req)).toBe(false);
  });
});
