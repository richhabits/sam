import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPasskey, passkey, handshakeEnforced, presentedPasskey } from "./handshake.ts";
import { isTrustedLocal } from "./http-guards.ts";

// The control-token guarantee: with enforcement ON, loopback position is NOT enough — a privileged
// caller must present the per-launch token. A local process that doesn't know it is refused even
// from 127.0.0.1. Enforcement is opt-in, so we toggle the env flag per test and restore it.

const LOOPBACK = "127.0.0.1";
const savedFlag = process.env.SAM_REQUIRE_CONTROL_TOKEN;
const savedToken = process.env.SAM_CONTROL_TOKEN;

beforeEach(() => { process.env.SAM_CONTROL_TOKEN = "a".repeat(64); });
afterEach(() => {
  if (savedFlag === undefined) delete process.env.SAM_REQUIRE_CONTROL_TOKEN; else process.env.SAM_REQUIRE_CONTROL_TOKEN = savedFlag;
  if (savedToken === undefined) delete process.env.SAM_CONTROL_TOKEN; else process.env.SAM_CONTROL_TOKEN = savedToken;
});

const reqWith = (token?: string, ip = LOOPBACK) => ({
  socket: { remoteAddress: ip },
  headers: token === undefined ? {} : { "x-sam-token": token },
});

describe("passkey — checkPasskey", () => {
  it("accepts the exact token, rejects wrong/absent, constant-length-safe", () => {
    expect(checkPasskey(reqWith("a".repeat(64)))).toBe(true);
    expect(checkPasskey(reqWith("b".repeat(64)))).toBe(false); // right length, wrong bytes
    expect(checkPasskey(reqWith("short"))).toBe(false); // wrong length → no throw, just false
    expect(checkPasskey(reqWith())).toBe(false); // no header at all
  });

  it("reads the header from string or array form", () => {
    expect(presentedPasskey({ headers: { "x-sam-token": "x" } })).toBe("x");
    expect(presentedPasskey({ headers: { "x-sam-token": ["x", "y"] } })).toBe("x");
    expect(presentedPasskey({ headers: {} })).toBe("");
  });

  it("passkey() is stable within a launch and 64 hex chars by default", () => {
    delete process.env.SAM_CONTROL_TOKEN;
    const t1 = passkey();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(passkey()).toBe(t1); // same value on re-read
  });
});

describe("passkey — isTrustedLocal enforcement", () => {
  // The default flipped for v3.0.0. Being on this machine is not authorization: any local
  // process reaches 127.0.0.1 and knows no secret it must present, and SAM runs shell,
  // files, email and cameras. "Already on the machine" is far too low a bar to ship.
  it("ENFORCEMENT IS ON BY DEFAULT: loopback alone is NOT enough", () => {
    delete process.env.SAM_REQUIRE_CONTROL_TOKEN;
    expect(handshakeEnforced()).toBe(true);
    expect(isTrustedLocal(reqWith())).toBe(false);
    expect(isTrustedLocal(reqWith("a".repeat(64)))).toBe(true);
  });

  it("=0 is the documented opt-out, and only that exact value", () => {
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "0";
    expect(handshakeEnforced()).toBe(false);
    expect(isTrustedLocal(reqWith())).toBe(true);
    // anything else means ON — a typo must fail safe, never silently disable the gate
    for (const v of ["", "false", "no", "off", "2"]) {
      process.env.SAM_REQUIRE_CONTROL_TOKEN = v;
      expect(handshakeEnforced()).toBe(true);
    }
  });

  it("ENFORCEMENT ON: a loopback request WITHOUT the token is refused", () => {
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "1";
    expect(isTrustedLocal(reqWith(undefined, LOOPBACK))).toBe(false); // loopback but no token → NOT trusted
    expect(isTrustedLocal(reqWith("wrong-token-value"))).toBe(false);
  });

  it("ENFORCEMENT ON: loopback WITH the correct token is trusted", () => {
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "1";
    expect(isTrustedLocal(reqWith("a".repeat(64)))).toBe(true);
  });

  it("a NON-loopback request is never trusted, token or not, either mode", () => {
    process.env.SAM_REQUIRE_CONTROL_TOKEN = "1";
    expect(isTrustedLocal(reqWith("a".repeat(64), "203.0.113.9"))).toBe(false);
    delete process.env.SAM_REQUIRE_CONTROL_TOKEN;
    expect(isTrustedLocal(reqWith(undefined, "203.0.113.9"))).toBe(false);
  });
});
