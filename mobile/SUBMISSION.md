# The Pocket — App Store submission

Everything that can be settled in code is settled and verified below. What remains is the part
that only exists inside App Store Connect: metadata, screenshots, and pressing Submit.

**Build to submit: 1.0.0 (7)**, already uploaded and processed. No new build is needed — the only
change to `mobile/` since then deleted `devicePushToken()`, a function with no caller anywhere,
ever. Runtime behaviour is identical.

---

## 1. The review note that decides this submission

SAM functions both as a direct AI assistant and as a companion for SAM running on a user's own Mac/PC.

Because Apple App Store reviewers test in isolated network environments and will not have a running desktop node or custom API keys, **Demo Mode** is the primary, deterministic path provided specifically for App Review. Under the top menu (•••) → Connect to Mac/PC → **"Explore the demo"**, every screen runs from a fixed local script with zero network dependencies.

Paste into **App Review Information → Notes**:

```
SAM is an AI assistant with optional local desktop pairing (free, open source: https://github.com/richhabits/sam).

You do not need a Mac or an API key to review this app.

To review the full app deterministically:
1. On launch, tap the top-right menu (•••) → "Connect to Mac / PC".
2. Under "No SAM yet?", tap "Explore the demo".
3. Every screen (Agent chat, Tasks list, Attachments, and Settings) runs from a fixed local script. A banner marks it as a demo throughout and you can exit at any time. No network requests are made in this mode.

Direct AI & Custom Keys:
• The app also supports direct cloud brains and 30+ custom provider keys (Groq, Cerebras, Mistral, Gemini, Anthropic, etc.) in Settings → Cloud AI Engine.

No sign-in or account is required. No telemetry or user prompts pass through any intermediate proxy server we operate.

Permissions:
• Camera / Photos — only when attaching an image or scanning a local pairing QR code.
• Local network — only when pairing with a local desktop node.
Neither is requested during the demo.
```

**Sign-in required: No.** Say so in App Review Information — do not leave a demo account blank without answering the question.

## 2. Verified in code (receipts)

| Requirement | State |
|---|---|
| App Transport Security | `NSAllowsLocalNetworking` only — no blanket `NSAllowsArbitraryLoads` |
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

Captured and committed under `mobile/screenshots/`, at exactly the sizes App Store Connect wants.
Because `supportsTablet` is true, **both** sets are required:

| Set | Size | Shots |
|---|---|---|
| `screenshots/iphone-6.9/` | 1320 × 2868 | agent, tasks, chat, settings |
| `screenshots/ipad-13/` | 2064 × 2752 | pairing, agent, tasks, settings |

Taken from a Release build on iPhone 17 Pro Max and iPad Pro 13-inch simulators, which Apple
accepts. The iPhone set carries a clean 9:41 status bar; the iPad status-bar override did not take,
so those show the real clock — cosmetic, and not something Apple requires.

**Note on current screenshots:** Every shot currently in `mobile/screenshots/` was captured in demo mode and carries the orange `Demo · sample data, not connected to a SAM` banner.

Two honest options:
1. **Ship these.** Accurate, no personal data, zero risk of leaking anything. The banner is odd marketing but nobody is misled.
2. **Recapture while paired or in standalone chat** with SAM, which removes the demo banner and shows live chat responses.

Worth keeping option 1 as the safe baseline and doing option 2 before public marketing push.

## 5. Draft metadata

**Subtitle (30 char max):** `Autonomous AI & Desktop Remote`

**Promotional text (170):**
```
Direct AI chat in your pocket, powered by 30+ cloud brains — with seamless local pairing to your Mac/PC for computer control and background tasks. No sign-in required.
```

**Description:**
```
SAM is an elite, private AI assistant in your hand.

Use SAM standalone on 5G or Wi-Fi with direct cloud intelligence, or pair with your Mac/PC to unlock local files, automation, and background yard tasks.

• 100% Standalone AI Engine: Instant chat with 30+ supported providers (Groq, Cerebras, Mistral, Gemini, Anthropic, DeepSeek, and more)
• Zero-config out-of-the-box experience — no account and no sign-in required
• 1-Tap Desktop Link: Monitor background builds, automated playbooks, and yard workers on your own computer
• Native Haptics: Full tactile feedback with Apple Taptic Engine
• 1-Tap Code Inspector: Copy clean formatted code snippets and view language syntax
• Multimodal: Attach photos from camera or library straight into conversation
• Complete Privacy: No tracking, no middleman proxy servers, encrypted Keychain storage

SAM is free and open source: github.com/richhabits/sam
```

**Keywords (100 char, comma-separated, no spaces):**
```
assistant,ai,private,chat,llm,groq,claude,gemini,local,remote,tasks,productivity,open-source,offline
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
