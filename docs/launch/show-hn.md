# Show HN draft

**Title:**
> Show HN: SAM – a free, private AI assistant that runs on your machine and does the work

*(Alt titles to A/B: "Show HN: A local-first AI agent team with 167 tools, one paste to install" · "Show HN: SAM – ChatGPT-desktop but local, free, and it actually takes actions")*

**URL:** https://github.com/richhabits/sam

**First comment (post immediately after):**

Hi HN — I'm the maker (solo, under HECTIC). SAM is a private AI assistant that lives on your own
machine. Three things make it different from a chat app:

1. **It does the work, not just talk.** 167 real tools — web, files, terminal, email, calendar,
   GitHub (commit/push/PRs), camera/vision. For a big job it spins up a team of specialist agents in
   parallel and synthesizes one answer.

2. **Free and private by default.** It runs on free cloud tiers (auto-rotating across ~40 providers so
   it never rate-limits itself), or 100% offline on Ollama — nothing leaves your machine in local mode.
   No subscription, no telemetry, your keys/memory/vault stay local.

3. **One paste to install.** `curl -fsSL https://richhabits.github.io/sam/install.sh | bash`
   (or `irm …/install.ps1 | iex` on Windows). It verifies the SHA-256 and launches. ~60 seconds to a
   working assistant with zero keys.

Honest bits: the desktop builds aren't code-signed yet (Apple cert incoming) — the installer verifies
checksums and I document the Gatekeeper/SmartScreen click-through openly. Dangerous actions (shell,
send, delete, push) always ask first, even in autopilot. Prompt-injection from fetched web/email
content is fenced so it can't trigger tool calls.

Stack: TypeScript/Express + React, an Electron desktop app, a model-agnostic agent loop, embeddings for
memory/tool routing, no database (markdown vault). Tests + a 3-OS CI matrix.

Happy to answer anything — architecture, the free-provider routing, the safety model, why local-first.
