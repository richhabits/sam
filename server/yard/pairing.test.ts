import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  requestPairing, pendingRequests, approvePairing, denyPairing,
  verifyPairToken, pairedBrowsers, revokePairing, clearPending, makeCode,
  stashForCollection, collect,
} from "./pairing.ts";

// Pairing exists so a browser can drive the yard WITHOUT the passkey being served to
// anything that asks. These tests are mostly about the ways that could go wrong.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yard-pair-"));
  process.env.YARD_DIR = dir;
  clearPending();
});
afterEach(() => {
  delete process.env.YARD_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("the code", () => {
  it("is six digits", () => {
    for (let i = 0; i < 20; i++) expect(makeCode()).toMatch(/^\d{6}$/);
  });
  it("is not predictable — 50 codes are not all the same", () => {
    const seen = new Set(Array.from({ length: 50 }, () => makeCode()));
    expect(seen.size).toBeGreaterThan(40);
  });
});

describe("asking to pair", () => {
  it("creates a request the app can display", () => {
    const r = requestPairing("Chrome on this Mac")!;
    expect(r.code).toMatch(/^\d{6}$/);
    expect(r.label).toBe("Chrome on this Mac");
    expect(pendingRequests().map((p) => p.id)).toEqual([r.id]);
  });

  it("expires a request nobody answered", () => {
    const t = 1_000_000;
    requestPairing("stale", t);
    expect(pendingRequests(t + 60_000).length).toBe(1);
    expect(pendingRequests(t + 5 * 60_000).length).toBe(0);
  });

  it("refuses to drown the approval screen", () => {
    for (let i = 0; i < 5; i++) expect(requestPairing(`b${i}`)).not.toBeNull();
    expect(requestPairing("one too many")).toBeNull();
  });
});

describe("approving", () => {
  it("mints a token when the code matches", () => {
    const r = requestPairing("Chrome")!;
    const a = approvePairing(r.id, r.code)!;
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(a.browser.label).toBe("Chrome");
    expect(pendingRequests().length).toBe(0);        // consumed
  });

  // The reason a code exists at all.
  it("refuses when the code does not match the request being approved", () => {
    const honest = requestPairing("Chrome")!;
    const hostile = requestPairing("something else")!;
    // approving the hostile request with the code the person can SEE must fail
    expect(approvePairing(hostile.id, honest.code)).toBeNull();
    expect(pendingRequests().length).toBe(2);        // neither consumed
  });

  it("refuses a wrong or empty code", () => {
    const r = requestPairing("Chrome")!;
    expect(approvePairing(r.id, "000000")).toBeNull();
    expect(approvePairing(r.id, "")).toBeNull();
    expect(approvePairing(r.id, "12345")).toBeNull();     // wrong length
  });

  it("refuses an unknown or already-used request", () => {
    const r = requestPairing("Chrome")!;
    expect(approvePairing("nope", r.code)).toBeNull();
    approvePairing(r.id, r.code);
    expect(approvePairing(r.id, r.code)).toBeNull();      // cannot be replayed
  });

  it("can be turned down", () => {
    const r = requestPairing("Chrome")!;
    expect(denyPairing(r.id)).toBe(true);
    expect(pendingRequests().length).toBe(0);
    expect(approvePairing(r.id, r.code)).toBeNull();
  });
});

describe("the token", () => {
  it("is accepted afterwards", () => {
    const r = requestPairing("Chrome")!;
    const a = approvePairing(r.id, r.code)!;
    expect(verifyPairToken(a.token)?.label).toBe("Chrome");
  });

  it("rejects anything that is not one of ours", () => {
    requestPairing("Chrome");
    expect(verifyPairToken("")).toBeNull();
    expect(verifyPairToken("a".repeat(64))).toBeNull();
    expect(verifyPairToken(undefined)).toBeNull();
    expect(verifyPairToken(12345)).toBeNull();
  });

  it("is stored hashed, never in the clear", async () => {
    const r = requestPairing("Chrome")!;
    const a = approvePairing(r.id, r.code)!;
    const { readFileSync } = await import("node:fs");
    const onDisk = readFileSync(join(dir, "paired.json"), "utf8");
    expect(onDisk).not.toContain(a.token);
    expect(onDisk).toContain("hash");
  });

  it("stops working once the browser is unpaired", () => {
    const r = requestPairing("Chrome")!;
    const a = approvePairing(r.id, r.code)!;
    expect(pairedBrowsers().length).toBe(1);
    expect(revokePairing(a.browser.id)).toBe(true);
    expect(verifyPairToken(a.token)).toBeNull();
    expect(pairedBrowsers().length).toBe(0);
  });

  it("survives a restart, because it is a permission and not a conversation", () => {
    const r = requestPairing("Chrome")!;
    const a = approvePairing(r.id, r.code)!;
    clearPending();                                   // as if the server had restarted
    expect(verifyPairToken(a.token)?.label).toBe("Chrome");
  });
});

describe("collecting the token", () => {
  it("hands it over exactly once", () => {
    stashForCollection("req1", "tok");
    expect(collect("req1")).toBe("tok");
    expect(collect("req1")).toBeNull();               // no spare key left lying around
  });

  it("gives nothing for a request it does not know", () => {
    expect(collect("never")).toBeNull();
  });
});
