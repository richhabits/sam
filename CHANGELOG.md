# Changelog

All notable changes to SAM. Newest first.

## Unreleased
- **🪽 Hermes leads the agent + more integrations + 📢 post-everywhere** — (1) SAM's tool-PLANNING (deciding
  the next action) now routes to the deep lane where Hermes fronts — elite agentic reasoning — while still
  falling through every free brain so it never goes dark. (2) MCP Integrations grew to 16 presets: added
  Shopify, Google Ads, Google Analytics, Mailchimp, Airtable, Linear. (3) New post_everywhere tool: one
  command posts to all connected channels (Discord + Slack directly; X/IG/FB/LinkedIn via Metricool),
  ask-first.
- **🪃 Roo-style swarm orchestration** — SAM's multi-agent team gained two upgrades from Roo Code's
  Orchestrator/Boomerang: (1) **specialist "modes" with scoped tools** — a researcher/writer now gets a
  focused read/research/write kit, not the run-shell/delete/send kit (builders & operators keep the full
  toolset; ask-first still backstops safety); (2) **verify-and-re-delegate** — after the crew runs, the
  orchestrator reviews the combined work against the request and, if it finds real gaps or errors,
  delegates up to 2 follow-up subtasks to close them (one bounded round) before synthesising. SAM already
  had dependency-graph parallel execution + output hand-off, so it now matches Roo AND runs subtasks in
  parallel.
- **📓 Notebook panel — NotebookLM, built into the HUD** — Settings → 📓 Notebooks (or the command palette):
  a real workspace. Left: your notebooks + sources (add a web link or paste text, one tap). Right: a
  grounded chat that answers ONLY from those sources with citations (no hallucination), plus a 🎙️ Audio
  Overview button that produces a two-host podcast of your material you can play aloud. Backed by local
  embeddings (free, private) + REST endpoints. Makes the research/notebook engine usable by anyone, no
  commands needed. Hand-built in SAM's existing design.
- **🔌 Integrations panel — SAM as a business command center** — Settings → Integrations: one-tap connect
  to popular MCP servers with just your key(s): 💳 Stripe, 📈 RevenueCat (revenue/MRR), 📊 Metricool
  (schedule & post to ALL your socials in one shot), 📣 Meta Ads, 📝 Notion, 🐘 Supabase, 🐙 GitHub, 💬 Slack,
  🦁 Brave Search. SAM gains their tools (always ask-first). Keys are loopback-only, written to local
  vault/mcp.json, never returned by the API. Officialvs-community clearly labelled. Also shipped this
  session: 🟣 Obsidian bridge (SAM reads & writes your vault).
- **📓 NotebookLM, but yours & free + 🔎 deep research + 🛰️ 24/7 research agent + 🪽 Hermes** — SAM is now
  a grounded-intelligence platform. New `notebook_add` (sources: web pages, files, pasted text),
  `notebook_ask` (answers ONLY from your sources, every claim cited — no hallucination), `notebook_audio`
  (two-host podcast "Audio Overview" of your material), `notebook_list`. New `research` tool: searches
  the live web, reads the top sources, returns a cited briefing, and files it into a notebook for
  follow-ups. New `research_watch`: a 24/7 agent that keeps researching a topic on a schedule, files new
  findings, and pings you what changed. All chunked + embedded LOCALLY (free, private). Powered by
  **Hermes** (Nous) — reached with no new signup: Nous key → OpenRouter (300-model gateway) → local Ollama;
  it fronts the deep + code reasoning lanes.
- **🛡️ XSS closed + hardened HTTP headers** — found & fixed a real cross-site-scripting hole: the reply
  renderer escaped <>& but NOT quotes, so a crafted image/link URL (echoable from a malicious web page
  via web_fetch) could break out of src="…" and inject an onerror handler → JS with full local-API
  access. Now all five HTML chars are escaped (regression-tested). Added a strict CSP (script-src self,
  frame-ancestors none), X-Frame-Options: DENY, nosniff, and no-referrer to the served HUD; verified the
  app still loads clean under it. Confirmed the remote cookie is HttpOnly+SameSite=Lax.
- **🛡️ Security hardening pass (attack-surface audit)** — closed the surfaces we had NOT audited:
  (1) anti-DNS-rebinding Host-header check — a malicious webpage re-pointing its domain at 127.0.0.1
  is now rejected 403 (phone/LAN access preserved); (2) global crash handlers so one bad async never
  takes SAM down; (3) the GitHub auto-fix agent is now identity-gated (owner/member/collaborator only)
  so a stranger can not drive the code-writing agent via an @claude comment. Verified clean: ReDoS
  (50KB input <2ms), licenses (no copyleft — jszip is MIT-or-GPL, we take MIT), Electron isolation
  (nodeIntegration off, contextIsolation on), esbuild postinstall (legit). Documented the honest
  residuals in SECURITY.md: data-at-rest not encrypted, web_fetch exfil (send-channels are ask-first),
  shared-token trust model.
- **🔋 Zero-consumption by default — embeddings now LOCAL-FIRST** — embeddings fire on EVERY message
  (recall query) + every memory write. The fallback order was cloud-first (Jina→Gemini→Ollama), so
  anyone with a Gemini key (needed for vision) silently burned embedding quota on every single message.
  Now it is local-first (Ollama nomic → Jina → Gemini): free, private, nothing leaves the machine unless
  you have no local model. Verified no telemetry / analytics / phone-home anywhere; the daily brief uses
  the FREE tier only (never paid) and fires at most once/day.
- **🔒 Privacy & security audit — 10/10 hardening** — (1) Elon Mode (the total safety-bypass) is now
  LOOPBACK-ONLY: it can never be enabled from a phone/remote device, only by the owner at the machine.
  (2) view_photo (auto-runs) now refuses non-image files and blocks sensitive/hidden dirs (.ssh, .env,
  /etc, Keychains…) — prompt injection can no longer make SAM read arbitrary files. (3) reusable
  isLoopback() socket-based guard (not header-spoofable). Verified: 0 secrets/personal data in tree or
  history, vault fully gitignored, .env owner-only, no key ever logged (phone URL prints YOUR_TOKEN
  placeholder), all remote routes token-gated, 0 npm-audit/CodeQL, 0 dead code.
- **🔒 Multi-user privacy hardened** — the owner (first-ever named user) is now persisted to disk, and ONLY the owner ever inherits/sees the pre-multi-user memories. A family member connecting to a shared SAM first after an update can never adopt the owner history — everyone else starts genuinely clean & private.
- **👥 Multi-user / Family SAM** — several people can share one SAM, each with their OWN private
  memory. Memory is namespaced by the person's name (already sent with every request), with a one-time
  'adopt' so the original owner keeps all their history and everyone added later starts fresh & private.
  Settings → 👥 Who's using SAM: switch between saved people instantly (no re-onboarding) or add someone
  new. Each person's SAM learns only about them. (Your-own-devices and give-it-out already worked; this
  adds true per-person separation on a shared SAM.)
- **🔔 Push notifications — SAM reaches your phone even when closed** — direct Web Push (VAPID, no third
  party, keys generated once & kept local): the morning brief, reminders, and scheduled-task results
  land as notifications on any device that opted in (Settings → 📱 → *Get alerts here*). Service worker
  (public/sw.js) also makes the installed PWA load instantly offline. Fast + free: no push service fees,
  no cloud relay — SAM pushes straight to the device.
- **📱 Phone, made smart** — ⚙ Settings → *Use SAM on your phone*: one click generates a private token
  and shows a **QR you scan with your phone camera** → lands in SAM already signed in (no typing tokens).
  Add-to-Home-Screen installs it as an app (camera/voice/everything). The HUD got a real **mobile layout**
  (thumb-size targets, 16px inputs to stop iOS zoom, safe-area insets, full-screen sheets, standalone PWA
  mode). README documents the free **Tailscale** path for encrypted access from *anywhere*, no cloud.
- **📷 Camera — accessibility + find-my-thing** — 🔈 *Read this aloud* (camera → text → spoken, for menus/
  mail/labels), 🔎 *Find my…* (name an object, sweep the camera, SAM guides you warmer/colder and shouts
  'Found it — on the left!' with voice). Plus on-device face-descriptor storage is ready server-side
  (128-float vectors, /api/faces) — images never leave the machine — while today's free vision-based
  recognition keeps doing the greeting.
- **📷 Camera scaled further** — 🔳 QR/barcode scan (native BarcodeDetector, instant; vision fallback),
  ⏱️ Timelapse watch (snaps every 30s, only pings when the scene NOTABLY changes — deliveries, arrivals),
  📸 photo roll SAM can browse + reason over (list_photos / view_photo tools — 'where did I leave my keys?'
  over past snapshots), and a 2nd FREE vision lane (Groq llama-4-scout) so photo-reading works without a
  Gemini key. All local-first.
- **📷 Camera, seriously upgraded** — 🙋 *Who's this?* (recognises known people or asks their name and
  remembers them — plus a Guardian "remember them" banner when it spots someone new), 📸 *Take a photo*
  (full-res → vault/photos, local-only, gitignored), 📄 *Scan text* (camera as document/receipt scanner),
  all one tap from the ＋ menu. Privacy-first: people are remembered as text descriptions, not biometrics.
- **🏇 HappyHorse + 🧠 GLM-5.2 — the new flagships, wired in** — video now leads with **HappyHorse 1.1**
  (Alibaba's #1-arena model, native audio/lip-sync) via fal.ai (official API, free signup credits); chat's
  deep/code lanes now default Zhipu to **GLM-5.2** (1M context, MIT, 20M free tokens on signup).
- **🍎 Signed releases + TRUE silent auto-update (owner opt-in)** — paste your Apple developer
  details in Settings → 🍎 Signed releases (or .env), create a Developer ID cert in Xcode once,
  then `npm run release:app` builds a signed + notarized Mac app and uploads it with update
  manifests — installed SAMs then **update themselves silently** (electron-updater + GitHub
  releases; unsigned builds gracefully fall back to the update-notifier — Windows NSIS
  auto-updates even unsigned). Settings shows the config; the app-specific password is
  write-only, never returned.
- **🎨 FREE image generation** — "draw me a…" just works: rotating free lanes (Pollinations first —
  no key, effectively unlimited — then Together FLUX/SiliconFlow on free keys, credits sipped evenly).
  Images render inline in the chat (markdown `![img]` support added to the HUD).
- **🔊 Voice OUT OF THE BOX** — /api/speak is now a rotating free-first chain: ElevenLabs (premium,
  if key) → Groq TTS (free key) → **Pollinations voice (FREE, NO key)** → browser voice. A fresh
  download talks with zero setup.
- **🎧 Audio in — transcribe_audio** — voice memos / recordings / podcast clips → text, free via
  Groq Whisper (whisper-large-v3, 24MB cap).
- **🎬 Video generation (free credits)** — `generate_video` uses Novita or SiliconFlow free signup
  credits (rotating), with honest guidance when no key is set. No truly-unlimited free video API
  exists yet — this is the closest legit thing.
- **📱 Phone access (opt-in)** — `SAM_REMOTE=1` + `SAM_REMOTE_TOKEN` opens SAM to your Wi-Fi with a
  token gate on every request (constant-time compare, brute-force backstop, cookie after first visit;
  loopback unaffected). SAM prints the exact phone URL at boot. Off by default.
- **🔌 MCP support — SAM plugs into the Model Context Protocol ecosystem** — drop servers into
  `vault/mcp.json` (see `vault/mcp.sample.json`) and thousands of community MCP tools (Gmail, Notion,
  Postgres, browsers…) appear as SAM tools (`mcp_<server>_<tool>`), always ask-first, included in the
  semantic tool router. 148 built-in tools → effectively unlimited.
- **🧭 Brains organised by what they do** — every provider in Settings now says its role (⚡ fast chat,
  🧠 reasoning, 💻 code, 👁 vision, 🎨 images, 🎬 video, 🌐 many-models, 👑 premium) so you know exactly
  why you're adding each key.
- **Task-aware model routing — uses the RIGHT free brain for the job** — with 30+ free models, SAM
  no longer sends every request to the same fastest-first provider. It picks a *lane* from the ask:
  **fast** (Cerebras/Groq/SambaNova) for quick chat, **deep** (DeepSeek/NVIDIA/Together/Qwen…) for
  reasoning/analysis/long prompts, **code** (DeepSeek/Fireworks/Together…) for programming — trying the
  best-fit model FIRST while still falling through all 30 on failure, so nothing's wasted. `pickLane()`
  in `server/models.ts` (5 tests). The provider label in each reply shows which model answered.
- **Brain warmed at boot** — SAM pre-loads the local Ollama model into RAM at startup (keep-alive 30m)
  so the FIRST message is instant instead of paying a multi-second cold model-load. Local-only, never a
  cloud call (zero quota). Only warms a model that's actually pulled.
- **Repo slimmed 16× — cheaper clones & CI forever** — purged the old `creative-space/` app
  (18 MB of dead binary blobs — demo.mp4, webp assets — deleted from the tree long ago but still
  dragged along in git history) from ALL history. `.git` **18 MB → 1.1 MB**; a fresh clone is now
  ~844 KB, so every `git clone` and CI checkout downloads ~16× less data. Also stopped `og.png`
  (a 364 KB image) from being regenerated on every `ship` — that quietly added a new blob each time;
  it's `npm run og` on demand now. (History was rewritten + force-pushed; safe — 0 forks/stars.)
- **Faster — per-request quick wins** — three hot-path allocations removed from the code that runs on
  *every* message: `people.json` is now mtime-cached (was a disk read + JSON.parse per request),
  `projectsContext()` is memoised (constant string, was rebuilt each turn), and `recentExchanges()`
  slices to the last N blocks *before* regex-parsing (was parsing the whole day's log every request —
  got slower as the day grew). Pure wins, no behaviour change; 92 tests still green.
- **Every device, first-class** — cross-platform audit: Windows gets a one-command
  `setup.ps1` + double-click `START-SAM.bat` (Mac's `START-SAM.command` now works from any
  folder); Mac-only tools now degrade gracefully everywhere (the model is told "this needs
  macOS — this machine runs windows/linux" instead of a cryptic failure, so SAM answers
  honestly and offers what it CAN do); README documents the Windows path. Verified already
  cross-platform: server + HUD (PWA-installable: manifest/icons/viewport), notifications
  (osascript/PowerShell/notify-send via execFile), iOS drop folder (iCloud on Mac/Windows),
  electron builds (`build:mac/:win/:linux`), Node 20.19+/22.12+.
- **OG share image** — `npm run og` renders `docs/og.png` (1200×630 @2x) from the live
  counts via your installed Chrome; wired into `ship.mjs`; og:/twitter: meta added — links
  shared on X/WhatsApp/Discord/LinkedIn now show a proper card.
- **Report-a-problem → agent fixes it → auto-ships** — a new `Claude Agent` workflow: label a bug
  `agent-fix` (or comment `@claude …`) and Claude reads the report, finds the cause, runs `npm run verify`,
  and opens a **PR** with the fix. CI gates it, a human merges, and the site/build auto-update on merge —
  instant agent, human keeps the merge button (needs `ANTHROPIC_API_KEY` + the Claude GitHub App). Plus:
  a structured 🐛 bug-report form, PR template, issue-template config (Discussions + private security link),
  and a one-shot `npm run verify` (typecheck + tests + build). GitHub description corrected to the real
  counts (148 tools / 78 agents / 30+ brains — was "63 tools / 6 brains").
- **Landing: categorised, live, honest** — the "everything it does" grid now groups all 148 tools into 15
  labelled categories (Web, Files, Code, Vision, Control-your-Mac, Memory…), auto-generated from the source
  on every push (`pages.yml`), so it's always accurate with zero upkeep. Removed the last overclaims
  ("no data leaving your laptop" / "100% on your machine" / "conversations never leave") — now the honest
  privacy story (keys/memory/files stay local; only the prompt you send goes to the brain you pick; nothing
  in Ollama mode).
- **Security audit — closed an Autopilot RCE path** — `applescript` (and `type_text`/`press_key`/`click`)
  were missing from the always-ask list, so with Autopilot on the model could run **arbitrary AppleScript
  → `do shell script` → shell** with no approval and no catastrophic-command guard (reachable via prompt
  injection). Fixed: those + destructive file/disk ops are now always-ask (only Elon Mode bypasses); the
  AppleScript path runs through the catastrophic guard; P2P turns get **safe tools only**. Also patched
  AppleScript/PowerShell injection in `add_calendar_event`, `app_switcher`, `press_key`, `click`, `type_text`
  (escape strings, `Number()`-coerce coords/keycodes, Windows paths via `execFile` not the shell), and a
  scheduler `every 0m` busy-loop.
- **Truth sweep** — `.env.example`/landing/SECURITY.md corrected (free = rotating *cloud* tiers by default,
  Ollama is the offline fallback — not "100% local / no cloud / nothing uploaded"); consistent `defaultTier`
  fallback; accurate Node version (20.19+/22.12+); removed personal names/drive refs from README/CHANGELOG/tests.
- **De-bloat** — removed the dead `capacityLine()` export and the unused `ws`/`@types/ws` deps.
- **SAM's own email (SMTP)** — give SAM an address (any provider — Gmail app-password, IONOS, Fastmail…) via
  `SMTP_*` env and it can send mail on its own: the `send_mail` tool (ask-first) and an auto-emailed morning
  brief + capacity nudges to your inbox. Dormant until configured. `server/mailer.ts`, provider-agnostic.
- **SAM manages its own free capacity** — a capacity monitor (`server/capacity.ts`) watches the free-tier key
  pools and, when they run thin (all keys rate-limited, or none configured), surfaces ONE legit provider to top
  up — in the morning brief, on `/api/capacity`, in `/api/status`, and via the `capacity_status` tool ("how's my
  free capacity?"). Local Ollama is always the unlimited, key-free fallback. It points you at each provider's own
  signup page (you create the account, per their ToS) — SAM never farms accounts/keys.
- **⚡ Turbo mode** — a new answer-quality option (Settings · `/turbo` · palette) that does ONE fast call on the
  quickest free brain (Cerebras/Groq) with no tool loop — instant replies for quick chat & drafting. A ⚡ pill in
  the composer shows when it's on; click it to drop back to Automatic.
- **Faster & leaner** — in-memory Float32 vector cache for memory + doc recall (parse each vector once, not every
  turn — ~14–22× at scale); an LRU cache on query embeddings (kills the network round-trip on repeats); memoized
  persona/doctrine + mtime-cached socials (no per-turn rebuild/disk read); local lenient tool-JSON recovery so a
  small model's malformed JSON no longer costs an extra model round-trip; parallelised the morning brief; adaptive
  swarm poll + debounced persistence in the HUD. (Model latency still dominates — SAM already routes fastest-first.)
- **Security — full CodeQL + adversarial audit, 0 open alerts** — resolved 5 CodeQL alerts (command-injection in
  the proactive notifier, SSRF in the creative proxy, a ReDoS in the command denylist) AND a broader shell-injection
  class it missed (~22 `sh()` sites that wrapped input in double-quoted `JSON.stringify` → converted to single-quote
  escaping so `$(…)` can never execute). Plus: **server-held approval store** (the client approves by opaque id — the
  tool/input/transcript never come back over the network), SSRF guard incl. IPv4-mapped IPv6, hardened catastrophic
  denylist, loopback-only API bind, **P2P off-by-default + token-gated**, and dropping an OpenAI-key leak to a 3rd party.
- **Packaged desktop app works** — fixed every API call resolving to `file://` in a build (one `file://` fetch shim);
  `electron-builder` now excludes `vault/` + `.env` from any DMG; a preflight guard explains the space-free-path
  requirement. Validated an actual DMG build (secrets excluded, skills + server included).
- **Dependencies clean** — vitest 2→4 / vite 6→8 cleared all dev-tooling advisories (`npm audit` 0); CI actions
  bumped to latest; tests are now hermetic (never touch the real vault).
- **Cleanup** — removed 3 duplicate tools (kept the cross-platform ones), a 40 MB unused vendored app
  (repo 48 MB→15 MB), dead code, and fixed the landing count regex (was undercounting ids with digits).
- **SAM knows your documents (roadmap #93 — the 100th item, board complete 🏁)** — point SAM at any folder or
  drive ("index my drive") and it walks it, extracts text (md/txt/pdf/docx/csv/json/html), chunks + embeds it
  into the vault (`docs` tables in memory.db, same free embedding lanes + model-pinning as memory), and recalls
  the best passages by meaning in every chat — source file cited. INCREMENTAL: re-runs skip unchanged files, so
  a huge drive is indexed in cheap passes (per-run file cap, junk/system dirs skipped, size caps). New tools:
  `ingest_folder` (ask-first — uses embedding quota) · `search_docs` · `docs_library` · `forget_docs`.
  `/api/status` shows the library size. Fully offline test suite (8 tests, mocked embeddings — no quota).
- **Security hardening** — loopback-only bind (`127.0.0.1`), osascript single-quote injection patched (notification strings), AppleScript newline injection patched (multi-line `osa()` bodies).
- **Universality sweep** — all gendered pronouns (`he/him/his`) replaced with gender-neutral `they/them/their` throughout the system prompt and operating doctrine; SAM now works for everyone out of the box.
- **De-bloat** — `desktopNotify` properly exported; two duplicate dynamic `import(…) as any` call-sites in `index.ts` replaced with a single top-level import.
- **Truth sweep** — SECURITY.md updated with loopback binding bullet + accurate injection-defence description; CHANGELOG counts corrected.

## Unreleased (previous)
- **Hardened to production-grade** — full 4-dimension audit (bugs · efficiency · integrity · hygiene): fixed a
  Private-mode→cloud fallthrough, a swarm lost-update race, memory-loss on embedding-provider rotation, request
  hangs, and a scripted "now playing" claim; capped tool-routing token waste; added Anthropic prompt caching,
  a full test suite (now 92 tests) + typecheck/selftest/boot CI gates.
- **World-class brain** — an operating doctrine distilled from the best public system prompts (agentic persistence,
  prompt-injection defense, verify-before-claiming), plus 78 agents (64 specialists + 14 ninjas) and a searchable "Meet the team" browser.
- **UX pass** — ⌘P command palette, ⌘F find-in-chat, 8 skins, syntax highlighting, per-block code-copy, drag-drop
  + paste, collapse-long messages, quote-reply, reading-progress, export/copy chat, text-size. Landing auto-builds from live code.
- **148 tools · 78 agents · 25 skills** — counts stay accurate; the landing and "Meet the team" read them live from source.
- **Control-centre Dashboard** — live view of free brains, tools, skills, memory, brands + recent activity.
- **Listen button** on every message — hear what SAM did out loud (per-message TTS).
- **Self-update** — SAM checks the repo and shows "new version available → Update now" (git pull). Evolves for free.
- **Language at setup** — pick your language in onboarding; SAM replies in it.
- **Auto-setup** — `./setup.sh` does everything (Node check, install, .env, key guidance, start). Paste-proof install docs.
- **Dev tools** — git diff/log/branches + run npm scripts.
- **Living voice mouth** — animated bars that move with SAM's voice (voice listen bug fixed).
- **Business/Personal minds**, grab-your-world startup, Uber-style progress tracker.
- **Brain/DNA**: think like the OGs (Apple/Elon/Amazon/Branson/Sugar + MS ethics), Borg mode (learn/adapt/evolve, free-first), builder's instinct (10x in-house).
- **Shipped clean to GitHub** — generic code, personal data in gitignored local files, secret-scanned, proprietary license.
- **30+ free model lanes** (Groq · Cerebras · NVIDIA · DeepSeek · Gemini · Mistral · GitHub Models · SambaNova · Together · Fireworks + 20 more) that
  rotate on rate-limit → never drops to weak local unless ALL are spent. Kills credit-limit issues.
- **Semantic memory (RAG)** + **embeddings tool/skill routing** (leaner prompts) + **SSE streaming**
  + **standing authorizations** ("always allow") + **get-a-free-key links** in Admin.
- **Live context**: SAM always knows date/time + approx location; `get_location` tool.
- **Reliability/frugality**: fast-path only for pure generation (else it researches), MAX_STEPS 4,
  trimmed prompts + web results, fact-extraction on local, slim brand context. Never free→paid.
- **Persona**: facts-first, research-before-acting, morals/ethics, save-money, explain-pro-way-simply,
  then-vs-now, calm-when-ranting, Alan Sugar/Branson savvy.
- **Semantic long-term memory (RAG)** — SAM now recalls the RIGHT past facts by meaning,
  not just the last 5 turns. Free/low-RAM embeddings (Jina v3 → Gemini `gemini-embedding-001`
  → Ollama nomic, model-tagged so dims never mix). Flat-file vector store (`vault/memory.json`),
  cosine + recency decay, dedup-on-write. **Extracts atomic FACTS (not raw logs)** via a cheap
  free model to avoid context poisoning. Verified: recalled a fact from a totally reworded query.
- **JSON retry/repair** in the agent — one repair pass when a small model botches tool JSON
  (research: biggest cheap reliability win).
- `server/embeddings.ts` + `server/memory.ts`; `/api/status` shows memory count.
- **Enterprise/GitHub-ready**: LICENSE, CI (`.github/workflows/ci.yml`), `.editorconfig`,
  `.nvmrc`, hardened `.gitignore`; secret-scanned history (clean).
- **Faster & cheaper**: agent fast-path (plain chat skips the tool protocol);
  single-process serve (`npm start`, one port `:8787`, no separate dev server).
- **Bugfix**: space-safe paths (`fileURLToPath`) — fixed admin key-saving on a path with spaces.

## Waves 1–7
- **Voice**: ElevenLabs premium voice (`/api/speak`) + free browser fallback; two-way
  Voice Mode; whistle/clap wake; read-aloud; contextual swaggy greeting.
- **Web**: Jina engine for clean search/read (free-tier), scraper fallback.
- **Agency**: 37 tools (web, files, terminal, mouse/keyboard, email/iMessage, calling
  via iPhone Continuity, calendar/reminders, music, macOS control) with ask-first safety
  + catastrophic-command guard.
- **Vision**: photos → free Gemini multimodal.
- **Admin**: in-app API-key manager with rolling pools (Settings → API keys & providers).
- **Skills**: 25 drop-in `SKILL.md` playbooks; `npm run skill:new`.
- **UX**: light/dark, premium design, multi-chat history, attachments (+ button),
  copy/regenerate/edit-resend, slash commands, onboarding + per-user profile, shareable.
- **Free & low-RAM by default**: Groq cloud default; local Ollama optional (Private).
- **Model router**: local → free (Gemini/Groq/OpenRouter) → premium (Claude/OpenAI),
  rotating key pools, 429 cooldown.
