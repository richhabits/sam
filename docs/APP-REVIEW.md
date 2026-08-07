# App Review — the Pocket (com.hectic.sam.mobile)

Everything App Review is likely to ask about the iOS app, with the answer already written.
Paste the quoted blocks straight into App Store Connect.

The Pocket is a client for a server the user runs themselves. That single fact answers most of
what follows, and it is the thing to lead with rather than defend later.

---

## 1. Cleartext HTTP — `NSAllowsArbitraryLoads: true`

The one that gets flagged. **Keep it**, and justify it — do not narrow it to
`NSAllowsLocalNetworking` hoping the reviewer moves on: that constant covers `.local`, link-local
and the RFC1918 ranges only, and a great many users reach their own machine over Tailscale, whose
`100.64.0.0/10` is CGNAT and **not** in those ranges. Narrowing it would break real installs and
would not remove the question.

> SAM is a client for a server the user runs on their own computer. The app talks to no
> service we operate — there is no backend, no account, and no telemetry. The user types the
> address of their own machine (typically a private LAN address such as `192.168.1.x`, or a
> private VPN address such as `100.x.y.z`), and the app connects to that and nothing else.
>
> Those endpoints are private IP addresses on hardware the user controls. They cannot be issued
> a publicly trusted TLS certificate, because no certificate authority will sign a name the user
> owns privately. Requiring ATS would therefore make the app unable to reach any self-hosted
> server at all, which is its entire function.
>
> Traffic is authenticated and confined to the user's own network: the app holds a session token
> issued by an explicit on-device pairing step, stored in the iOS keychain, and sends it on every
> request. No request is made to any third-party host.

**If review pushes back**, the fallback that keeps the app working is a scoped exception per
address — but the address is user-supplied at runtime and cannot be enumerated in `Info.plist`,
so say that plainly rather than shipping something that silently fails.

## 2. Local network permission — `NSLocalNetworkUsageDescription`

Present in `mobile/app.json`. iOS 14+ requires it before an app may touch the local network, and
without it the system prompt appears with no reason on it and the connection can simply be refused.

Current string:

> SAM talks to the SAM running on your own computer, usually over your home network. Nothing is
> sent anywhere else.

## 3. Privacy — nutrition label and manifest

`ios.privacyManifests` in `mobile/app.json`, so it survives `expo prebuild` (it previously lived
only in the generated `ios/` directory, which is gitignored and regenerated).

| Declared | Value |
|---|---|
| `NSPrivacyTracking` | `false` |
| `NSPrivacyCollectedDataTypes` | *(empty)* |
| Accessed APIs | FileTimestamp `C617.1`, UserDefaults `CA92.1`, SystemBootTime `35F9.1` |

App Store Connect nutrition label: **Data Not Collected**. This is literally true — the app has no
analytics, no crash reporting, no account, and no server of ours to send anything to.

## 4. Privacy policy URL — required field

**https://richhabits.github.io/sam/privacy.html**

App Store Connect will not take a submission without one. Until now the site served only the raw
markdown (`/sam/PRIVACY.md` — a 200, but unstyled plain text). That page is generated from
`docs/PRIVACY.md` on every Pages deploy, so it cannot drift from the policy in the repo, and it's
linked from the landing page footer.

## 5. Export compliance — `ITSAppUsesNonExemptEncryption: false`

Set in `mobile/app.json`. Without it App Store Connect asks the export-compliance question on
**every single upload** and holds the build until it's answered.

`false` is the correct answer here: SAM uses only exempt cryptography — the OS's own TLS, and the
iOS keychain via `expo-secure-store`. It ships no encryption of its own.

## 6. "What does it do / how do we test it?"

Reviewers cannot test the app without a server, and an app that shows a connection screen and
nothing else reads as broken. Give them one in the review notes, or expect a rejection for
"incomplete functionality":

> SAM requires a companion server the user runs on their own computer (free, open source:
> https://github.com/richhabits/sam). Without it the app can only show its pairing screen.
> For review we can supply a temporary hosted instance and a pairing code — please request one
> and we will provide credentials valid for the review period.

Have that instance actually running before submitting.

## 7. The app icon — a judgement call, left to you

Not a rejection risk. It passes the hard checks: 1024×1024 generated, **no alpha channel** (an
icon with transparency is refused at upload, before review sees it). Two things are worth knowing
before you submit, because the icon is the first thing a reviewer and a customer see:

- **It isn't the SAM brandmark.** `public/icon.svg` — the flat terracotta rounded-square robot —
  is what the desktop app and the website use. The phone ships a different, AI-rendered character
  on a teal-grey background with the word "SAM" painted on it. Two different faces for one
  product.
- **It's upscaled.** The source (`mobile/assets/icon.png`) is 512×512 and Expo enlarges it to the
  1024 Apple requires, so the store listing shows a softened image.
- Apple's HIG also advises against words inside an icon; this one has them.

The fix is to render `public/icon.svg` at 1024 with the gradient full-bleed (no rounded corners
baked in — iOS applies its own mask, and baked corners leave transparency). I did not do it
unasked: an app icon is identity, not a defect.

## 8. Camera and photo library

Both described in `Info.plist`, both used only when the user attaches an image to a message, and
the image goes to the user's own server. No upload to us — because there is no us.

---

## Owner steps — none of this can be automated

1. ~~**Apple Distribution certificate.**~~ **DONE 2026-08-07.** Signing is fully in place:

   | thing | value |
   |---|---|
   | Team | `CC9Q9BH5NT` (Hectic Radio Ltd) |
   | Signing certificate | `D65YUFZXJN` — valid to **2027-08-05** |
   | Bundle ID (app) | `com.hectic.sam.mobile` → `6MZZZTG5XH` |
   | Bundle ID (widget) | `com.hectic.sam.mobile.widget` → `5FNX7BNXR3` |
   | Profile (app) | `SAM Mobile App Store` → `AMS8645UA4` |
   | Profile (widget) | `SAM Mobile Widget App Store` → `L4C4TW6R74` |

   ⚠️ **The keychain holds TWO certs named `iPhone Distribution: Hectic Radio Ltd`.** The one
   `security find-certificate -c` returns first **expired 2026-06-28 and has no private key**.
   Match by SHA1 against `security find-identity -v -p codesigning`
   (`BB18D7CF…`, serial `1F07DD5190…`) — the name alone will point you at the dead one and the
   build will fail for a reason that looks nothing like the cause.

   What is still **not** done: the **App Store Connect app record**. It cannot be created from the
   API — `POST /v1/apps` returns `403 The resource 'apps' does not allow 'CREATE'`. It must be
   made in the ASC web UI (Apps → ➕ → New App), bundle `com.hectic.sam.mobile`, SKU
   `sam-ios-001`. Nothing can be uploaded to TestFlight until that record exists.
2. **APNs key.** `mobile/lib/notify.ts` handles local notifications and is wired for remote push,
   but remote push is inert until an APNs key exists. Create one in the Apple Developer portal
   (Keys → Apple Push Notifications service), then wire it server-side.
3. **`ios.buildNumber`** is `1`. Increment it for every upload — App Store Connect rejects a
   duplicate build number even when the version string changes.

## 9. Building it locally — sign ad-hoc, do not disable signing

`CODE_SIGNING_ALLOWED=NO` builds and launches the app, but it is NOT a faithful test:

- **The widget extension will not launch.** The system starts extensions, and it refuses an
  unsigned `.appex` — the log says `launch failed` followed by
  `Watchdog provision violated for getPlaceholders`, which reads like a bug in the widget and
  is not one. Ad-hoc signing makes it launch cleanly; both messages disappear.
- **The keychain is unavailable**, so `expo-secure-store` throws
  `KeyChainException: A required entitlement isn't present` and nothing about pairing can be
  tested.

Use this instead:

```
xcodebuild -workspace SAM.xcworkspace -scheme SAM -configuration Release \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' \
  -derivedDataPath /tmp/sam-sign \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES
```

Release, not Debug — Debug expects Metro on :8081, Release embeds the bundle.

Ad-hoc still does NOT give you the keychain: `SAM.entitlements` carries only `aps-environment`,
and the keychain access group arrives with the `application-identifier` that a provisioning
profile injects. So the paired experience — chat, `@` references, a widget you can actually tap —
needs a real development team, which is the same blocker as TestFlight.
