# Show HN draft

**Title:**
> Show HN: SAM – a local-first AI assistant that does the work (86% cheaper than v1.3)

*(Alt titles to A/B: "Show HN: SAM – free, private AI agent for your Mac that writes its own tools" · "Show HN: A local-first AI that indexes your files, acts system-wide, and costs ~nothing")*

**URL:** https://github.com/richhabits/sam

**First comment (post immediately after):**

Hi HN — I'm the maker (solo, under HECTIC). SAM is a private AI assistant that lives on your own machine and actually *does* things (web, files, terminal, email, GitHub) rather than just chatting. It's now **MIT-licensed**. The last two releases were about making it cheap, fast and trustworthy:

1. **Cascade router.** A fast, model-free classifier sends each request to the cheapest brain that fits: trivial → your local Ollama model (never a paid API), standard → free cloud tiers (Groq/Cerebras/Gemini, ~40 auto-rotating), hard → the strong free lane; premium only if you opt in. On a fixed 20-task benchmark that's **~86% cheaper and ~46% faster** than the previous version, **100% served free-or-local**. The bench is in the repo (`npm run bench`) and runs against a deterministic mock, so it's reproducible and costs nothing.

2. **Knows your stuff, acts everywhere.** A semantic cache returns repeat questions in ~2ms/0 tokens. An on-device life index embeds folders you pick and cites the source file. A system-wide ⌥Space overlay lets you act on your current selection in any app.

3. **It writes its own tools.** When it lacks one, it drafts a JS function, static-scans it (no eval/require/shell), sandbox-tests it in `node:vm` with nothing ambient, and saves it *disabled* for you to review. Capabilities are declared: `net`/`fs:write` are gated as dangerous; shell can never be forged.

Privacy: keys/memory/files/vault stay local; only the prompt you send goes to the brain you pick; nothing at all in offline mode. No telemetry. Optional vault encryption (scrypt→AES-256-GCM, OS-keychain). Dangerous tools (shell/send/delete/push) always ask first; prompt-injection from fetched content is fenced.

Honest bits: desktop builds aren't code-signed yet (checksums are published; I document the Gatekeeper/SmartScreen click-through openly). At-rest encryption is opt-in and not yet whole-DB (full-disk encryption recommended there).

Stack: TypeScript/Express + React, Electron, a model-agnostic agent loop, local embeddings, a markdown/SQLite vault. Tests + 3-OS CI + a macOS overlay e2e.

Happy to go deep on the routing, the sandbox, or the security model. What would you break first?
