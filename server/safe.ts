// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE SAFE  — the single local broker for secrets at rest.
//
//  Every secret SAM holds (cloud-brain API keys, the key pool, tool credentials) belongs in the
//  Safe, sealed on disk and readable only through this module. It is the ONE place plaintext lives:
//  everything else asks `get()` at point of use. The Safe is "locked" on disk — a sealed store plus
//  a data key that only the OS keychain (or a passphrase) holds — and unlocked on launch.
//
//  Encryption reuses SAM's own primitives (crypto-vault: AES-256-GCM + scrypt). The data key is a
//  random 32 bytes, parked in the OS keychain for seamless boot-unlock, with an optional passphrase
//  fallback for machines without one. A LOCKED read throws — the Safe never falls back to plaintext.
//
//  THREAT MODEL (honest): protects against OFFLINE theft of the files or a backup (Time Machine,
//  cloud sync, a lost/resold disk, a copied folder). It does NOT protect against malware running AS
//  THE USER on an unlocked machine — that code can ask the keychain (or read process memory) exactly
//  as SAM does. Secrets in use are plaintext in memory and sent to providers over TLS. No on-device
//  scheme can change that.  Access is recorded to the Black Box REDACTED — the value never leaves here.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decrypt, encrypt } from "./crypto-vault.ts";
import { removeEnvKeys } from "./env-file.ts";
import { trail } from "./issues.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYCHAIN_SERVICE = "sam-safe-key";
// Resolved at call time — VAULT_DIR is set by preboot and moved per-test.
const safeDir = () => process.env.VAULT_DIR || join(HERE, "..", "vault");
const storePath = () => join(safeDir(), "safe.enc");     // the sealed name→value map
const configPath = () => join(safeDir(), "safe.json");   // mode + (passphrase) wrapped data key — NEVER the plaintext key

interface SafeConfig { mode: "keychain" | "passphrase"; wrapped?: string; salt?: string; createdAt: number }

let dataKey: Buffer | null = null;   // the unlocked data key, in memory only

function scryptKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(Buffer.from(passphrase, "utf8"), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}
function loadConfig(): SafeConfig | null {
  try { return JSON.parse(readFileSync(configPath(), "utf8")) as SafeConfig; } catch { return null; }
}
function saveConfig(c: SafeConfig): void {
  mkdirSync(safeDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(c, null, 2));
}

// ── OS keychain (best-effort; failure → the caller uses a passphrase instead). Mirrors SAM's proven
//    per-platform access, under the Safe's own service name so it never collides with the vault key.
function keychainStore(keyHex: string): boolean {
  try {
    if (process.platform === "darwin") {
      execFileSync("/usr/bin/security", ["add-generic-password", "-a", "sam", "-s", KEYCHAIN_SERVICE, "-w", keyHex, "-U"], { stdio: "ignore" });
      return true;
    }
    if (process.platform === "linux") {
      execFileSync("secret-tool", ["store", "--label=SAM Safe key", "service", KEYCHAIN_SERVICE], { input: keyHex, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
    if (process.platform === "win32") {
      execFileSync("powershell", ["-NoProfile", "-Command",
        `$b=[Text.Encoding]::UTF8.GetBytes('${keyHex}');` +
        `$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser');` +
        `[IO.File]::WriteAllBytes('${join(safeDir(), "safe.keychain.dpapi").replace(/\\/g, "\\\\")}',$p)`], { stdio: "ignore" });
      return true;
    }
  } catch { /* keychain unavailable → passphrase path */ }
  return false;
}
function keychainRetrieve(): string | null {
  try {
    if (process.platform === "darwin")
      return execFileSync("/usr/bin/security", ["find-generic-password", "-a", "sam", "-s", KEYCHAIN_SERVICE, "-w"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
    if (process.platform === "linux")
      return execFileSync("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
    if (process.platform === "win32") {
      const f = join(safeDir(), "safe.keychain.dpapi");
      if (!existsSync(f)) return null;
      return execFileSync("powershell", ["-NoProfile", "-Command",
        `$p=[IO.File]::ReadAllBytes('${f.replace(/\\/g, "\\\\")}');` +
        `$b=[Security.Cryptography.ProtectedData]::Unprotect($p,$null,'CurrentUser');` +
        `[Text.Encoding]::UTF8.GetString($b)`], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
    }
  } catch { /* not stored / keychain unavailable */ }
  return null;
}

// ── the sealed store ──
function readStore(): Record<string, string> {
  if (!dataKey) throw new Error("the Safe is locked");
  const f = storePath();
  if (!existsSync(f)) return {};
  return JSON.parse(decrypt(readFileSync(f, "utf8"), dataKey)) as Record<string, string>;
}
function writeStore(map: Record<string, string>): void {
  if (!dataKey) throw new Error("the Safe is locked");
  mkdirSync(safeDir(), { recursive: true });
  writeFileSync(storePath(), encrypt(JSON.stringify(map), dataKey));
}

// ── lifecycle ──
export function isSetup(): boolean { return existsSync(configPath()); }
export function isUnlocked(): boolean { return !!dataKey; }

export interface SetupResult { ok: boolean; mode?: "keychain" | "passphrase"; reason?: string; warning?: string }

/** First-time setup: mint a random data key, park it (keychain by default; passphrase-wrapped if a
 *  passphrase is given or the keychain is unavailable), and create an empty sealed store. */
export function setup(opts: { passphrase?: string; useKeychain?: boolean } = {}): SetupResult {
  if (isSetup()) return { ok: false, reason: "The Safe is already set up." };
  const key = randomBytes(32);
  const wantPassphrase = !!opts.passphrase || opts.useKeychain === false;
  if (wantPassphrase) {
    if (!opts.passphrase || opts.passphrase.length < 8) return { ok: false, reason: "Passphrase must be at least 8 characters." };
    const salt = randomBytes(16);
    saveConfig({ mode: "passphrase", wrapped: encrypt(key.toString("hex"), scryptKey(opts.passphrase, salt)), salt: salt.toString("base64url"), createdAt: Date.now() });
    dataKey = key;
    writeStore({});
    return { ok: true, mode: "passphrase", warning: "There is NO recovery — forget the passphrase and the Safe is permanently unreadable." };
  }
  if (!keychainStore(key.toString("hex"))) return { ok: false, reason: "OS keychain is unavailable — set a passphrase instead (useKeychain:false + passphrase)." };
  saveConfig({ mode: "keychain", createdAt: Date.now() });
  dataKey = key;
  writeStore({});
  return { ok: true, mode: "keychain" };
}

/** Unlock on launch. Keychain mode is seamless (no argument); passphrase mode needs the passphrase.
 *  Returns false on failure — the caller must treat that as LOCKED, never as "run without secrets". */
export function unlock(passphrase?: string): boolean {
  const c = loadConfig();
  if (!c) return false;
  if (c.mode === "keychain") {
    const hex = keychainRetrieve();
    if (!hex) return false;
    const k = Buffer.from(hex, "hex");
    if (k.length !== 32) return false;
    dataKey = k;
    return true;
  }
  // passphrase mode
  if (!passphrase || !c.salt || !c.wrapped) return false;
  try {
    const hex = decrypt(c.wrapped, scryptKey(passphrase, Buffer.from(c.salt, "base64url"))); // throws on wrong passphrase (GCM auth)
    const k = Buffer.from(hex, "hex");
    if (k.length !== 32) return false;
    dataKey = k;
    return true;
  } catch { return false; }
}

export function lock(): void { dataKey = null; }

// ── secret access — the only plaintext door ──

/** Read a secret. Returns undefined if the Safe isn't in use (caller falls back to process.env) OR
 *  if the name isn't stored. Throws if the Safe IS set up but LOCKED — never a silent plaintext path.
 *  Records the access to the Black Box REDACTED (the name, never the value). */
export function get(name: string): string | undefined {
  if (!isSetup()) return undefined;
  if (!dataKey) throw new Error(`the Safe is locked — cannot read ${name}`);
  const value = readStore()[name];
  if (value !== undefined) trail("state", `Safe read: ${name}`, { secret: name }); // value is NEVER passed here
  return value;
}

/** Store (or replace) a secret. */
export function put(name: string, value: string): void {
  const map = readStore();
  map[name] = value;
  writeStore(map);
  trail("state", `Safe store: ${name}`, { secret: name });
}

export function has(name: string): boolean { return isSetup() && !!dataKey && name in readStore(); }
export function names(): string[] { return isSetup() && dataKey ? Object.keys(readStore()).sort() : []; }
export function status(): { setup: boolean; unlocked: boolean; mode: "keychain" | "passphrase" | null; count: number | null } {
  const c = loadConfig();
  return { setup: !!c, unlocked: !!dataKey, mode: c?.mode ?? null, count: c && dataKey ? Object.keys(readStore()).length : null };
}

// ── migration + the compatibility bridge ──

/** Import named secrets from process.env into the Safe, VERIFY every one round-trips through the
 *  sealed store, and only THEN strip the plaintext lines from .env. If verification fails for any
 *  secret, throw and leave .env intact — a migration that leaves plaintext behind (or loses a
 *  secret) must surface, never partially "succeed". */
export function migrateFromEnv(candidateNames: string[]): { migrated: string[]; skipped: string[] } {
  if (!dataKey) throw new Error("the Safe is locked — cannot migrate");
  const map = readStore();
  const migrated: string[] = [];
  const skipped: string[] = [];
  const want: Record<string, string> = {};
  for (const name of candidateNames) {
    const val = process.env[name];
    if (val === undefined || val === "") { skipped.push(name); continue; }
    map[name] = val;
    want[name] = val;
    migrated.push(name);
  }
  if (!migrated.length) return { migrated, skipped };
  writeStore(map);
  // VERIFY against a fresh decrypt of what actually landed on disk — before we strip anything.
  const check = readStore();
  for (const name of migrated) {
    if (check[name] !== want[name]) throw new Error(`Safe migration verify FAILED for ${name} — .env left intact`);
  }
  removeEnvKeys(migrated);   // plaintext gone from disk only now that it's sealed + verified
  trail("state", `Safe migrated ${migrated.length} secret(s)`, { count: migrated.length });
  return { migrated, skipped };
}

/** Bridge sealed secrets back into process.env (in memory) on unlock, so every existing reader keeps
 *  working while point-of-use callers are moved onto get() slice by slice. Only fills names not
 *  already present. Returns how many it loaded. */
export function loadIntoProcessEnv(): number {
  if (!isSetup() || !dataKey) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(readStore())) {
    if (process.env[k] === undefined) { process.env[k] = v; n++; }
  }
  return n;
}

/** Test seam — clear the in-memory unlocked key. */
export function _reset(): void { dataKey = null; }
