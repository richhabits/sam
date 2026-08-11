// ─────────────────────────────────────────────────────────────
//  S.A.M. · STAPLE THE DMG — runs after every artefact is built
//
//  afterSign notarizes the .app. That is necessary and NOT sufficient, and the gap is invisible
//  unless you go and look. After a build that logged "accepted and stapled ✓", the app was
//  genuinely notarized —
//      spctl -a -t execute SAM.app        →  accepted, source=Notarized Developer ID
//  — while the file people actually download carried no ticket of its own:
//      xcrun stapler validate SAM-3.4.0-arm64.dmg  →  does not have a ticket stapled to it
//
//  The DMG is a separate artefact, built AFTER the app was notarized, so nothing had ever
//  submitted it. Gatekeeper then has to ask Apple over the network the first time someone opens
//  it — which stalls on a bad connection and fails outright offline. Stapling puts the ticket in
//  the file, so it verifies locally every time, which is the entire point of notarizing.
//
//  Credentials resolve exactly as in the app hook: keychain profile locally, environment
//  variables in CI. An unsigned build skips, because there is nothing to staple a ticket to.
// ─────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { notaryCredentials, skipRequested } from "./notary-credentials.mjs";

export default async function afterAllArtifactBuild(buildResult) {
  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  if (!dmgs.length) return [];

  if (skipRequested()) {
    console.log("  staple · SKIPPED deliberately (SAM_SKIP_NOTARIZE=1) — do not publish this build");
    return [];
  }

  // No credentials here means the unsigned-build path, which the app hook has already reported.
  // Staying quiet-but-explicit beats failing a build that was never going to be published.
  const creds = notaryCredentials();
  if (!creds) {
    console.log("  staple · no notarization credentials — dmg left unstapled (unsigned build)");
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`  staple · notarizing ${dmg.split("/").pop()} — the file people download…`);
    // --wait, so a build cannot report success while Apple is still deciding, which is precisely
    // how an unstapled DMG ends up on a release page underneath a green log.
    execFileSync("xcrun", ["notarytool", "submit", dmg, ...creds.notarytoolArgs, "--wait"], { stdio: "inherit", timeout: 30 * 60_000 });
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit", timeout: 5 * 60_000 });
    // Verified, not assumed. This file exists because a log line said "stapled" about something
    // that was not — so the last word goes to the tool that can actually check.
    execFileSync("xcrun", ["stapler", "validate", dmg], { stdio: "inherit", timeout: 60_000 });
    console.log("  staple · ticket attached and validated ✓");
  }
  return [];
}
