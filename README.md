<div align="center">

# S.A.M. — Smart Artificial Mind

**Your private, free, local-first AI assistant that actually *does* things.**

Not a chatbot. A doer. SAM researches, remembers, and takes real action on your Mac —
web, files, terminal, email, calls, GitHub — with an ask-first safety layer so nothing
risky happens without your OK.

`Free by default` · `Runs on your machine` · `6 free AI brains` · `Ask-first safety`

</div>

---

## Why SAM

Most "AI assistants" just talk. SAM works:

- 🧠 **6 free AI brains, auto-rotating** — NVIDIA · Groq · Cerebras · Mistral · GitHub Models · Gemini. If one hits a limit, it hops to the next. You basically never run out, and it never costs you a penny by default.
- 🖐️ **50 real tools** — web search, read files, run commands, email, iMessage, calls (via iPhone Continuity), calendar, music, screenshots, **GitHub (read repos, commit, push, open PRs)** — risky ones always ask first.
- 🧭 **Semantic memory** — remembers what matters about you and your work, by meaning, across sessions.
- 💼🏠 **Business & Personal minds** — one toggle flips SAM's whole headspace: sharp operator at work, warm and personal at home.
- 📍 **Live progress tracker** — watch SAM work step-by-step with mini icons, Uber-style.
- 🗣️ **Voice** — talk to it, it talks back. Whistle or clap to wake.
- 🎨 **Clean, premium UI** — light/dark, streams as it types, attach photos & files.
- 🔒 **Private** — runs on your machine. Your keys, memory and data never leave it.

---

## Quick start

**Prerequisites:** [Node.js 20+](https://nodejs.org) · macOS (Windows/Linux work too; some Mac-only tools degrade gracefully).

Paste these into Terminal **exactly as-is** (they're clean — no comments to trip up zsh):

```bash
git clone https://github.com/richhabits/sam.git
cd sam
npm install
cp .env.example .env
npm start
```

Then open **http://localhost:8787**, tell SAM your name, add a free key in **⚙ Settings**, and go.

> Prefer one command? `git clone https://github.com/richhabits/sam.git && cd sam && ./setup.sh`

> No keys yet? SAM still runs fully offline via [Ollama](https://ollama.com) if you have it — otherwise grab one free key below (60 seconds).

---

## Get a free brain (pick any — all free)

Open **⚙ Settings → API keys** in the app and paste one or more. SAM rotates across all of them.

| Provider | Get a key | Notes |
|---|---|---|
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | fastest, generous free tier |
| **Cerebras** | [cloud.cerebras.ai](https://cloud.cerebras.ai) | blazing fast |
| **NVIDIA** | [build.nvidia.com](https://build.nvidia.com) | capable, generous |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | adds photo/vision |
| **Mistral** | [console.mistral.ai](https://console.mistral.ai/api-keys) | free tier |
| **GitHub Models** | [github.com/settings/tokens](https://github.com/settings/tokens) | free with a GitHub token |

More keys per provider = more headroom, still free. Nothing bills you unless you deliberately add a paid provider.

---

## Make it yours

SAM ships generic — it becomes about **you** as you use it:

- **Your name & style** — set at first run; SAM adapts.
- **Your brands/projects** — edit `server/projects.ts`, or drop a `vault/brands.json` (gitignored — stays private) and SAM loads it.
- **Your memory** — SAM learns as you chat; lives in `vault/` on your machine only.
- **Your keys & voice** — all in **Settings**, stored only in your local `.env`.

Everything personal lives in gitignored local files — so you can share the code freely without sharing your world.

---

## Under the hood

TypeScript brain (Express, one process) + React/Vite UI · model-agnostic agent loop · rotating key pool ·
semantic memory & tool routing (embeddings) · SSE streaming · markdown vault (no database).
`npm start` builds the UI and serves everything on port 8787.

```bash
npm start     # build + run the whole app
npm run dev    # dev mode with hot reload
npm test       # run the test suite
```

---

## Auto-updates

SAM keeps itself current — every time it launches it quietly pulls the latest version (safe fast-forward only; it never touches your local edits). While running, a banner tells you if a new version lands. Turn it off with `SAM_NO_AUTOUPDATE=1` if you're developing.

---

## Privacy & safety

- **Local-first.** Your keys, memory and data stay on your machine.
- **Ask-first.** Anything risky (sending, deleting, pushing, running commands) pauses for your explicit OK — or grant a standing "always allow".
- **No telemetry.** SAM doesn't phone home.

---

## License

**Proprietary — © 2026 HECTIC. All rights reserved.** See [LICENSE](LICENSE).
Shared for personal use and testing; not for redistribution or commercial use without permission.

<div align="center">

**S.A.M.** — it doesn't just answer. It handles it.

</div>
