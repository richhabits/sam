# The Pocket — TestFlight (not App Store submit)

Pocket (`com.hectic.sam.mobile`) is **on TestFlight**: public link
https://testflight.apple.com/join/htr4htvY. There is an App Store Connect record for metadata.
**Do not upload a new binary, spend EAS/Apple minutes, or Submit for Review** unless a local
Xcode archive already exists and the owner asks. Chat is the app; pairing is optional.

Paste §1 into **App Review Information → Notes** if you ever submit. Until then it is the
TestFlight testers' truth.

**Last local iOS build noted here: 1.0.0 (110).** Build 107 was rejected on 2026-08-28 under 2.1(a)
because reviewers could not find "Explore the demo". Demo remains in the ••• menu (and on Home).
First paint is **chat**, not a pairing wall.

**Build 110 also closes three things found in our own compliance audit (none were cited by Apple):**
1. **Guideline 5.1.2(i)** — in Standalone mode the app now names the third-party AI providers and asks permission *before the first message leaves the phone* ("Allow and send"); revocable in Settings → Privacy. Enforced in the chat transport (`lib/chat.ts`), covered by `lib/chat.gate.test.ts`.
2. **The demo chat was not actually offline.** `demoStream()` existed but nothing called it, so chat inside the demo fell through to real cloud providers. Now wired; test-covered. The claim "no network requests in the demo" is true from 110, and was not true of 107–109.
3. **Guideline 5.1.1(i)** — privacy policy is now linked inside the app (Settings → Privacy) as well as in App Store Connect, and the published policy now describes Standalone mode accurately.

---

## 1. The review note

SAM is a direct AI assistant. Pairing with a Mac/PC is optional.

Apple reviewers will not have a desktop node. **Chat works unpaired.** Demo Mode (••• menu) is the
zero-network path: every screen runs from a fixed local script.

Paste into **App Review Information → Notes**:

```
SAM is an AI assistant. Chat works on the phone with no Mac and no account (source-available: https://github.com/richhabits/sam — not MIT, not a paid SAM tier). Pairing with a Mac/PC is optional.

You do not need a Mac or an API key to review this app.

To review:
1. Launch the app. First screen is chat. Type a message, or skip.
2. Optional demo (zero network): top-right ••• → "Explore the demo". A banner marks it throughout. You can leave at any time.
3. Optional pairing: ••• → Connect to Mac / PC, or scan the QR SAM prints on the computer.

Direct AI & Custom Keys:
• Standalone chat uses free public lanes unless the tester adds their own key (Groq, Cerebras, Mistral, Gemini, Anthropic, etc.) in Settings → Cloud AI Engine. Anthropic and OpenAI are paid services and are used only with the tester's own key. SAM has no paid tier of its own.

No sign-in or account is required. We operate no session server that receives chats. Standalone messages go to the AI provider the user picked (named before the first send).

Permissions:
• Camera / Photos — only when attaching an image or scanning a local pairing QR code. Attached photos go to the model in use (on-device, the paired Mac, or a cloud model).
• Local network — only when pairing with a local desktop node.
Neither is requested during the demo.
Microphone is not used in this TestFlight (Pocket) binary — native Swift in apple/ does use dictation.
```

**Sign-in required: No.** Say so in App Review Information — do not leave a demo account blank without answering the question.

## 2. Verified in code (receipts)

| Requirement | State |
|---|---|
| App Transport Security | `NSAllowsArbitraryLoads: true` (required for Tailscale `100.x` — `NSAllowsLocalNetworking` alone is not enough); review justification in `docs/APP-REVIEW.md` |
| Usage strings | Camera, Photos, Local Network — all present and specific |
| Microphone | Not used, so no string needed and nothing can crash on a missing one |
| Privacy manifest | `NSPrivacyTracking: false`, no collected data types, reasons declared for FileTimestamp / UserDefaults / SystemBootTime |
| Export compliance | `ITSAppUsesNonExemptEncryption: false` — uploads will not stall on the encryption question |
| App icon | 1024×1024, **no alpha channel** (an alpha channel is an automatic rejection) |
| iPad | `supportsTablet: true` is honest — layout adapts via `layoutFor(width)`, including Slide Over and Split View |
| Haptics & Feel | Apple Taptic Engine and Android Haptics integrated for tactile clicks on chat, tabs, and actions |
| Tests | 284 mobile tests green; `appstore.test.ts` pins ATS, usage strings, privacy manifest and export compliance |

## 3. URLs

- **Privacy policy** (required): `https://richhabits.github.io/sam/privacy.html` — live, returns 200
- **Support URL** (required): `https://github.com/richhabits/sam/issues`
- **Marketing URL** (optional): `https://richhabits.github.io/sam/`

## 4. Screenshots

Captured under `mobile/screenshots/` from a **Debug** sim (Metro), standalone, **no demo banner**. Dark terracotta.

| Set | Size | Ready | Missing / wrong size |
|---|---|---|---|
| `iphone-6.9/` | **1320 × 2868** required | All seven files are 1320×2868 | Prefer `01-agent.png` in the first slot (chat is first paint). |
| `ipad-13/` | **2064 × 2752** | **Complete:** home, pairing, agent, tasks, settings, vault. All dark terracotta. | — |

Clock is live, not 9:41. Apple does not require a fake clock.

## 5. Draft metadata

**Subtitle (30 char max):** `Autonomous AI & Desktop Remote`

**Promotional text (170):**
```
Direct AI chat in your pocket on free lanes you choose — optional pairing to your Mac/PC for files and yard tasks. No SAM account. Native 2.0.0 is on the App Store; this React Native Pocket file is the old 1.0.0 train.
```

**Description:**
```
SAM is a private AI assistant in your hand.

Chat works on its own on 5G or Wi-Fi. Pair with your Mac/PC when you want local files, automation, and background yard tasks.

• Works on its own: chat using free public AI lanes, or add your own key for providers (Groq, Cerebras, Mistral, Gemini, DeepSeek, and more). Anthropic and OpenAI are paid services and are used only with your own key. SAM has no paid plan.
• No SAM account and no sign-in
• Optional desktop link: monitor background builds and yard workers on your own computer
• Native haptics on supported iPhones
• Attach photos from camera or library into the conversation (they go to the model you picked)
• No tracking. We operate no middleman session server. Cloud providers see a prompt only when you send one to them.

Source-available (not MIT): github.com/richhabits/sam
Native 2.0.0 is the App Store listing. This React Native Pocket draft is the old 1.0.0 train.
```

**Keywords (100 char, comma-separated, no spaces):**
```
assistant,ai,private,chat,llm,groq,gemini,local,remote,tasks,productivity,testflight
```

## 6. Decisions only you can make

- **Age rating questionnaire.** Apple now asks specifically about chatbot / AI-generated content.
  SAM shows whatever the user's own machine returns, which is not moderated by us. Answer it
  honestly rather than reaching for 4+; a wrong answer here is a removal risk later, not just a
  rejection.
- **Category.** Productivity is the natural fit; Utilities is defensible.
- **Price.** Free.
- **Availability.** All territories unless you want otherwise.

## 7. The click-path (owner only — native `apple/`, not this RN app)

Do **not** Submit for Review from this React Native tree. The live store binary is native 2.0.0
from `apple/`. If the owner later submits a **local** native archive:

1. App Store Connect → SAM → iOS App → the version page
2. Fill: description, keywords, subtitle, promotional text, support and privacy URLs (§3, §5)
3. Upload screenshots (§4) if they drifted
4. **Build** → select the local archive's build — never EAS cloud
5. App Review Information → paste the notes from §1, set "Sign-in required" to **No**
6. Age rating questionnaire (§6)
7. **Add for Review** → Submit — owner only

---

*Kept in the repo rather than a chat message so the next submission starts from what was actually
true at this one. If `mobile/` changes after this, the build number must go up — Xcode owns the
build number on the Organizer path, not `app.json` (see `mobile/AGENTS.md`).*
