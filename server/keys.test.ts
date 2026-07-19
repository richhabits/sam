import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { poolSize, reloadPools } from "./keys.ts";
import { loadIntoProcessEnv, lock, put, setup, _reset } from "./safe.ts";

// Slice 3 — point of use. Provider key pools read from the SAFE first (when set up + unlocked), else
// process.env. reloadPools() rebuilds them after the Safe unlocks (pools are built at import, before
// unlock — without this they'd be empty after a migration stripped .env). And loadIntoProcessEnv does
// NOT bridge provider keys back into the environment — keys.ts reads them straight from the Safe.

const PASS = "correct horse battery";
let dir = "";
beforeEach(() => {
  _reset();
  dir = join(tmpdir(), `sam-keys-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.VAULT_DIR = dir;
  delete process.env.GROQ_API_KEYS;
  delete process.env.DISCORD_WEBHOOK;
});
afterEach(() => {
  _reset();
  delete process.env.VAULT_DIR;
  delete process.env.GROQ_API_KEYS;
  delete process.env.DISCORD_WEBHOOK;
  reloadPools();   // restore pools from the (now Safe-free) env for other suites
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("keys.ts reads provider keys from the Safe", () => {
  it("reloadPools() picks up a pooled key sealed in the Safe (the post-migration fix)", () => {
    setup({ passphrase: PASS, useKeychain: false });
    put("GROQ_API_KEYS", "k1,k2,k3");                 // sealed in the Safe, NOT in process.env
    expect(process.env.GROQ_API_KEYS).toBeUndefined();
    const total = reloadPools();
    expect(poolSize("groq")).toBe(3);                 // read straight from the Safe
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it("the Safe wins over process.env for the same provider (point of use)", () => {
    process.env.GROQ_API_KEYS = "env-only";
    setup({ passphrase: PASS, useKeychain: false });
    put("GROQ_API_KEYS", "safe-a,safe-b");
    reloadPools();
    expect(poolSize("groq")).toBe(2);                 // 2 from the Safe, not the 1 from env
  });

  it("a LOCKED Safe never throws during pool build — falls back to process.env", () => {
    process.env.GROQ_API_KEYS = "env-fallback";
    setup({ passphrase: PASS, useKeychain: false });
    put("GROQ_API_KEYS", "sealed");
    lock();                                            // set up but locked
    expect(() => reloadPools()).not.toThrow();        // must not throw mid-boot
    expect(poolSize("groq")).toBe(1);                 // fell back to the env value
  });
});

describe("the narrowing — provider keys are NOT bridged into process.env", () => {
  it("loadIntoProcessEnv bridges tool creds but skips provider keys", () => {
    setup({ passphrase: PASS, useKeychain: false });
    put("GROQ_API_KEYS", "k1,k2");                    // a provider key
    put("DISCORD_WEBHOOK", "https://hook");           // a tool credential (NOT a provider env)
    delete process.env.GROQ_API_KEYS;
    delete process.env.DISCORD_WEBHOOK;
    loadIntoProcessEnv();
    expect(process.env.DISCORD_WEBHOOK).toBe("https://hook"); // tool cred bridged for its scattered readers
    expect(process.env.GROQ_API_KEYS).toBeUndefined();       // provider key NOT bridged — read from the Safe
  });
});
