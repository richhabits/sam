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

import { execFileSync, spawnSync } from "node:child_process";

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

/** Everything codesign says about a path, BOTH streams merged.
 *
 *  `codesign -dvv` writes its entire report to STDERR and exits 0 on a signed binary. Reading only
 *  stdout therefore returns "" for a perfectly signed app — and the first version of this file did
 *  exactly that, via execFileSync, whose return value is stdout alone. The stderr fallback sat in a
 *  catch block that a zero exit never reaches. CI signed the app with a real Developer ID, this
 *  said "not signed", and notarization was skipped under a green tick. spawnSync is used because it
 *  hands back both streams instead of making success and failure read from different places. */
export function codesignOutput(appPath) {
  const r = spawnSync("codesign", ["-dvv", appPath], { encoding: "utf8", timeout: 60_000 });
  return `${r.stdout || ""}${r.stderr || ""}`;
}

/** Does codesign's report describe a Developer ID signature? Split out from the command so the
 *  parsing can be tested without a signed app to hand. Apple's own binaries are signed too — by
 *  "Software Signing" — and those are NOT Developer ID and cannot be notarized by us. */
export function developerIdFromCodesignOutput(text) {
  return /Authority=Developer ID Application/.test(String(text || ""));
}

/** Was this .app signed with a real Developer ID? Notarization is only possible — and only
 *  MEANINGFUL — if it was. CI deliberately produces unsigned builds when the cert secret is
 *  absent, and those must skip cleanly rather than fail. */
export function isDeveloperIdSigned(appPath) {
  return developerIdFromCodesignOutput(codesignOutput(appPath));
}

export const skipRequested = () => process.env.SAM_SKIP_NOTARIZE === "1";
