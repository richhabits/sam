import { describe, expect, it } from "vitest";
import { isLoopback } from "./http-guards.ts";

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
