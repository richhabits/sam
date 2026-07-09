# Reddit drafts

## r/LocalLLaMA  (post here FIRST — best fit)

**Title:** SAM: a local-first AI assistant with 167 tools that defaults to Ollama when you have no keys

**Body:**
Sharing something I've been building: SAM, a private AI assistant that runs on your own machine.

The part this sub will care about: **when you have no cloud keys and Ollama is running, SAM uses your
local model by default** (llama3.2:3b out of the box) — private, offline, instant. Cloud free tiers are
just the fallback if you want them, and it rotates across ~40 of them so nothing rate-limits. Tool-calling
works on the local model via a lenient JSON-repair parser.

It's not just chat — 167 tools (files, terminal, web, email, GitHub, vision) and a team-of-agents mode
for big jobs. One paste to install; verifies SHA-256. No telemetry, keys/memory stay local.

Honest: desktop builds are currently unsigned (cert incoming, checksums provided). Repo + one-liner in
comments. Very keen on feedback about the local routing and which small model you'd pick as the default
for tool-use.

## r/selfhosted  (post a few hours later)

**Title:** SAM — self-hosted, private AI assistant that actually takes actions (free, one-paste install)

**Body:**
SAM runs entirely on your own machine — your keys, memory, and vault never leave it (nothing at all
leaves in offline/Ollama mode). It's a doer: 167 tools across web/files/terminal/email/GitHub/calendar,
plus a team-of-agents mode. Free (rotating free tiers or local Ollama), zero telemetry, ask-first on
anything risky.

Install is one paste (`curl … | bash` / `irm … | iex`) with SHA-256 verification, or grab the DMG/EXE/
AppImage. 3-OS CI, tests, no database (markdown vault). Repo in comments — feedback welcome.
