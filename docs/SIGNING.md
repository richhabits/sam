# Code-signing SAM — go-live guide

Unsigned builds work fine, but macOS Gatekeeper and Windows SmartScreen show a scary "unverified app"
warning that hurts installs. Signing removes it. **The CI is already wired** — the moment you add the
secrets below, the *next release signs itself automatically* (no workflow edits). This doc is the exact
steps + honest costs.

---

## 🍎 macOS — Developer ID + notarization

**Cost:** Apple Developer Program — **$99/year** (you already have an account).
**Result:** the `.dmg` opens with **no Gatekeeper warning**, and silent auto-update works.

### Steps
1. **Create the certificate.** Xcode → Settings → Accounts → (your Apple ID) → **Manage Certificates…** → **+** → **Developer ID Application**. It installs into your login keychain.
2. **Export it to a `.p12`.** Keychain Access → login → My Certificates → right-click `Developer ID Application: … (TEAMID)` → **Export…** → save as `cert.p12`, set a password (that's `CSC_KEY_PASSWORD`).
3. **Base64 it** (I can run this for you — it goes to your clipboard, I never see the value):
   ```
   base64 -i cert.p12 | pbcopy
   ```
4. **Get two more values:**
   - **Team ID** (10 chars): [developer.apple.com](https://developer.apple.com) → Membership.
   - **App-specific password:** [appleid.apple.com](https://appleid.apple.com) → Sign-In & Security → App-Specific Passwords → generate one ("SAM notarize").
5. **Add 5 GitHub secrets** (Settings → Secrets and variables → Actions → New repository secret):
   | Secret | Value |
   |---|---|
   | `CSC_LINK` | the base64 blob from step 3 |
   | `CSC_KEY_PASSWORD` | the `.p12` export password |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | your 10-char Team ID |
6. **Cut a release.** The build logs will say `🔏 macOS: signing + notarizing`. Done — signed forever.

---

## 🪟 Windows — code-signing certificate

**Cost / options:**
- **Azure Trusted Signing — ~$10/month** (Microsoft's modern service). No hardware token. **Cheapest path**, and it gets **SmartScreen trust**. Requires an Azure account + org/individual validation.
- **OV certificate — ~$200–400/year** (Sectigo, DigiCert). Signs, but SmartScreen still warns for a few weeks until download *reputation* builds.
- **EV certificate — ~$300–600/year + USB token.** Instant SmartScreen trust from day one.

**Result:** the `.exe` runs with **no SmartScreen "unrecognized app"** warning (instantly with EV / Azure Trusted Signing; after reputation with OV).

### Steps (traditional OV/EV `.pfx`)
1. Buy the cert; you'll receive (or export) a `.pfx` with a password.
2. Base64 it: `base64 -i cert.pfx | pbcopy`.
3. Add 2 GitHub secrets:
   | Secret | Value |
   |---|---|
   | `WIN_CSC_LINK` | base64 of the `.pfx` |
   | `WIN_CSC_KEY_PASSWORD` | the `.pfx` password |
4. Cut a release → logs say `🔏 Windows: signing`.

*(Azure Trusted Signing uses a slightly different electron-builder config — ping me when you pick it and I'll wire the exact `signtoolOptions` block; it's a 10-minute change.)*

---

## Until then

Unsigned is completely safe — it's the same build the CI boots and tests, and every release ships
**SHA-256 checksums** (auto-appended to the release notes) so anyone can verify their download. The
[README "verify your download" section](../README.md#-verify-your-download) explains how. The one-time
"More info → Run anyway" / "right-click → Open" click is normal for indie apps and is clearly guided
on the landing page.
