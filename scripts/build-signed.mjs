// ─────────────────────────────────────────────────────────────
//  S.A.M. · signed + notarized Mac build → real silent auto-update
//
//  One-time setup (the owner, in Settings → 🍎 Signed releases, or .env):
//    APPLE_ID=you@icloud.com            (your Apple developer login email)
//    APPLE_TEAM_ID=ABCDE12345           (developer.apple.com → Membership)
//    APPLE_APP_SPECIFIC_PASSWORD=xxxx   (appleid.apple.com → App-Specific Passwords)
//  Plus a "Developer ID Application" certificate in your Keychain (create once
//  in Xcode → Settings → Accounts → Manage Certificates).
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
// contains a space, and they fail deep inside with a cryptic offset error rather than saying so
// — and the canonical checkout lives on a volume called "ROMEO HQ".
run(`node scripts/preflight-build.mjs`);
run(`npm run build`);

const { APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD } = process.env;
const missing = [
  !APPLE_ID && "APPLE_ID",
  !APPLE_TEAM_ID && "APPLE_TEAM_ID",
  !APPLE_APP_SPECIFIC_PASSWORD && "APPLE_APP_SPECIFIC_PASSWORD",
].filter(Boolean);

// Notarization is what stops Gatekeeper telling a downloader that Apple "cannot check it for
// malicious software". Skipping it is a real, visible downgrade for anyone who does not build
// the app themselves, so it must be asked for out loud rather than inferred from a missing
// variable — otherwise the first person to lose their credentials silently ships a DMG that
// nobody else can open.
const skipNotarize = process.argv.includes("--skip-notarize");
if (missing.length && !skipNotarize) {
  console.error(`\n✗ Signed build needs these in .env (or Settings → 🍎 Signed releases): ${missing.join(", ")}`);
  console.error("  Signed but NOT notarized (fine for your own machine, Gatekeeper-blocked for anyone");
  console.error("  who downloads it): npm run build:mac:signed -- --skip-notarize");
  console.error("  Plain unsigned build still works: npm run build:mac\n");
  process.exit(1);
}
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
// identity automatically; notarization uses the APPLE_* env vars above.
run(`npx electron-builder --mac --config.mac.notarize=${skipNotarize ? "false" : "true"}`);

// An unnotarized build must never become a release: electron-updater would hand every installed
// SAM a DMG that Gatekeeper refuses, which is worse than not updating at all.
if (skipNotarize && process.argv.includes("--upload")) {
  console.error("\n✗ Refusing to upload an unnotarized build as a release.");
  console.error("  Set APPLE_ID / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD and build again.\n");
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
