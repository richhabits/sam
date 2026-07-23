import { describe, it, expect } from "vitest";
import { deriveKey, encrypt, decrypt, isEncrypted, newKeyConfig, unlockKey, keyFingerprint } from "./crypto-vault.ts";
import { randomBytes } from "node:crypto";

describe("vault crypto core", () => {
  it("round-trips plaintext through an authenticated envelope", () => {
    const key = randomBytes(32);
    const secret = "my API key sk-abc123 and a note with 🔐 unicode";
    const env = encrypt(secret, key);
    expect(isEncrypted(env)).toBe(true);
    expect(env).not.toContain(secret);           // ciphertext, not plaintext
    expect(decrypt(env, key)).toBe(secret);
  });

  it("fails to decrypt with the wrong key", () => {
    const env = encrypt("secret", randomBytes(32));
    expect(() => decrypt(env, randomBytes(32))).toThrow();
  });

  it("detects tampering (GCM auth)", () => {
    const key = randomBytes(32);
    const env = encrypt("secret", key);
    const parts = env.split(".");
    // flip a byte in the ciphertext
    const ct = Buffer.from(parts[3], "base64url"); ct[0] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], ct.toString("base64url")].join(".");
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("derives a stable key from a passphrase+salt, different salt → different key", () => {
    const salt = randomBytes(16);
    expect(deriveKey("hunter2", salt).equals(deriveKey("hunter2", salt))).toBe(true);
    expect(deriveKey("hunter2", salt).equals(deriveKey("hunter2", randomBytes(16)))).toBe(false);
  });

  it("unlockKey verifies the right passphrase and rejects the wrong one", () => {
    const { config, key } = newKeyConfig("correct horse battery staple");
    const opened = unlockKey("correct horse battery staple", config);
    expect(opened).not.toBeNull();
    expect(opened!.equals(key)).toBe(true);
    expect(unlockKey("wrong passphrase", config)).toBeNull();
  });

  it("config stores only a salt + verifier — never the key or passphrase", () => {
    const { config } = newKeyConfig("s3cr3t-pass");
    const blob = JSON.stringify(config);
    expect(blob).not.toContain("s3cr3t-pass");
    expect(config.salt).toBeTruthy();
    expect(config.verifier).toBeTruthy();
  });

  it("keyFingerprint is stable + non-reversible-looking", () => {
    const key = randomBytes(32);
    expect(keyFingerprint(key)).toBe(keyFingerprint(key));
    expect(keyFingerprint(key)).toHaveLength(12);
  });

  // AUDIT FIX (13): the scrypt work factor is now versioned per-config so it can be raised later
  // WITHOUT locking out existing vaults.
  it("stamps the KDF params into a new config", () => {
    const { config } = newKeyConfig("pass-with-params");
    expect(config.N).toBe(1 << 16);   // new default
    expect(config.r).toBe(8);
    expect(config.p).toBe(1);
  });

  it("still unlocks a LEGACY config that predates params (derived at the old factor)", () => {
    // Simulate a pre-versioning config: derive the verifier at the legacy factor, store NO params.
    const salt = randomBytes(16);
    const legacyKey = deriveKey("old-vault-pass", salt, { N: 1 << 15 });
    const legacyConfig = { salt: salt.toString("base64url"), verifier: encrypt("sam-vault-verifier-v1", legacyKey), createdAt: 1 };
    const opened = unlockKey("old-vault-pass", legacyConfig as any);   // must fall back to legacy N
    expect(opened).not.toBeNull();
    expect(unlockKey("wrong", legacyConfig as any)).toBeNull();
  });
});
