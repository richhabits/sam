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

## 4. "What does it do / how do we test it?"

Reviewers cannot test the app without a server, and an app that shows a connection screen and
nothing else reads as broken. Give them one in the review notes, or expect a rejection for
"incomplete functionality":

> SAM requires a companion server the user runs on their own computer (free, open source:
> https://github.com/richhabits/sam). Without it the app can only show its pairing screen.
> For review we can supply a temporary hosted instance and a pairing code — please request one
> and we will provide credentials valid for the review period.

Have that instance actually running before submitting.

## 5. Camera and photo library

Both described in `Info.plist`, both used only when the user attaches an image to a message, and
the image goes to the user's own server. No upload to us — because there is no us.

---

## Owner steps — none of this can be automated

1. **Apple Distribution certificate.** This machine has only an *Apple Development* identity
   (`security find-identity -v -p codesigning`). TestFlight needs *Apple Distribution* plus a
   provisioning profile, or an EAS build that manages signing in the cloud.
2. **APNs key.** `mobile/lib/notify.ts` handles local notifications and is wired for remote push,
   but remote push is inert until an APNs key exists. Create one in the Apple Developer portal
   (Keys → Apple Push Notifications service), then wire it server-side.
3. **`ios.buildNumber`** is `1`. Increment it for every upload — App Store Connect rejects a
   duplicate build number even when the version string changes.
