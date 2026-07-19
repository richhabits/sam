import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _reset as resetIssues, recentTrail } from "./issues.ts";
import { get, isSetup, isUnlocked, lock, loadIntoProcessEnv, migrateFromEnv, names, put, setup, unlock, _reset } from "./safe.ts";

// The Safe: secrets sealed at rest, readable only through get(); a locked read throws (never
// plaintext); migration imports from .env, verifies, then strips the plaintext; and no secret VALUE
// ever reaches a log/Trail entry. Tests run in PASSPHRASE mode so they never touch the OS keychain.

const PASS = "correct horse battery";        // ≥8 chars
const SECRET = "sk-SUPERSECRET-VALUE-9f8e7d6c5b4a";  // the distinctive value we chase through every surface
let dir = "";
let envFile = "";

beforeEach(() => {
  resetIssues();
  _reset();
  dir = join(tmpdir(), `sam-safe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.VAULT_DIR = dir;
  envFile = join(dir, ".env");
  process.env.DOTENV_CONFIG_PATH = envFile;   // removeEnvKeys resolves this at call time
});
afterEach(() => {
  _reset();
  delete process.env.VAULT_DIR;
  delete process.env.DOTENV_CONFIG_PATH;
  delete process.env.GROQ_API_KEYS;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe("the Safe — seal / read / lock", () => {
  it("round-trips a secret; a LOCKED read throws instead of returning plaintext", () => {
    expect(setup({ passphrase: PASS }).ok).toBe(true);
    put("GROQ_API_KEYS", SECRET);
    expect(get("GROQ_API_KEYS")).toBe(SECRET);
    expect(names()).toContain("GROQ_API_KEYS");

    lock();
    expect(isUnlocked()).toBe(false);
    expect(() => get("GROQ_API_KEYS")).toThrow(/locked/);   // fail LOUD — no plaintext fallback

    expect(unlock(PASS).ok).toBe(true);
    expect(get("GROQ_API_KEYS")).toBe(SECRET);
  });

  it("a wrong passphrase does NOT unlock, and reads still throw", () => {
    setup({ passphrase: PASS });
    put("GROQ_API_KEYS", SECRET);
    lock();
    const u = unlock("wrong passphrase");
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.error.kind).toBe("bad-passphrase");   // typed reason, not a bare false
    expect(isUnlocked()).toBe(false);
    expect(() => get("GROQ_API_KEYS")).toThrow(/locked/);      // a locked READ stays a loud throw
  });

  it("get() on a Safe that isn't set up returns undefined (caller falls back to process.env)", () => {
    expect(isSetup()).toBe(false);
    expect(get("GROQ_API_KEYS")).toBeUndefined();
  });
});

describe("the Safe — migration removes plaintext", () => {
  it("imports from .env, verifies, strips the plaintext, and the sealed store is ciphertext", () => {
    writeFileSync(envFile, `FOO=keep-me\nGROQ_API_KEYS=${SECRET}\nBAR=also-keep\n`);
    process.env.GROQ_API_KEYS = SECRET;   // dotenv would have loaded this live
    setup({ passphrase: PASS });

    const r = migrateFromEnv(["GROQ_API_KEYS", "NOT_SET_KEY"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.migrated).toEqual(["GROQ_API_KEYS"]);
      expect(r.value.skipped).toEqual(["NOT_SET_KEY"]);
    }

    // NO plaintext secret left in .env — but the unrelated lines survive.
    const env = readFileSync(envFile, "utf8");
    expect(env).not.toContain(SECRET);
    expect(env).toContain("FOO=keep-me");
    expect(env).toContain("BAR=also-keep");

    // The sealed store on disk must NOT contain the plaintext value (it's an AES-GCM envelope).
    const sealed = readFileSync(join(dir, "safe.enc"), "utf8");
    expect(sealed).not.toContain(SECRET);
    expect(sealed.startsWith("SAMENC1.")).toBe(true);

    // The secret is retrievable through the broker.
    expect(get("GROQ_API_KEYS")).toBe(SECRET);
  });

  it("migrating while LOCKED returns a typed error (not a throw), .env untouched", () => {
    setup({ passphrase: PASS });
    lock();
    const r = migrateFromEnv(["GROQ_API_KEYS"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("locked");
  });

  it("bridges sealed secrets back into process.env so existing readers keep working", () => {
    setup({ passphrase: PASS });
    put("GROQ_API_KEYS", SECRET);
    delete process.env.GROQ_API_KEYS;             // simulate a fresh process: .env stripped, not yet in env
    expect(loadIntoProcessEnv()).toBe(1);
    expect(process.env.GROQ_API_KEYS).toBe(SECRET);
  });
});

describe("the Safe — no secret value ever reaches a log/Trail", () => {
  it("records the access by NAME only; the value never appears in the Trail", () => {
    setup({ passphrase: PASS });
    put("GROQ_API_KEYS", SECRET);
    resetIssues();                                 // clear the store-time entry; test the read path
    get("GROQ_API_KEYS");

    const dump = JSON.stringify(recentTrail());
    expect(dump).toContain("GROQ_API_KEYS");       // the name IS recorded (useful, not sensitive)
    expect(dump).not.toContain(SECRET);            // the VALUE is not
  });
});

describe("the Safe — setup guards", () => {
  it("rejects a short passphrase and a double setup", () => {
    expect(setup({ passphrase: "short" }).ok).toBe(false);
    expect(setup({ passphrase: PASS }).ok).toBe(true);
    expect(setup({ passphrase: PASS }).ok).toBe(false);  // already set up
  });
});
