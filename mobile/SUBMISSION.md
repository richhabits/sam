# The Pocket — App Store submission

Everything that can be settled in code is settled and verified below. What remains is the part
that only exists inside App Store Connect: metadata, screenshots, and pressing Submit.

**Build to submit: 1.0.0 (7)**, already uploaded and processed. No new build is needed — the only
change to `mobile/` since then deleted `devicePushToken()`, a function with no caller anywhere,
ever. Runtime behaviour is identical.

---

## 1. The review note that decides this submission

The Pocket is a client for a SAM running on the reviewer's own Mac, which they will not have. An
app that cannot be used until you install a second app on another machine looks, from the outside,
exactly like an app that does not work — and that is Guideline 2.1, App Completeness, the single
most likely rejection here.

The pairing screen answers this directly: under **"No SAM yet?"** there is **"Explore the demo"**,
which runs every screen from a fixed script, touches no network, and never writes the real token.
The reviewer must be told it is there.

Paste into **App Review Information → Notes**:

```
SAM is a companion app for SAM on macOS (free, open source: https://github.com/richhabits/sam).
It pairs with the user's own computer over their local network. Nothing is sent to any server we
operate — there is no account, no sign-in, and no backend.

You do not need a Mac to review this app.

On the first screen, under "No SAM yet?", tap "Explore the demo". Every screen then runs from a
fixed local script: chat, tasks, attachments and settings. A banner marks it as a demo throughout
and you can leave at any time. No network requests are made in this mode.

Permissions, and when they are asked for:
• Local network — only when pairing with the user's own computer.
• Camera / Photos — only when attaching an image to a message.
Neither is requested during the demo.
```

**Sign-in required: No.** Say so in App Review Information — do not leave a demo account blank
without answering the question, which itself causes a round trip.

## 2. Verified in code (receipts)

| Requirement | State |
|---|---|
| App Transport Security | `NSAllowsLocalNetworking` only — no blanket `NSAllowsArbitraryLoads` |
| Usage strings | Camera, Photos, Local Network — all present and specific |
| Microphone | Not used anywhere, so no string needed and nothing can crash on a missing one |
| Privacy manifest | `NSPrivacyTracking: false`, no collected data types, reasons declared for FileTimestamp / UserDefaults / SystemBootTime |
| Export compliance | `ITSAppUsesNonExemptEncryption: false` — uploads will not stall on the encryption question |
| App icon | 1024×1024, **no alpha channel** (an alpha channel is an automatic rejection) |
| iPad | `supportsTablet: true` is honest — layout adapts via `layoutFor(width)`, including Slide Over and Split View |
| Tests | 263 mobile tests green; `appstore.test.ts` pins ATS, the usage strings, the privacy manifest and export compliance so none of the above can silently regress |

## 3. URLs

- **Privacy policy** (required): `https://richhabits.github.io/sam/privacy.html` — live, returns 200
- **Support URL** (required): `https://github.com/richhabits/sam/issues`
- **Marketing URL** (optional): `https://richhabits.github.io/sam/`

## 4. Screenshots

Captured and committed under `mobile/screenshots/`, at exactly the sizes App Store Connect wants.
Because `supportsTablet` is true, **both** sets are required, and both are here:

| Set | Size | Shots |
|---|---|---|
| `screenshots/iphone-6.9/` | 1320 × 2868 | agent, tasks, chat, settings |
| `screenshots/ipad-13/` | 2064 × 2752 | pairing, agent, tasks, settings |

Taken from a Release build on iPhone 17 Pro Max and iPad Pro 13-inch simulators, which Apple
accepts. The iPhone set carries a clean 9:41 status bar; the iPad status-bar override did not take,
so those show the real clock — cosmetic, and not something Apple requires.

**Read this before uploading them.** Every shot is in demo mode, so all of them carry the orange
`Demo · sample data, not connected to a SAM` banner, and `iphone-6.9/03-chat.png` shows a reply
that opens *"This is a demo, so I'm answering from a short script rather than a model."* That is
exactly right for a reviewer and weak as a store listing — the first thing a browsing customer
reads should not be that the app is a script.

Two honest options:
1. **Ship these.** Accurate, no personal data, zero risk of leaking anything. The banner is odd
   marketing but nobody is misled.
2. **Recapture while paired** to the SAM on your Mac, which removes the banner and shows real
   answers. Better looking, but every screenshot then contains whatever is genuinely on your
   machine, so it needs a careful read before upload.

Worth doing option 2 for the chat shot at least, and keeping these as the fallback.

## 5. Draft metadata

**Subtitle (30 char max):** `Your own AI, on your Mac`

**Promotional text (170):**
```
Talk to the SAM running on your own computer — from anywhere in the house. No account, no cloud,
nothing sent to us.
```

**Description:**
```
SAM is a private assistant that runs on your own computer. This app is its remote control.

Pair once with the SAM on your Mac and you can talk to it from the sofa, check what it is working
on, hand it a photo, or add to your tasks — while everything stays on your own machine.

• No account and no sign-in
• Nothing is sent to any server we run — the app talks to your computer, usually over your own
  home network
• See what SAM is working on, and what it has finished
• Attach a photo from your camera or library, straight into a message
• Leaves nothing behind: "Forget this device" revokes the session on your Mac, not just on
  the phone

No Mac yet? Open the demo on the first screen and look around before you install anything.

SAM is free and open source: github.com/richhabits/sam
```

**Keywords (100 char, comma-separated, no spaces):**
```
assistant,ai,private,local,remote,companion,mac,productivity,tasks,chat,selfhosted,offline
```

## 6. Decisions only you can make

- **Age rating questionnaire.** Apple now asks specifically about chatbot / AI-generated content.
  SAM shows whatever the user's own machine returns, which is not moderated by us. Answer it
  honestly rather than reaching for 4+; a wrong answer here is a removal risk later, not just a
  rejection.
- **Category.** Productivity is the natural fit; Utilities is defensible.
- **Price.** Free.
- **Availability.** All territories unless you want otherwise.

## 7. The click-path

1. App Store Connect → SAM → iOS App → the **1.0.0** version page
2. Fill: description, keywords, subtitle, promotional text, support and privacy URLs (§3, §5)
3. Upload screenshots (§4)
4. **Build** → select **1.0.0 (7)**
5. App Review Information → paste the notes from §1, set "Sign-in required" to **No**
6. Age rating questionnaire (§6)
7. **Add for Review** → Submit

---

*Kept in the repo rather than a chat message so the next submission starts from what was actually
true at this one. If `mobile/` changes after this, the build number must go up — Xcode owns the
build number on the Organizer path, not `app.json` (see `mobile/AGENTS.md`).*
