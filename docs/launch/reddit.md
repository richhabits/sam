# Reddit drafts (v1.6.0)

**Rules of engagement:** disclose you're the maker in the first line, lead with substance not pitch, no
emoji-spam, put the repo link in a *comment* (many subs auto-filter link posts), and actually reply.
Space the posts hours apart, tailor each to the sub. Post the demo GIF once it's recorded.

---

## r/LocalLLaMA — post here FIRST (best fit)

**Title:** SAM: a local-first AI assistant that routes trivial requests to your Ollama model, and runs forged tools in a real process sandbox (86% cheaper than its last version)

**Body:**
Maker here (solo, MIT-licensed). Sharing SAM — a private AI assistant that runs on your own machine.

What this sub will care about: a **cascade router** classifies each request and sends trivial ones
(greetings, quick maths, short rewrites) to your **local model** (llama3.2:3b out of the box) — *never* a
paid API — standard ones to free cloud tiers (~40 auto-rotating), and only escalates when a cheap answer
fails a self-check. On a fixed 20-task benchmark it's **~86% cheaper and ~46% faster** than the previous
version, **100% served free-or-local**. Deterministic mock bench so you can reproduce it for free
(`npm run bench`). Tool-calling works on the local model via a lenient JSON-repair parser.

The bit I think you'll appreciate: SAM writes its own tools, and I got the sandbox *wrong* the first time.
It originally ran forged JS in a `node:vm` context — which a pre-launch audit proved is escapable
(`constructor.constructor` → host `Function` → `process` → RCE; a `String.fromCharCode` payload slips the
static scan). Node's docs literally say vm isn't a security boundary. It now runs forged code in a
**separate process** with `--disallow-code-generation-from-strings`, a stripped env, and no ambient
globals — found and fixed before launch, with regression tests. Write-up in `docs/SECURITY-AUDIT.md`.

Also: semantic cache (repeat Qs in ~2ms/0 tokens), on-device file index that cites the source, ⌥Space
overlay, 173 tools. Keys/memory/files stay local; nothing leaves in offline mode; no telemetry. Repo +
one-liner in comments — keen on feedback about the routing and which small model you'd pick as the
tool-use default.

---

## r/selfhosted — post a few hours later

**Title:** SAM — self-hosted, private AI assistant that takes actions (MIT, ~free per task, one-paste install)

**Body:**
Maker here. SAM runs entirely on your own machine — keys, memory, vault and a local file index never
leave it (nothing at all leaves in offline/Ollama mode). It's a doer: **173 tools** across
web/files/terminal/email/GitHub, a ⌥Space overlay, and it writes its own (sandboxed) tools when it lacks
one. A cascade router keeps ~100% of a representative workload on free/local brains, so most tasks cost
nothing.

For self-hosters: the backend is a local server on `127.0.0.1:8787` you run yourself and can reach from
your phone over your own network/Tailscale via **scoped tokens** (read-only / no-dangerous / full, hashed
+ revocable). Plus **opt-in vault encryption at rest**, a **beta update channel + `sam rollback`** if an
update misbehaves, and an optional **capped anonymous gateway** (your own Cloudflare Worker, hard spend
ceiling, instant kill-switch) so new installs get an answer with zero setup. Zero telemetry throughout.
One-paste install with SHA-256 verification, or grab the signed DMG/EXE/AppImage. Repo in comments —
feedback welcome.

---

## r/privacy — optional third post (privacy angle)

**Title:** SAM: an AI assistant that runs on your machine — keys, memory and files stay local, nothing leaves in offline mode (MIT, no telemetry)

**Body:**
Maker here. SAM is a personal AI assistant built local-first: your API keys, memory, indexed files and
vault all stay on your device. In offline mode (a local Ollama model) **nothing leaves the machine at
all**. No telemetry, no phone-home, MIT-licensed and auditable.

Because it runs shell/email/files through an LLM, the safety model matters: dangerous actions
(shell/send/delete/push) *always* ask first — no bypass by any automation mode — and every piece of
untrusted content it reads (web pages, emails, files, clipboard, calendar) is fenced as data so a
prompt-injection buried in a page can't make it act. Optional at-rest vault encryption
(scrypt→AES-256-GCM, OS-keychain). I also ran a pre-launch security audit and published the findings
(`docs/SECURITY-AUDIT.md`) — including a sandbox RCE I found and fixed. Repo in comments; happy to answer
hard questions about the threat model.

---
*Consistency check before posting: 173 tools · ~86% cheaper / ~46% faster · signed builds · MIT · zero
telemetry. Update counts if `npm run stats` changed them.*
