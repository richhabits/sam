import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// vault-crypto keeps module state (the session key) + reads VAULT_DIR at load, so each test points
// it at a scratch dir and re-imports a FRESH module (resetModules). The promise under test: a secret
// is NEVER written in plaintext while encryption is enabled, whatever happens to the config read.
let dir: string;
let V: typeof import("./vault-crypto.ts");

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-vaultcrypto-"));
  process.env.VAULT_DIR = dir;
  vi.resetModules();
  V = await import("./vault-crypto.ts");   // re-evaluated with this test's VAULT_DIR + own sessionKey
});
afterEach(() => { delete process.env.VAULT_DIR; rmSync(dir, { recursive: true, force: true }); });

describe("seal fails CLOSED, never to plaintext (audit finding 4)", () => {
  it("passes plaintext through ONLY when encryption is genuinely not set up", () => {
    expect(V.isEncryptionEnabled()).toBe(false);
    expect(V.seal("hello")).toBe("hello");   // no config → passthrough is correct
  });

  it("THROWS instead of writing plaintext when a config exists but the vault is locked", () => {
    // Encryption IS enabled (config present) but not unlocked. The old bug returned plaintext when
    // the config couldn't be parsed; now existence alone means "enabled → never plaintext".
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "encryption.json"), '{"salt":"x","verifier":"y","createdAt":1}');
    expect(V.isEncryptionEnabled()).toBe(true);
    expect(() => V.seal("a-real-secret")).toThrow(/locked/);
  });

  it("even a CORRUPT/unreadable config is treated as enabled (fail closed), not off", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "encryption.json"), "{ this is not valid json");
    expect(V.isEncryptionEnabled()).toBe(true);           // exists → enabled
    expect(() => V.seal("a-real-secret")).toThrow(/locked/);   // NOT plaintext passthrough
  });
});

describe("real round-trip once unlocked", () => {
  it("seals to ciphertext and opens it back", () => {
    const r = V.setupEncryption("correct horse battery staple");
    expect(r.ok).toBe(true);
    const env = V.seal("my secret");
    expect(env).not.toContain("my secret");   // ciphertext
    expect(V.open(env)).toBe("my secret");
  });
});
