# Stripping four at once — prompt-kit · llm-scraper · strix · reviewdog

*One build, three honest nexts. Scoreboard first, detail below.*

| Repo | What it is | Verdict |
|---|---|---|
| [mishushakov/llm-scraper](https://github.com/mishushakov/llm-scraper) | TS lib: structured data from any page via LLM + schema | ✅ **BUILT** → `server/webintel-extract.ts` |
| [ibelick/prompt-kit](https://github.com/ibelick/prompt-kit) | React/shadcn UI components for AI chat | ⏭️ next (frontend polish, not a capability) |
| [usestrix/strix](https://github.com/usestrix/strix) | Autonomous AI pentest agent (app-sec) | ⏭️ next (heavy external tool; occasional audit, not a build) |
| [reviewdog/reviewdog](https://github.com/reviewdog/reviewdog) | Post linter output as diff-filtered PR comments | ⏭️ next (CI DevEx; ready workflow snippet below) |

---

## ✅ BUILT — llm-scraper → `server/webintel-extract.ts`

llm-scraper extracts structured data from any webpage using an LLM + a Zod schema, via
Playwright + the Vercel AI SDK. That capability is the exact **increment 2** of the `webintel`
reader we shipped last turn ("read a page" → "extract structured facts from a page"). So — same
method as every good strip — I took the idea, not the code: rebuilt it clean-room on **our own
`webintel.fetchClean` + an injected LLM fn** (SAM's existing model calling), with **no Playwright
and no Vercel AI SDK dependency**.

`extract(url, schema, llm, opts)`: page → clean text → schema prompt → SAM's brain → robust JSON
parse (handles fenced / prefixed / junky model output) → type-coerce & validate → structured
object + an `issues[]` list of anything missing or uncoercible.

Verified (`incoming-cowork/webintel-extract.verify.mjs`, **9/9**), typecheck-clean, CI-safe test
(`webintel-extract.test.ts`): prompt building, loose JSON parse, coercion ("1999"→1999,
"yes"→true, scalar→string[]), missing-field flagging, and the **full pipeline live** — real
Wikipedia fetch → prompt → (mock) LLM → `{title:"Circuit breaker", products:["breaker"], …}`.
Because the LLM is injected, it runs **local/key-free via Ollama** and is testable without keys.
To expose as a tool = one `web_extract` entry in `tools.ts` wiring `llm` to `runBrain` (reviewed
one-liner, shared file). **Why ours beats vendoring:** no browser dep, uses SAM's own brains,
MIT, and it composes with the reader + cache we already own.

## ⏭️ prompt-kit — next (nice, but it's paint, not plumbing)

A genuinely tasteful React component library (shadcn/Tailwind) for chat UIs — `PromptInput`,
`message`, `markdown`, `code-block`, `chat`. But SAM already has a working HUD, and this is
frontend *polish*, not a capability gap. If/when you refresh SAM's chat UI and it's on shadcn,
this is the kit to reach for (`npx shadcn add prompt-kit/[component]`) — a design decision for
whoever owns `src/`, not a backend build. Filed, not taken.

## ⏭️ strix — next (real tool, wrong weight for a build)

An autonomous AI **pentest** agent — it hunts SQLi/XSS/IDOR/SSRF in web apps and proves them
with PoCs. Impressive, Apache-2.0 — but it's a heavyweight external agent (Python + Docker +
its own LLM key) for **application** security, and it explicitly is *not* aimed at AI-agent
threats like prompt injection. Two honest notes: (1) SAM's Express server *could* be pentested
by strix occasionally as a security audit — a real thing to *run*, not *build in*. (2) It does
**not** fill the red-team gap flagged in the ai-eng strip — that gap (adversarial
prompt-injection against SAM's tool layer) is still **Garak/PyRIT** territory, not app-pentest.
Filed as an occasional-audit option, not a component.

## ⏭️ reviewdog — next (CI DevEx; here's the ready snippet if you want it)

A neat Go tool: pipe any linter's output through it and it posts **only the issues on changed
lines** as PR comments. It improves SAM's *repo hygiene*, not SAM the product — so it's a
"next" for the build question, but it's a genuine small win for the CI you already run (the
watchdog + `npm run verify`). Opt-in, drop-in — no code, just a workflow file:

```yaml
# .github/workflows/reviewdog.yml — biome + tsc findings as diff-scoped PR comments
name: reviewdog
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - uses: reviewdog/action-setup@v1
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - name: biome → reviewdog
        env: { REVIEWDOG_GITHUB_API_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
        run: npx biome lint --reporter=github . 2>&1 | reviewdog -f=github-annotations -reporter=github-pr-review -filter-mode=added -fail-level=any
```
Adopt only if you want inline PR review comments; it's `.github/` territory, so left as a snippet.

## FLIP IT

Nothing from any of the four — a UI kit, a web-extractor, an app-pentester, and a PR-comment bot
have no place in a mechanical £5 daily-bar rig. (webintel-extract could *technically* scrape a
data page, but the constitution keeps flip-it on market-data APIs, not web scraping — same reason
wigolo was a no.)

## BOARD paste block

```
- Four-pack stripped (FOURPACK_STRIP.md): 1 build, 3 nexts. BUILT: llm-scraper → our own
  `server/webintel-extract.ts` (page→schema→structured data on webintel + an injected LLM; no
  Playwright/Vercel-AI dep; runs local via Ollama; 9/9 live-verified, typecheck-clean, CI test).
  webintel increment 2. Expose = 1-line `web_extract` in tools.ts. NEXTS: prompt-kit (shadcn UI
  kit — frontend polish for a future HUD refresh, not a capability); strix (heavy autonomous
  app-pentest agent — occasional security audit of SAM's server, NOT the prompt-injection
  red-team gap which stays Garak/PyRIT); reviewdog (CI DevEx — ready .github workflow snippet in
  the doc, opt-in). FLIP IT: nothing from any.
```
