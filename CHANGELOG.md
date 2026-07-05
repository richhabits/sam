# Changelog

All notable changes to SAM. Newest first.

## Unreleased
- **Control-centre Dashboard** — live view of free brains, tools, skills, memory, brands + recent activity.
- **Listen button** on every message — hear what SAM did out loud (per-message TTS).
- **Self-update** — SAM checks the repo and shows "new version available → Update now" (git pull). Evolves for free.
- **Language at setup** — pick your language in onboarding; SAM replies in it.
- **Auto-setup** — `./setup.sh` does everything (Node check, install, .env, key guidance, start). Paste-proof install docs.
- **Dev tools** — git diff/log/branches + run npm scripts. 53 tools total.
- **Living voice mouth** — animated bars that move with SAM's voice (voice listen bug fixed).
- **Business/Personal minds**, grab-your-world startup, Uber-style progress tracker.
- **Brain/DNA**: think like the OGs (Apple/Elon/Amazon/Branson/Sugar + MS ethics), Borg mode (learn/adapt/evolve, free-first), builder's instinct (10x in-house).
- **Shipped clean to GitHub** — generic code, personal data in gitignored local files, secret-scanned, proprietary license.
- **6 free model lanes** (NVIDIA · Groq · Cerebras · Mistral · GitHub Models · Gemini) that
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
- **Runs from internal disk** (`~/Developer/SAM`) — `node_modules` 1.8 GB → 126 MB, faster.
  ROMEO HQ keeps a slim source-only backup.
- **Faster & cheaper**: agent fast-path (plain chat skips the tool protocol);
  single-process serve (`npm start`, one port `:8787`, no separate dev server).
- **Bugfix**: space-safe paths (`fileURLToPath`) — fixed admin key-saving on "ROMEO HQ".

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
