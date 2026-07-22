import { describe, expect, it } from "vitest";
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
});
