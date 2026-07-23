import { describe, it, expect } from "vitest";
import { p2pAuthHeaders, p2pVerify, freshNonce } from "./p2p.ts";

// The promise this redesign makes: the shared secret is NEVER transmitted, a signature proves
// knowledge of it without disclosing it, and a captured signature cannot be replayed. A fake
// mDNS peer that receives a dispatch must learn nothing it can use to drive us back.
const KEY = "a-shared-secret-at-least-16-chars-long";

describe("P2P request signing", () => {
  it("the secret never appears in the headers (only a signature does)", () => {
    const h = p2pAuthHeaders(KEY, "POST", "/p2p/task", '{"message":"hi"}');
    const blob = JSON.stringify(h);
    expect(blob).not.toContain(KEY);
    expect(h["x-sam-p2p-sig"]).toBeTruthy();
    expect(h["x-sam-p2p-ts"]).toBeTruthy();
    expect(h["x-sam-p2p-nonce"]).toBeTruthy();
  });

  it("a correctly-signed request verifies", () => {
    const body = '{"from":"a","message":"do X"}';
    const now = 1_000_000;
    const h = p2pAuthHeaders(KEY, "POST", "/p2p/task", body, { now });
    const v = p2pVerify(KEY, "POST", "/p2p/task", body, { ts: h["x-sam-p2p-ts"], nonce: h["x-sam-p2p-nonce"], sig: h["x-sam-p2p-sig"] }, { now });
    expect(v.ok).toBe(true);
  });

  it("rejects a wrong key (a peer that does NOT know the secret)", () => {
    const body = '{"m":1}';
    const h = p2pAuthHeaders(KEY, "POST", "/p2p/task", body, { now: 5 });
    const v = p2pVerify("a-different-secret-16-chars-xx", "POST", "/p2p/task", body, { ts: h["x-sam-p2p-ts"], nonce: h["x-sam-p2p-nonce"], sig: h["x-sam-p2p-sig"] }, { now: 5 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/bad signature/);
  });

  it("rejects a tampered body (signature is bound to what was sent)", () => {
    const now = 42;
    const h = p2pAuthHeaders(KEY, "POST", "/p2p/task", '{"message":"transfer £5"}', { now });
    // attacker swaps the body but keeps the captured signature
    const v = p2pVerify(KEY, "POST", "/p2p/task", '{"message":"transfer £5000"}', { ts: h["x-sam-p2p-ts"], nonce: h["x-sam-p2p-nonce"], sig: h["x-sam-p2p-sig"] }, { now });
    expect(v.ok).toBe(false);
  });

  it("rejects a stale signature (outside the freshness window)", () => {
    const body = '{"m":1}';
    const h = p2pAuthHeaders(KEY, "POST", "/p2p/task", body, { now: 1_000_000 });
    const v = p2pVerify(KEY, "POST", "/p2p/task", body, { ts: h["x-sam-p2p-ts"], nonce: h["x-sam-p2p-nonce"], sig: h["x-sam-p2p-sig"] }, { now: 1_000_000 + 61_000 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/stale/);
  });

  it("rejects a missing signature and an unconfigured/short secret", () => {
    expect(p2pVerify(KEY, "POST", "/p2p/task", "{}", {}).ok).toBe(false);
    expect(p2pVerify("short", "POST", "/p2p/task", "{}", { ts: "1", nonce: "n", sig: "s" }, { now: 1 }).ok).toBe(false);
  });
});

describe("nonce replay protection", () => {
  it("accepts a nonce once, refuses the replay", () => {
    const store = new Map<string, number>();
    expect(freshNonce(store, "abc", 1000)).toBe(true);   // first use
    expect(freshNonce(store, "abc", 1000)).toBe(false);  // replay — refused
  });

  it("forgets a nonce once its window has passed (bounded store)", () => {
    const store = new Map<string, number>();
    freshNonce(store, "abc", 1000, 60_000);
    expect(store.size).toBe(1);
    // a later, unrelated request prunes the expired nonce
    freshNonce(store, "xyz", 1000 + 61_000, 60_000);
    expect(store.has("abc")).toBe(false);
  });
});
