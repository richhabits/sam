// ─────────────────────────────────────────────────────────────
//  S.A.M. · VAULT ENCRYPTION AT REST  (v1.5 Phase 1)
//
//  Optional (nudged on first run) passphrase-based encryption for everything
//  sensitive at rest — the vault, the life index, and .env. A passphrase is
//  stretched with scrypt into a 256-bit key; files are sealed with
//  AES-256-GCM (authenticated — tampering is detected). The derived key can be
//  parked in the OS keychain (macOS Keychain / Windows DPAPI / Linux libsecret)
//  so boot auto-unlocks; otherwise the user enters the passphrase.
//
//  RECOVERY: there is NO backdoor. Lose the passphrase (and the keychain entry)
//  and the data is unrecoverable — by design. The setup flow states this plainly.
// ─────────────────────────────────────────────────────────────

import { scryptSync, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual, createHash } from "node:crypto";

const SCRYPT_N = 1 << 15;   // 32768 — strong + ~sub-second on a laptop
const SCRYPT_r = 8, SCRYPT_p = 1;
const KEYLEN = 32;          // AES-256
const MAGIC = "SAMENC1";    // envelope version tag

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(Buffer.from(passphrase, "utf8"), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: 128 * 1024 * 1024 });
}

// Seal plaintext → a self-describing envelope string: MAGIC.iv.tag.ciphertext (all base64url).
export function encrypt(plaintext: string | Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext as any)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [MAGIC, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function isEncrypted(s: string): boolean { return typeof s === "string" && s.startsWith(MAGIC + "."); }

// Open an envelope. Throws on a wrong key or any tampering (GCM auth failure).
export function decrypt(envelope: string, key: Buffer): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== MAGIC) throw new Error("not a SAM envelope");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// A small verifier stored alongside the salt, so we can tell a CORRECT passphrase from a wrong one
// without needing to decrypt real data (and without storing the key). It's the GCM tag over a
// known constant — only the right key reproduces it.
const VERIFIER_PLAINTEXT = "sam-vault-verifier-v1";
export interface KeyConfig { salt: string; verifier: string; createdAt: number }

export function newKeyConfig(passphrase: string): { config: KeyConfig; key: Buffer } {
  const salt = randomBytes(16);
  const key = deriveKey(passphrase, salt);
  return { config: { salt: salt.toString("base64url"), verifier: encrypt(VERIFIER_PLAINTEXT, key), createdAt: Date.now() }, key };
}

// Check a passphrase against a stored config → the derived key, or null if wrong. Constant-time-ish.
export function unlockKey(passphrase: string, config: KeyConfig): Buffer | null {
  try {
    const key = deriveKey(passphrase, Buffer.from(config.salt, "base64url"));
    const check = decrypt(config.verifier, key);
    const a = Buffer.from(check), b = Buffer.from(VERIFIER_PLAINTEXT);
    return a.length === b.length && timingSafeEqual(a, b) ? key : null;
  } catch { return null; }
}

// Cheap fingerprint of a key (for logging/telemetry-free identity) — never the key itself.
export function keyFingerprint(key: Buffer): string { return createHash("sha256").update(key).digest("hex").slice(0, 12); }
