// afterSign hook — notarize the signed .app so macOS opens it with NO Gatekeeper warning.
// SAFE by design: if the Apple credentials aren't set (unsigned builds, CI without secrets), it
// just skips. It only runs when you've actually provided a Developer ID + notarization creds.
//
// To enable: set these env vars (locally or as CI secrets) —
//   APPLE_ID                     your Apple ID email
//   APPLE_APP_SPECIFIC_PASSWORD  from appleid.apple.com -> Sign-In & Security -> App-Specific Passwords
//   APPLE_TEAM_ID                your 10-char Team ID (Apple Developer -> Membership)
export default async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("  • notarize: skipped (no Apple credentials — building unsigned/un-notarized)");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`  • notarize: submitting ${appName}.app to Apple…`);
  const { notarize } = await import("@electron/notarize");
  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log("  • notarize: ✓ done — the app will open with no Gatekeeper warning.");
}
