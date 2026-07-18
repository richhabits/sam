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

const { APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD } = process.env;
const missing = [
  !APPLE_ID && "APPLE_ID",
  !APPLE_TEAM_ID && "APPLE_TEAM_ID",
  !APPLE_APP_SPECIFIC_PASSWORD && "APPLE_APP_SPECIFIC_PASSWORD",
].filter(Boolean);
if (missing.length) {
  console.error(`\n✗ Signed build needs these in .env (or Settings → 🍎 Signed releases): ${missing.join(", ")}`);
  console.error("  Plain unsigned build still works: npm run build:mac\n");
  process.exit(1);
}
const identity = quiet(`security find-identity -v -p codesigning | grep "Developer ID Application" | head -1`);
if (!identity) {
  console.error("\n✗ No 'Developer ID Application' certificate in your Keychain.");
  console.error("  Create one: Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application\n");
  process.exit(1);
}
console.log(`\n🔏 signing as: ${identity.replace(/^\s*\d+\)\s*[A-F0-9]+\s*/, "")}`);

// Build (signed + notarized). electron-builder picks the Keychain identity automatically;
// notarization uses the APPLE_* env vars above.
run(`npx electron-builder --mac --config.mac.notarize=true`);

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
