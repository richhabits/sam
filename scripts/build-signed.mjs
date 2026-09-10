// ─────────────────────────────────────────────────────────────
//  S.A.M. · signed + notarized Mac build → real silent auto-update
//
//  One-time setup (the owner) — a "Developer ID Application" certificate in your Keychain
//  (create once in Xcode → Settings → Accounts → Manage Certificates), plus ONE of:
//    · a Keychain notarization profile (see notary-credentials.mjs for the exact command) — the
//      operator's Mac, credentials never touch the repo/env/a log.
//    · APPLE_ID / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD in .env (or Settings → 🍎 Signed
//      releases) — CI, which has no Keychain to store anything in.
//
//  Usage:
//    npm run build:mac:signed        build + sign + notarize
//    npm run release:app             …then upload dmg + update manifests to the
//                                    GitHub release for the current version, so
//                                    every installed SAM silently self-updates.
// ─────────────────────────────────────────────────────────────
import "dotenv/config";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { notaryCredentials, profileName } from "./notary-credentials.mjs";

const run = (c) => execSync(c, { stdio: "inherit" });
const quiet = (c) => { try { return execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };

// THIS SCRIPT USED TO PACKAGE WHATEVER WAS ALREADY IN dist/.
//
// Every other target runs `preflight && npm run build && electron-builder`. This one — the ONLY
// one that produces a shippable, auto-updating release — went straight to electron-builder, so
// it packaged whatever dist/ happened to hold. A release built that way carries the last build
// someone happened to run, which may predate the very fix it is being cut for, and nothing
// anywhere says so: the app starts, serves an old bundle, and reports the new version number.
// That has already cost a session once (see the stale-bundle hunt in the yard work).
//
// Both steps are now here, in the same order the other targets use. The path check matters just
// as much: node-gyp and electron-builder cannot pack an asar from a directory whose path
// contains a space, and they fail deep inside with a cryptic offset error rather than saying so.
run(`node scripts/preflight-build.mjs`);
run(`npm run build`);
// electron-builder runs with npmRebuild=false (see package.json's "build" field) — it will NOT
// fix better-sqlite3's ABI itself. Skipping this step ships a Node-ABI binary inside an
// Electron-ABI app, which doesn't fail to build: it fails at LAUNCH, on every machine that
// installs the DMG, with "Cannot find module .../better_sqlite3.node" — a real incident, not a
// hypothetical (2026-09-10, chasing exactly this after a bare `electron-builder --mac`).
run(`npm run electron:sqlite`);

// Notarization is what stops Gatekeeper telling a downloader that Apple "cannot check it for
// malicious software". Skipping it is a real, visible downgrade for anyone who does not build
// the app themselves, so it must be asked for out loud rather than inferred from a missing
// variable — otherwise the first person to lose their credentials silently ships a DMG that
// nobody else can open.
//
// Checked via notaryCredentials() (the SAME lookup notarize.mjs's afterSign hook actually uses:
// keychain profile first, env vars second) rather than testing APPLE_ID/APPLE_TEAM_ID/
// APPLE_APP_SPECIFIC_PASSWORD directly — this used to refuse to even START a build on a machine
// with a working keychain profile and no .env, because it only knew how to check one of the two
// legitimate credential paths (see notary-credentials.mjs's own header comment).
const skipNotarize = process.argv.includes("--skip-notarize");
const creds = notaryCredentials();
if (!creds && !skipNotarize) {
  console.error(`\n✗ Signed build needs notarization credentials, and none were found.`);
  console.error(`  Locally, store them once in the Keychain:`);
  console.error(`    xcrun notarytool store-credentials "${profileName()}" --apple-id <apple-id> --team-id <team> --password <app-specific-password>`);
  console.error("  Or set APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID in .env (CI-style).");
  console.error("  Signed but NOT notarized (fine for your own machine, Gatekeeper-blocked for anyone");
  console.error("  who downloads it): npm run build:mac:signed -- --skip-notarize");
  console.error("  Plain unsigned build still works: npm run build:mac\n");
  process.exit(1);
}
if (creds) console.log(`\n🔑 notarizing via ${creds.how}`);
if (skipNotarize) {
  console.warn("\n⚠️  --skip-notarize: this build is SIGNED but NOT NOTARIZED.");
  console.warn("   It will run on this Mac. Anyone who DOWNLOADS it gets Gatekeeper's");
  console.warn("   \"Apple cannot check it for malicious software\" — do not publish it as a release.\n");
}
const identity = quiet(`security find-identity -v -p codesigning | grep "Developer ID Application" | head -1`);
if (!identity) {
  console.error("\n✗ No 'Developer ID Application' certificate in your Keychain.");
  console.error("  Create one: Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application\n");
  process.exit(1);
}
console.log(`\n🔏 signing as: ${identity.replace(/^\s*\d+\)\s*[A-F0-9]+\s*/, "")}`);

// Build (signed, and notarized unless explicitly skipped). electron-builder picks the Keychain
// signing identity automatically; notarization itself runs through notarize.mjs's afterSign hook,
// which resolves credentials via notaryCredentials() — the same call this file already checked.
run(`npx electron-builder --mac --config.mac.notarize=${skipNotarize ? "false" : "true"}`);

// An unnotarized build must never become a release: electron-updater would hand every installed
// SAM a DMG that Gatekeeper refuses, which is worse than not updating at all.
if (skipNotarize && process.argv.includes("--upload")) {
  console.error("\n✗ Refusing to upload an unnotarized build as a release.");
  console.error(`  Set up notarization credentials (see the error above this build printed) and build again.\n`);
  process.exit(1);
}

if (process.argv.includes("--upload")) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const tag = `v${version}`;
  console.log(`\n🚀 uploading to GitHub release ${tag} (creating it if needed)…`);
  quiet(`gh release create ${tag} --title "SAM ${version}" --notes "Signed build — installed apps auto-update to this." `) ||
    console.log("  (release exists — uploading assets)");
  // dmg + the update manifests electron-updater reads (latest-mac.yml, .blockmap)
  run(`gh release upload ${tag} dist-app/*.dmg dist-app/*.blockmap dist-app/latest-mac.yml --clobber`);
  console.log(`\n✅ Done — every installed SAM will silently update to ${version}.`);
}

// Restore better-sqlite3 for plain Node after electron-builder's ABI rebuild.
try { run("npm rebuild better-sqlite3 --silent"); } catch { /* native rebuild is best-effort; the build continues and fails loudly if the module is unusable */ }
