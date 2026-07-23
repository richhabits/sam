import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRATCH = "/tmp/sam-remotetok-test";
let T: typeof import("./remote-tokens.ts");
beforeAll(async () => { process.env.VAULT_DIR = SCRATCH; T = await import("./remote-tokens.ts"); });
beforeEach(() => { rmSync(SCRATCH, { recursive: true, force: true }); for (const t of T.listTokens()) T.revokeToken(t.id); });

describe("scoped remote tokens", () => {
  it("creates a token, returns plaintext ONCE, verifies to its scope", () => {
    const c = T.createToken("Owner's iPhone", "no-dangerous");
    expect(c.token).toBeTruthy();
    const v = T.verifyToken(c.token);
    expect(v?.scope).toBe("no-dangerous");
    expect(v?.label).toBe("Owner's iPhone");
  });

  it("never stores or lists the plaintext or hash", () => {
    const c = T.createToken("dev", "full");
    const listed = T.listTokens();
    expect(JSON.stringify(listed)).not.toContain(c.token);
    expect(JSON.stringify(listed[0])).not.toContain("hash");
  });

  // AUDIT FIX: a handed-out token that never reached disk is a lie; save() used to swallow
  // failures. And the token store must not be world-readable on a shared machine.
  it("actually persists to disk at 0600 (never only in memory, never plaintext)", () => {
    const c = T.createToken("phone", "full");
    const f = join(SCRATCH, "remote_tokens.json");
    expect(existsSync(f)).toBe(true);                        // it reached disk
    expect(statSync(f).mode & 0o777).toBe(0o600);            // owner-only, not world-readable
    expect(readFileSync(f, "utf8")).not.toContain(c.token);  // stored hashed/sealed, never the secret
  });

  it("rejects an unknown token", () => {
    T.createToken("dev", "full");
    expect(T.verifyToken("not-a-real-token")).toBeNull();
    expect(T.verifyToken("")).toBeNull();
  });

  it("sets a future expiry for a positive ttl; no expiry otherwise", () => {
    const ttl = T.createToken("temp", "read-only", 7);
    expect(ttl.expiresAt).toBeGreaterThan(Date.now());
    expect(T.verifyToken(ttl.token)?.scope).toBe("read-only");
    const perm = T.createToken("perm", "full");            // no ttl → never expires
    expect(perm.expiresAt).toBeUndefined();
    expect(T.listTokens().find((x) => x.id === perm.id)?.expired).toBe(false);
  });

  it("revokes a token", () => {
    const c = T.createToken("dev", "full");
    expect(T.verifyToken(c.token)).not.toBeNull();
    expect(T.revokeToken(c.id)).toBe(true);
    expect(T.verifyToken(c.token)).toBeNull();
  });

  it("scope privilege helpers", () => {
    expect(T.scopeCanMutate("read-only")).toBe(false);
    expect(T.scopeCanMutate("no-dangerous")).toBe(true);
    expect(T.scopeAllowsDangerous("no-dangerous")).toBe(false);
    expect(T.scopeAllowsDangerous("full")).toBe(true);
  });

  it("defaults an invalid scope to no-dangerous (safe)", () => {
    const c = T.createToken("dev", "nonsense" as any);
    expect(T.verifyToken(c.token)?.scope).toBe("no-dangerous");
  });
});
