// ─────────────────────────────────────────────────────────────
//  S.A.M. · SIGN & SHIP — make code-signing something you ACTIVATE
//  in Settings, not a scary external checklist. SAM checks what you
//  already have, tells you plainly what's missing, and does the
//  mechanical bits it can (read the Keychain, generate an Android
//  keystore locally). Owner-only (loopback) — it touches signing.
// ─────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const exec = promisify(execFile);
const VAULT = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");

export interface SigningStatus {
  mac: {
    hasCert: boolean; certName: string;
    hasAppleId: boolean; hasTeamId: boolean; hasPassword: boolean;
    ready: boolean; next: string;
  };
  android: { hasKeystore: boolean; keystorePath: string };
}

// Read the Mac signing picture: is a Developer ID cert in the Keychain, and are the
// notarization creds set? Returns a plain-English "what's next".
export async function signingStatus(): Promise<SigningStatus> {
  let certName = ""; let hasCert = false;
  try {
    const { stdout } = await exec("security", ["find-identity", "-v", "-p", "codesigning"]);
    const m = stdout.match(/"(Developer ID Application:[^"]+)"/);
    if (m) { hasCert = true; certName = m[1]; }
  } catch { /* security not available or no identities */ }

  const hasAppleId = !!process.env.APPLE_ID;
  const hasTeamId = !!process.env.APPLE_TEAM_ID;
  const hasPassword = !!process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const ready = hasCert && hasAppleId && hasTeamId && hasPassword;

  let next = "";
  if (ready) next = "✓ All set — your next build will be signed & notarized (opens with no warning).";
  else if (!hasCert) next = "Create a “Developer ID Application” certificate in your Apple Developer account, then double-click it to install it in your Keychain.";
  else if (!hasAppleId || !hasTeamId) next = "Add your Apple ID email and Team ID below.";
  else if (!hasPassword) next = "Add an app-specific password (from appleid.apple.com) below — needed to notarize.";

  const keystorePath = join(VAULT, "signing", "android.keystore");
  return {
    mac: { hasCert, certName, hasAppleId, hasTeamId, hasPassword, ready, next },
    android: { hasKeystore: existsSync(keystorePath), keystorePath },
  };
}

// Generate an Android signing keystore entirely locally (no account needed) with keytool.
// This is the whole of "Android signing setup" — the keystore is what signs an APK.
export async function generateAndroidKeystore(alias = "sam", validityYears = 27): Promise<{ ok: boolean; path?: string; password?: string; error?: string }> {
  try {
    const dir = join(VAULT, "signing");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "android.keystore");
    if (existsSync(path)) return { ok: false, error: "A keystore already exists (delete vault/signing/android.keystore to make a new one)." };
    const password = randomBytes(18).toString("base64url");
    await exec("keytool", [
      "-genkeypair", "-v",
      "-keystore", path,
      "-alias", alias,
      "-keyalg", "RSA", "-keysize", "2048",
      "-validity", String(validityYears * 365),
      "-storepass", password, "-keypass", password,
      "-dname", "CN=SAM, OU=HECTIC, O=HECTIC, C=US",
    ]);
    return { ok: true, path, password };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}
