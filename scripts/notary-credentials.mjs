// ─────────────────────────────────────────────────────────────
//  S.A.M. · WHO ARE WE TO APPLE — one answer, used by both notarization hooks
//
//  There are two legitimate ways this project proves its identity to the notary service, and they
//  belong to two different machines:
//
//    · a KEYCHAIN PROFILE  — the operator's Mac. The app-specific password lives in the login
//      keychain and is referred to by name, so it is never in the repo, the environment, or a log.
//    · ENVIRONMENT VARIABLES — CI, which has no keychain to store anything in and injects
//      APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID from repository secrets.
//
//  Supporting only the first is what made this file necessary: a local-only hook would throw on
//  every CI macOS build, and "main is red because of the release tooling" is its own outage.
// ─────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";

// Read when ASKED, not when imported. A module-level constant freezes the name at import time,
// which is invisible locally (the env is set before node starts) and wrong anywhere the
// environment is arranged after load — the same class of bug as config captured at boot.
export const profileName = () => process.env.SAM_NOTARY_PROFILE || "SAM";

/** Is a keychain profile of this name actually stored? Asked before any upload, so a missing one
 *  fails with a sentence telling you what to run rather than a stack trace mid-build. */
function keychainProfileExists(profile) {
  try {
    execFileSync("xcrun", ["notarytool", "history", "--keychain-profile", profile], { stdio: "pipe", timeout: 60_000 });
    return true;
  } catch { return false; }
}

/** Credentials for @electron/notarize, or argv for a raw `notarytool` call — or null if neither
 *  route is configured. Null is not automatically an error: an unsigned build has nothing to
 *  notarize. The CALLER decides whether null is fatal, because only the caller knows if the
 *  artefact was signed. */
export function notaryCredentials() {
  const profile = profileName();
  if (keychainProfileExists(profile)) {
    return {
      how: `keychain profile "${profile}"`,
      notarizeOptions: { keychainProfile: profile },
      notarytoolArgs: ["--keychain-profile", profile],
    };
  }
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (appleId && appleIdPassword && teamId) {
    return {
      how: `environment credentials (${appleId})`,
      notarizeOptions: { appleId, appleIdPassword, teamId },
      // Password passed via --password; it is already in this process's environment either way,
      // and notarytool has no keychain to read from on a CI runner.
      notarytoolArgs: ["--apple-id", appleId, "--password", appleIdPassword, "--team-id", teamId],
    };
  }
  return null;
}

/** Was this .app signed with a real Developer ID? Notarization is only possible — and only
 *  MEANINGFUL — if it was. CI deliberately produces unsigned builds when the cert secret is
 *  absent, and those must skip cleanly rather than fail. */
export function isDeveloperIdSigned(appPath) {
  try {
    const out = execFileSync("codesign", ["-dvv", appPath], { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
    return /Authority=Developer ID Application/.test(String(out));
  } catch (err) {
    // codesign writes its detail to stderr and exits non-zero when unsigned; read it rather than
    // assuming, so a signed-but-oddly-reported app is not mistaken for an unsigned one.
    return /Authority=Developer ID Application/.test(String(err?.stderr || ""));
  }
}

export const skipRequested = () => process.env.SAM_SKIP_NOTARIZE === "1";
