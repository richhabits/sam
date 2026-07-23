// ─────────────────────────────────────────────────────────────
//  S.A.M. · VAULT ENCRYPTION MANAGER  (v1.5 Phase 1)
//
//  Key lifecycle for at-rest encryption: set a passphrase, unlock on boot
//  (from the OS keychain when available, else the passphrase), and seal/open
//  strings with the session key. Opt-in — nudged on first run, off by default.
//
//  Keychain: macOS `security`, Linux `secret-tool` (libsecret), Windows DPAPI.
//  If none is available, SAM falls back to asking for the passphrase each boot.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { newKeyConfig, unlockKey, encrypt, decrypt, keyFingerprint, type KeyConfig } from "./crypto-vault.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const CONFIG = join(VAULT_DIR, "encryption.json");
const KEYCHAIN_SERVICE = "sam-vault-key";

interface EncConfig extends KeyConfig { keychain: boolean }

let sessionKey: Buffer | null = null;

function loadConfig(): EncConfig | null {
  try { return existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : null; } catch { return null; }
}
function saveConfig(c: EncConfig) { if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true }); writeFileAtomic(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 }); }   // 0600 — KDF salt/verifier

export function isEncryptionEnabled(): boolean { return !!loadConfig(); }
export function isUnlocked(): boolean { return !!sessionKey; }

// ── OS KEYCHAIN (best-effort; silent failure → passphrase fallback) ──
function keychainStore(keyHex: string): boolean {
  try {
    if (process.platform === "darwin") {
      execFileSync("/usr/bin/security", ["add-generic-password", "-a", "sam", "-s", KEYCHAIN_SERVICE, "-w", keyHex, "-U"], { stdio: "ignore" });
      return true;
    }
    if (process.platform === "linux") {
      execFileSync("secret-tool", ["store", "--label=SAM vault key", "service", KEYCHAIN_SERVICE], { input: keyHex, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
    if (process.platform === "win32") {
      // DPAPI-protected file (per-user). Best-effort; a real build may use a native module.
      execFileSync("powershell", ["-NoProfile", "-Command",
        `$b=[Text.Encoding]::UTF8.GetBytes('${keyHex}');` +
        `$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser');` +
        `[IO.File]::WriteAllBytes('${join(VAULT_DIR, "keychain.dpapi").replace(/\\/g, "\\\\")}',$p)`], { stdio: "ignore" });
      return true;
    }
  } catch { /* keychain unavailable */ }
  return false;
}
function keychainRetrieve(): string | null {
  try {
    if (process.platform === "darwin")
      return execFileSync("/usr/bin/security", ["find-generic-password", "-a", "sam", "-s", KEYCHAIN_SERVICE, "-w"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
    if (process.platform === "linux")
      return execFileSync("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
    if (process.platform === "win32") {
      const f = join(VAULT_DIR, "keychain.dpapi");
      if (!existsSync(f)) return null;
      return execFileSync("powershell", ["-NoProfile", "-Command",
        `$p=[IO.File]::ReadAllBytes('${f.replace(/\\/g, "\\\\")}');` +
        `$b=[Security.Cryptography.ProtectedData]::Unprotect($p,$null,'CurrentUser');` +
        `[Text.Encoding]::UTF8.GetString($b)`], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
    }
  } catch { /* not stored / keychain unavailable */ }
  return null;
}

export interface SetupResult { ok: boolean; fingerprint?: string; keychain: boolean; warning: string; reason?: string }

// First-time setup: derive the key, persist the salt+verifier (never the key), park the key in the
// OS keychain if the user wants boot auto-unlock. There is NO recovery without the passphrase.
export function setupEncryption(passphrase: string, useKeychain = true): SetupResult {
  if (loadConfig()) return { ok: false, keychain: false, warning: "", reason: "Encryption is already set up." };
  if (!passphrase || passphrase.length < 8) return { ok: false, keychain: false, warning: "", reason: "Passphrase must be at least 8 characters." };
  const { config, key } = newKeyConfig(passphrase);
  const keychain = useKeychain ? keychainStore(key.toString("hex")) : false;
  saveConfig({ ...config, keychain });
  sessionKey = key;
  return {
    ok: true, fingerprint: keyFingerprint(key), keychain,
    warning: "⚠️ There is NO recovery. If you forget this passphrase" + (keychain ? " AND lose access to your keychain" : "") + ", your encrypted data is permanently unreadable. Store the passphrase somewhere safe.",
  };
}

export function unlockWithPassphrase(passphrase: string): boolean {
  const c = loadConfig(); if (!c) return false;
  const key = unlockKey(passphrase, c);
  if (!key) return false;
  sessionKey = key;
  return true;
}

// Boot auto-unlock from the keychain. Returns true if it unlocked without a passphrase.
export function unlockFromKeychain(): boolean {
  const c = loadConfig(); if (!c?.keychain) return false;
  const hex = keychainRetrieve(); if (!hex) return false;
  try { sessionKey = Buffer.from(hex, "hex"); return sessionKey.length === 32; } catch { sessionKey = null; return false; }
}

export function lock(): void { sessionKey = null; }

export function encryptionStatus() {
  const c = loadConfig();
  return { enabled: !!c, unlocked: isUnlocked(), keychain: !!c?.keychain, fingerprint: sessionKey ? keyFingerprint(sessionKey) : null };
}

// Seal / open arbitrary strings with the session key — the primitive other subsystems adopt to
// store secrets encrypted at rest. Throws if encryption is enabled but locked (fail closed).
export function seal(plaintext: string): string {
  if (!isEncryptionEnabled()) return plaintext;         // encryption off → passthrough
  if (!sessionKey) throw new Error("vault is locked");
  return encrypt(plaintext, sessionKey);
}
export function open(data: string): string {
  if (!data?.startsWith("SAMENC1.")) return data;   // not sealed → return as-is (migration-friendly)
  if (!sessionKey) throw new Error("vault is locked");
  return decrypt(data, sessionKey);
}
