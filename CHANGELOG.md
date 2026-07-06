# Changelog

All notable changes to SAM. Newest first.

## Unreleased
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
- **Cleanup** — removed 3 duplicate tools (149→146, kept the cross-platform ones), a 40 MB unused vendored app
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
  a 69-test suite + typecheck/selftest/boot CI gates.
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
- **Bugfix**: space-safe paths (`fileURLToPath`) — fixed admin key-saving on "My Drive".

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
