# SAM for Apple platforms

Native SwiftUI SAM for iPhone, iPad, Mac, Apple Watch and Apple Vision Pro. It is the face of
the SAM brain (the TypeScript server in `server/`, port 8787). The brain keeps doing the heavy
work (tools, model router, memory, the yard); this app does everything a device is best at.

Pocket on TestFlight today is the React Native app in `mobile/` (bundle `com.hectic.sam.mobile`).
This native tree uses the same bundle id so it can ship as an update later — it has not been
App Store submitted. Do not treat TestFlight as this Swift binary until a local archive of
*this* project is uploaded. There is no tvOS target.

The brain stays cross-platform. Android keeps `mobile/`, Windows and Linux keep the Electron
app, and every client speaks the same contract:
[`docs/CLIENT-PROTOCOL.md`](../docs/CLIENT-PROTOCOL.md).

## Build

```sh
cd apple
./generate.sh                        # xcodegen → SAM.xcodeproj (widget embed made iOS-only)
open SAM.xcodeproj                   # or build from the command line:
xcodebuild -project SAM.xcodeproj -scheme SAM -destination 'generic/platform=macOS' build
swift test --package-path Packages/SAMKit                 # 11 unit tests
SAM_LIVE=1 swift test --package-path Packages/SAMKit      # + live test against the brain on this Mac
swift Tools/make-icons.swift         # regenerate icons from mobile/assets/icon.png
```

Team `CC9Q9BH5NT`, bundle `com.hectic.sam.mobile` (same as Pocket / TestFlight), app group
`group.com.hectic.sam.mobile`. Export compliance: `ITSAppUsesNonExemptEncryption` is `false`
(OS TLS and Keychain only — no custom crypto).

Headless self-test on a simulator (no taps; DEBUG builds only):

```sh
xcrun simctl launch --stdout=out.txt <udid> com.hectic.sam.mobile \
  -samPairLink "sam://pair?code=<code>&host=http%3A%2F%2F127.0.0.1%3A8787" -samSelfTest "Reply with ready."
grep SAMTEST out.txt    # pair / chat / yard / widget-snapshot → PASS
```

Mint the code on the Mac with `curl -X POST localhost:8787/api/pair/new`.

## Layout

| Path | What |
|---|---|
| `Packages/SAMKit` | Brain client (URLSession, SSE), pairing links, Keychain, models, widget snapshot. No UI; shared by app, widgets, Watch. |
| `App/Services` | `AppModel` (state, chat, pairing), `OnDeviceBrain` (Foundation Models), device services (Speech, voices, haptics, Spotlight, Face ID lock), SwiftData store. |
| `App/Views` | Chat, Yard, Crew, Tools, Settings, Pairing (VisionKit QR). |
| `App/Intents` | App Intents + App Shortcuts: Siri, Spotlight, Action button, Shortcuts. |
| `Widgets` | Yard widget (Home Screen, Lock Screen, StandBy, Mac desktop) and the Ask SAM control (Control Center on iPhone and Mac). |
| `Safari` | Safari Web Extension (iOS, iPadOS, macOS): the popup plus a native handler that holds the session. |
| `Share` | Share extension (iOS, iPadOS, macOS): text, links, photos (Vision OCR) and PDFs (PDFKit) into SAM. |
| `App/Views/AddOnsView.swift` | Add-ons: connect FLIP IT and business tools over MCP (Mac), then restart the brain to load them. |

## What's in (phase 1, 2026-09-30)

- **Chat** streamed from the Mac, markdown, approvals for risky tools (`/api/confirm`), history in SwiftData.
- **Offline**: when the Mac can't be reached, Apple Intelligence answers on-device. Nothing leaves the device, so there is no third-party data sharing to consent to.
- **Voice**: dictation with the Speech framework (on-device when supported), replies read aloud with the best installed voice.
- **Vision**: pick a photo and Vision OCR reads its text into the composer, on-device.
- **Pairing**: scan the Mac's QR (VisionKit), tap a `sam://pair` link, or type the code. On the Mac itself it pairs silently over loopback.
- **Security**: session token in the Keychain (this device only, never synced); optional Face ID / Touch ID / Optic ID lock; http only to the paired SAM.
- **System**: Siri and Shortcuts, Spotlight, Handoff, widgets, Control Center control, Mac menu-bar quick ask, Liquid Glass throughout, SF Symbols animations, haptics, Dynamic Type.
- **Yard**: live counts, job detail, cancel and retry.
- **Safari extension**: summarise, key points, explain or ask about the page (iPhone, iPad, Mac).
- **Share extension**: send text, links, photos and PDFs to SAM from any app. Links are your own request, so SAM may open them with its tools; everything else goes untrusted.
- **Add-ons**: FLIP IT (read-only) and business tools, connected on the Mac, applied with one restart.

## Roadmap

**Phase 2: the rest of the device**
- Live Activity + Dynamic Island for running yard jobs; push from the brain via APNs.
- Apple Watch: ask by voice, yard complication, approve risky tools from the wrist.
- Camera: point at something and ask (AVFoundation + Vision), document scanning (VisionKit).
- Screen context on Mac (ScreenCaptureKit, on request only).
- Writing Tools / Services integration; Focus filters; notifications with actions.

**Phase 3: security, enterprise-grade**
- Pairing key in the Secure Enclave and signed requests (CryptoKit) instead of a bearer token alone.
- TLS to the brain with a pinned self-signed cert (no more plain http on the LAN).
- App Attest so only the genuine app can pair.
- Bonjour discovery (`_sam._tcp`) so nobody types IP addresses.
- CloudKit sync of conversations (end-to-end encrypted fields).

**Phase 4: add-ons** (screen done; next: more of our own apps as add-ons, and connecting from iPhone once secure phone access exists). FLIP IT is its own app; see `docs/decisions/0001-flipit-is-an-add-on.md`.

**Phone access (needs a decision)**: remote/LAN mode is off (2026-09-30), so iPhone and iPad reach SAM only through a future secure transport (Bonjour + pinned TLS, Phase 3) or the Tailscale mesh mode. Until then they answer on-device with Apple Intelligence.

**Release**
- Pocket stays TestFlight until a local archive of this native app exists and the owner submits.
  Do not App Store submit from EAS or a cloud agent.
- Mac desktop brain keeps shipping as the signed + notarized Developer ID Electron build
  (arm64 3.7.0). Not a Mac App Store client. Local notarize only — no paid cloud notarize.
