# Show HN draft (v1.6.0)

**Title** (recommended):
> Show HN: SAM – a private, local-first AI assistant that does the work (MIT)

*Alternates to A/B:*
> - Show HN: SAM – a local-first AI agent that writes its own tools, free on your own machine
> - Show HN: SAM – free, private AI agent that runs on free tiers or fully offline (Ollama)

**URL:** https://github.com/richhabits/sam

*(HN rules: post the URL, then the first comment below immediately. No emoji, no adjectives-as-argument
in the title. Post Tue–Thu ~8–10am US Eastern.)*

---

**First comment (post immediately after submitting):**

Hi HN — solo maker here (under HECTIC). SAM is a private AI assistant that runs on your own machine and
actually *does* things — web, files, terminal, email, GitHub — instead of just chatting. MIT-licensed,
free to run, and it works offline against a local Ollama model. A few things I think are worth your time:

**1. Free-first cascade router.** A fast, model-free classifier scores each request and sends it to the
cheapest brain that fits: trivial → your local Ollama model (never a paid API), standard → free cloud
tiers (~40 keys auto-rotating across Groq/Cerebras/Gemini/…), hard → the strong free lane; a paid model
only if you opt in. On a fixed 20-task benchmark that's ~86% cheaper and ~46% faster than the prior
version, with 100% of tasks served free-or-local. The bench runs against a deterministic mock, so it's
reproducible and costs nothing — `npm run bench`.

**2. It writes its own tools — and I learned the hard way that `node:vm` is not a sandbox.** When SAM
lacks a tool, it drafts a small JS function, static-scans it (no eval/require/shell/prototype tricks),
runs it, and saves it *disabled* for you to review; capabilities are declared up front (`net`/`fs:write`
are gated as dangerous, shell can never be forged). The original design ran forged code in a `node:vm`
context. During a pre-launch security audit I confirmed that's escapable: an injected object's
`constructor.constructor` reaches the host `Function` (which ignores the vm's codegen flags), and with
a bit of `String.fromCharCode` obfuscation you slip the static scan and reach `process` →
`child_process` → RCE. So forged code now runs in a **separate process** launched with
`--disallow-code-generation-from-strings` (kills `eval`/`Function` isolate-wide), with a stripped env
(no keys), no ambient globals, and `this` bound to a null-proto object. Found and fixed before launch,
locked with regression tests. Full write-up: `docs/SECURITY-AUDIT.md`. Node's own docs say the vm module
isn't a security mechanism — worth repeating, because a lot of "sandboxes" out there are exactly this.

**3. Knows your stuff, acts everywhere.** A semantic cache returns repeat questions in ~2ms/0 tokens; an
on-device index embeds folders you pick and cites the source file; a system-wide ⌥Space / Alt+Space
overlay acts on your current selection in any app. 173 tools, a team-of-agents mode for big jobs.

**Safety model** (since it runs shell/email/fs through an LLM): dangerous actions (shell/send/delete/push)
*always* ask first — no bypass by autopilot or a background swarm. All untrusted content it reads (web,
email, files, clipboard, calendar, repos) is fenced as data so injected "ignore your instructions"
text can't drive it. Keys/memory/files stay local; nothing leaves in offline mode; no telemetry.

**Honest limitations:** at-rest vault encryption is opt-in and not yet whole-DB (I recommend full-disk
encryption alongside it). The demo GIF / per-OS screenshots are still being recorded on a real runner.
It's one person's project — expect rough edges, and please try to break it.

**Stack:** TypeScript/Express + React + Electron, a model-agnostic agent loop, local embeddings, a
markdown/SQLite vault. 193 tests, a blocking lint gate, 3-OS CI, signed/notarized desktop builds.

Happy to go deep on the router, the sandbox, or the safety model. What would you break first?
