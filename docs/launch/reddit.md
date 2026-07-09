# Reddit drafts

## r/LocalLLaMA  (post here FIRST — best fit)

**Title:** SAM: a local-first AI assistant that routes trivial requests to your Ollama model (86% cheaper than its last version)

**Body:**
Sharing an update to SAM — a private, MIT-licensed AI assistant that runs on your own machine.

The part this sub will care about: a **cascade router** classifies each request and sends trivial ones (greetings, quick maths, short rewrites) to your **local model** (llama3.2:3b out of the box) — *never* a paid API — standard ones to free cloud tiers (~40 auto-rotating), and only escalates when a cheap answer actually fails a self-check. On a fixed 20-task benchmark it's **~86% cheaper and ~46% faster** than the previous version, **100% served free-or-local**. The bench runs against a deterministic mock so you can reproduce it for free (`npm run bench`).

Also new: a semantic cache (repeat Qs in ~2ms/0 tokens), an on-device life index that embeds folders you choose and cites the file, a ⌥Space overlay to act on your selection anywhere, and a forge that writes its own tools (static-scanned + `node:vm`-sandboxed + saved disabled to review; `net`/`fs:write` gated, shell never forgeable). Tool-calling works on the local model via a lenient JSON-repair parser.

Keys/memory/files stay local; nothing leaves in offline mode; no telemetry. Optional vault encryption (scrypt→AES-256-GCM). Repo + one-liner in comments. Keen on feedback about the routing and which small model you'd pick as the tool-use default.

## r/selfhosted  (post a few hours later)

**Title:** SAM — self-hosted, private AI assistant that takes actions (now MIT, ~free per task, one-paste install)

**Body:**
SAM runs entirely on your own machine — keys, memory, vault and a local file index never leave it (nothing at all leaves in offline/Ollama mode). It's a doer: 170+ tools across web/files/terminal/email/GitHub, a ⌥Space overlay, and it writes its own (sandboxed) tools when it lacks one. Free by design — a cascade router keeps ~100% of a representative workload on free/local brains, so most tasks cost nothing.

New for self-hosters: **scoped phone/remote tokens** (read-only / no-dangerous / full, hashed + revocable), **opt-in vault encryption at rest**, a **beta update channel + `sam rollback`** if an update misbehaves, and an optional **capped anonymous gateway** (your Cloudflare Worker, ~$25/mo hard ceiling, instant kill-switch) so new installs get an answer with zero setup. Zero telemetry throughout. One-paste install with SHA-256 verification, or grab the DMG/EXE/AppImage. Repo in comments — feedback welcome.
