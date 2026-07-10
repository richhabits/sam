# release/v1.6 → main — Launch-grade hardening

> **This doc doubles as the v1.5 → v1.6 changelog and the basis for the launch-day "what is SAM" post.**
> The two things that make this worth a serious look: **(1) a pre-launch security audit that found and
> closed a critical RCE**, and **(2) a reproducible benchmark showing SAM runs the same work for −86% of
> the cost** by routing to free/local models first.

## What SAM is

A free, private team of AI agents that lives on your computer, remembers everything, and actually does
the work — web, files, terminal, email, calls, GitHub. Local-first and cross-platform (macOS · Windows ·
Linux). It routes to **free cloud tiers and your local Ollama model first**, so most tasks cost nothing,
and it **asks before anything dangerous**. MIT.

**The −86% number (reproducible — `npm run bench`):** across a fixed 20-task suite, the free-first router
took the cost from **$0.031951 → $0.004423 (−86%)** and the average latency from **239ms → 129ms**, with
**100% of tasks served free/local** (vs 90% at baseline). Real measurements, committed under `bench/`.

## 🔒 Security (the headline)

**Critical: forge sandbox RCE — found, fixed, and locked with regression tests.**
A forged or imported (`.sampack`) tool with **no declared capabilities** (so `confirm`-tier — eligible
to auto-run under Autopilot) could break out of the `node:vm` sandbox, reach the host `process`, then
`require('child_process')` → **full remote code execution, bypassing the entire tool gate.** Reproduced
with a payload that slipped the static scan via bracket-notation `constructor` access + `String.fromCharCode`
obfuscation.

`node:vm` is [documented as *not* a security boundary](https://nodejs.org/api/vm.html) — injected/host
objects leak the host `Function` constructor, which ignores vm codegen flags. **Fix:** forged code now
runs in a **separate process** started with `--disallow-code-generation-from-strings` (disables
`eval`/`Function` isolate-wide, so the escape can generate no code and throws), with a **stripped env**
(no API keys reach it), no ambient `process`/`require`/`fetch`/`fs`, and `this` bound to a null-proto
object. Three regression tests cover the direct, obfuscated, and capability-shim escape routes.

**Also:**
- **Prompt-injection fence widened** to every attacker-reachable ingestion path (`read_file`,
  `search_files`, `github_read_file`, `git_diff`, `clipboard_get`, `read_calendar`, `read_notes`,
  `search_notes`, `news_rss`, `whois`, `research`, `notebook_ask`); a test asserts each is fenced.
- **`.gitignore`** now covers every signing-cert format (`*.p12/*.pfx/*.cer/*.crt/*.p8/*.mobileprovision/*.csr`).
- **`docs/SECURITY-AUDIT.md`** added (findings + verified boundaries — a trust asset); `SECURITY.md`
  corrected (its `node:vm` containment claim was exactly what this PR disproves).
- Verified solid, no change: dangerous-tool gate, pack import, remote scoped tokens, CORS +
  anti-DNS-rebinding, gateway abuse caps. `npm audit`: 0. `gitleaks`: 0 across all history.

## 🧹 Personal-data scrub

- Working tree cleared of personal references (`git grep -i user` = 0 hits).
- **Fixed a real contradiction:** README License said *"Proprietary — All rights reserved"* while the
  LICENSE + badge say MIT → corrected to MIT.
- `.mailmap` remaps the one commit authored under a personal name → the project identity (no history
  rewrite, no force-push). History left intact by decision (low-sensitivity business names only).

## ✅ Code quality

- **Biome migrated** 1.9.4 → 2.5.3 (the old config was erroring out entirely — the gate couldn't run).
- **Blocking lint gate wired in CI** — fails on error-level rules only; 5 real bugs fixed by hand,
  mechanical rules auto-fixed. Style/CSS-noise + verified-safe rules disabled; a11y/hook-deps/`useButtonType`
  kept as advisory warnings (visible, non-blocking — no giant JSX churn). **0 errors.**
- Ratchet-only **coverage floor** (`npm run test:coverage`), `.dependency-cruiser.cjs` boundary rules,
  `@biomejs/biome` pinned as a devDependency so the gate actually resolves in CI.

## 🌍 Universal copy + repo polish

- De-Mac'd the README headline ("lives on your Mac" → "your computer"), added a "Works everywhere:
  macOS · Windows · Linux" strip + badge. Hero image was a **broken link** (`demo.gif` doesn't exist)
  → pointed at the real static `social-preview.png` until the GIF is recorded on a runner.
- CI: CODEOWNERS, release-drafter, kind-worded stale-bot, label taxonomy, **draft-PR skip** on the heavy
  3-OS matrix, concurrency auto-cancel. Fork-PR lock on self-hosted jobs + `PIPELINE.md` + `CODE-HEALTH.md`.

## Verification

`npm run lint` (0 errors) · **193 tests** · `tsc --noEmit` · `npm run build` · coverage floor · `npm audit` 0
— all green together. Cross-platform matrix (macOS/Windows/Linux) unchanged. `main` is a clean
fast-forward (no conflicts).

## ⚠️ Before merging / launching (not in this PR)

- [ ] **Version bump** — `package.json` is still `1.5.0`; bump to `1.6.0` + CHANGELOG before tagging.
- [ ] Record the demo GIF on the self-hosted runner → swap the hero `src` back to `docs/media/demo.gif`;
      grab per-OS screenshots. *(Do this before filing submissions — gatekeepers click straight through.)*
- [ ] File the staged external submissions (winget/Flathub/awesome ×5) **after** push + GIF.
- [ ] Branch protection on `main` (admin), any pending GitHub secrets, optional gateway deploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
