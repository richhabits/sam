import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkControlToken, controlToken, controlTokenEnforced, presentedToken } from "./control-token.ts";
import { isTrustedLocal } from "./http-guards.ts";

// The Salt-audit guarantee: with enforcement ON, loopback position is NOT enough — a privileged
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

describe("control token — checkControlToken", () => {
  it("accepts the exact token, rejects wrong/absent, constant-length-safe", () => {
    expect(checkControlToken(reqWith("a".repeat(64)))).toBe(true);
    expect(checkControlToken(reqWith("b".repeat(64)))).toBe(false); // right length, wrong bytes
    expect(checkControlToken(reqWith("short"))).toBe(false); // wrong length → no throw, just false
    expect(checkControlToken(reqWith())).toBe(false); // no header at all
  });

  it("reads the header from string or array form", () => {
    expect(presentedToken({ headers: { "x-sam-token": "x" } })).toBe("x");
    expect(presentedToken({ headers: { "x-sam-token": ["x", "y"] } })).toBe("x");
    expect(presentedToken({ headers: {} })).toBe("");
  });

  it("controlToken() is stable within a launch and 64 hex chars by default", () => {
    delete process.env.SAM_CONTROL_TOKEN;
    const t1 = controlToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(controlToken()).toBe(t1); // same value on re-read
  });
});

describe("control token — isTrustedLocal enforcement", () => {
  it("ENFORCEMENT OFF (default): loopback alone is trusted, token or not", () => {
    delete process.env.SAM_REQUIRE_CONTROL_TOKEN;
    expect(controlTokenEnforced()).toBe(false);
    expect(isTrustedLocal(reqWith())).toBe(true); // unchanged legacy behavior
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
