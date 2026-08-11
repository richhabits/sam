// ─────────────────────────────────────────────────────────────
//  S.A.M. · NOTARIZATION — runs after signing, before the DMG is built
//
//  Why a hook rather than `"notarize": true`: that setting makes electron-builder look for
//  APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in the ENVIRONMENT. With none of them
//  set it prints "skipped macOS notarization — options were unable to be generated" and carries
//  on to produce a DMG that looks finished and is not. That is the shape this codebase keeps
//  being audited for: a step skipped in a log nobody reads, and a broken result that is
//  byte-for-byte indistinguishable from a good one until a stranger downloads it.
//
//  It matters because an un-notarized build greets every downloader with "SAM cannot be opened
//  because Apple cannot check it for malicious software". For a free, local-first tool aimed at
//  people who are not developers, that message IS the first impression.
//
//  The rule enforced here: a build that was SIGNED must end up NOTARIZED, or the build fails.
//  An unsigned build (CI without the cert secret) has nothing to notarize and skips cleanly.
//  What must never happen again is the third case — signed, un-notarized, and quietly shipped.
// ─────────────────────────────────────────────────────────────

import { notarize } from "@electron/notarize";
import { notaryCredentials, isDeveloperIdSigned, skipRequested, profileName } from "./notary-credentials.mjs";

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "darwin") return;

  const appPath = `${appOutDir}/${packager.appInfo.productFilename}.app`;

  if (skipRequested()) {
    console.log("  notarize · SKIPPED deliberately (SAM_SKIP_NOTARIZE=1) — do not publish this build");
    return;
  }

  // An unsigned build cannot be notarized, and saying so plainly is correct behaviour, not a
  // failure. CI builds this way on purpose whenever the signing cert secret is absent.
  if (!isDeveloperIdSigned(appPath)) {
    console.log("  notarize · app is not Developer ID signed — nothing to notarize (unsigned build)");
    return;
  }

  const creds = notaryCredentials();
  if (!creds) {
    throw new Error(
      "this app WAS signed with a Developer ID but there are no notarization credentials, so it\n" +
      "would ship signed-but-un-notarized — Gatekeeper blocks that for everyone who downloads it.\n" +
      "  Locally, store credentials once:\n" +
      `    xcrun notarytool store-credentials "${profileName()}" --apple-id <apple-id> --team-id <team> --password <app-specific-password>\n` +
      "  In CI, set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.\n" +
      "  Or set SAM_SKIP_NOTARIZE=1 for a local build you are not going to publish.",
    );
  }

  console.log(`  notarize · uploading ${packager.appInfo.productFilename}.app to Apple via ${creds.how} (this takes a few minutes)…`);
  await notarize({ tool: "notarytool", appPath, ...creds.notarizeOptions });
  console.log("  notarize · accepted and stapled ✓");
}
