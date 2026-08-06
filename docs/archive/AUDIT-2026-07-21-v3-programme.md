# AUDIT REPORT — Phase 0, the v3.0 builder programme

*Audited 2026-07-21 · repo `~/sam` @ `feat/v3.0-forge` (from `main`, v2.2.0) · audit only, nothing changed.*

**STATUS: AMBER** — the codebase is in better shape than the brief assumes (green, clean, no leaks), but the brief was written against a repo that does not exist and against names SAM has already spent.

---

## 0. Premise corrections (read first)

The mega-prompt's stated starting conditions do not match this machine. Four are load-bearing:

| Brief says | Reality | Consequence |
|---|---|---|
| Root `~/Desktop/jarvis-main` | Does not exist anywhere on disk | Re-targeted to `~/sam` (operator-confirmed) |
| Monorepo: `apps/web-frontend`, `packages/` | Single package. `src/` (Vite/React) + `server/` + `electron/` + `gateway/`. `workspaces: null` | `packages/forge-engine` cannot be created as specced. Either add workspaces (a real, disruptive change) or build as `server/*.ts` modules matching house style. **Recommend the latter.** |
| "don't break v1.2–v1.7", bump to v2.0.0 | On `main` at **v2.2.0**. Tags `v2.0.0`, `v2.1.0`–`v2.1.4`, `v2.2.0` already shipped | A v2.0.0 bump would collide with a released tag. **v3.0.0 (operator-confirmed).** |
| Greenfield "FORGE engine" | `server/forge.ts` **already exists and ships** — 297 lines, security-critical | Hard name collision. See §1. |

### 0.1 Two collisions that must be resolved before any code

**The Forge is already taken.** `server/forge.ts` is SAM's *tool*-forging pipeline: draft → static scan → the Cell (child-process isolate, `--disallow-code-generation-from-strings`, stripped env) → user enables. It is the subject of the v1.6 RCE fix. Calling the project-builder "FORGE" would overload a shipped, security-critical noun in code, docs, UI and commits — and the two things have opposite trust models (the Forge *distrusts* model code and jails it; the builder must *run* model code against real dirs with real CLIs). **They must not share a name.** Same for `rollback.ts` (= app-version rollback, not git checkpoints) and `projects.ts` (= a read-only *brand* registry, not managed builds).

**The brief's vocabulary violates house rules.** `CLAUDE.md` §1–2 forbid naming external projects anywhere — identifiers, comments, docs, commits — and ban borrowed jargon including the exact word *sandbox* (canonical: the Cell). The brief is written as "the Lovable move / the Cursor move / the Emergent move". Those are fine as *briefing shorthand between us*; they cannot survive into the repo. Every capability must be reimplemented from the concept and given a SAM name in the existing voice (`webintel`, `doctor`, `keeper`, `latch`, `threshold`).

Naming is a Phase-1 decision for the operator, not mine to pick unilaterally.

---

## 1. Architecture map — **8/10**

Single npm package, no workspaces. Three runtimes:

- **`server/`** — 184 files, 23,311 lines. The machine. Express on `:8787`, entrypoint `server/index.ts` (1,577 lines). Brains/routing/tools/vault/security all live here.
- **`src/`** — 39 files, 6,657 lines. React 18 + Vite HUD. `App.tsx`, `Dashboard.tsx`, `Admin.tsx`, plus ~20 panes (`SafePane`, `AutonomyPane`, `LearnedPane`, `ChimePane`, `DoctorPane`, `FlipItView`…).
- **`electron/`** — 528 lines. Desktop wrapper; `main: dist-electron/main.js`.
- **`gateway/`** — 113 lines, thin.

Launch: `com.sam.server` launchd keepalive (**confirmed running, pid 1105**) serves `:8787`; desktop app and Chrome-App shortcut both point at it. `npm run dev` = concurrently server + HUD.

*Fix:* none needed for structure itself — but decide monorepo-vs-modules before Phase 1, because it dictates every subsequent path.

## 2. Provider vault — **10/10**

Best-in-repo. `providers.registry.ts` is a single source of truth for **30+ providers, 28 of them `tier: "free"`** (groq, cerebras, gemini, openrouter, nvidia, mistral, zhipu, deepseek, hermes…); only `moonshot` is `premium`. `keys.ts` builds one `KeyPool` per provider from `*_API_KEYS` (plural, comma-split) + `*_API_KEY`, dedupes, round-robins via `next()`, and cools failures intelligently: **429 → 60s, 401/403 → 1h, other → 15s**. Point-of-use reads the Safe first (encrypted at rest) and falls back to `process.env`; `reloadPools()` re-reads after the Safe unlocks so plaintext never needs to sit in env.

The brief's "free-tier first" rule is **already implemented and stricter than asked**. Nothing to build here — only to *consume* correctly from the builder.

*Fix:* none.

## 3. Secrets & git history — **10/10**

- `gitleaks detect` over **585 commits / 3.72 MB: no leaks found.**
- Nothing secret is tracked: `git ls-files` matches only `.env.example` and the scanner workflow itself.
- Local `.env` is present at mode `-rwx------` (0700), untracked.
- `.gitignore` covers `.env*`, `*.key`, signing material, and the private vault files (`brands.json`, `memory.json`, `authorized.json`, `socials.json`, `vault/daily/*`).
- A `secret-scan.yml` workflow enforces it in CI on push/PR.

**No key rotation needed. No `git filter-repo` remediation needed.** The brief's contingency does not apply.

*Fix:* none. (Standing trap: gitleaks scans full history — never put literal key-shaped strings in tests.)

## 4. Dead code & duplication — **9/10**

**Zero orphaned modules.** Every non-test file under `server/` is imported by something. Biome: **280 files checked, no lint findings.** There is no deletion list to approve — the brief anticipated cruft that isn't there.

Only smell: `server/` has four separately-named secret/crypto modules — `vault.ts` (169), `vault-crypto.ts` (125), `crypto-vault.ts` (72), `safe.ts`. `vault-crypto` vs `crypto-vault` is a genuine readability hazard even if the responsibilities differ.

*Fix:* rename `crypto-vault.ts` → something intention-revealing; do it as its own slice, not inside Phase 1.

## 5. Security — **8/10**

Strong, with one deliberate gap that Phase 1 turns into the main risk.

Good:
- CORS locked to same-origin + localhost, with an explicit **DNS-rebinding** defence (Host header must be loopback or private-LAN).
- Non-loopback requests require a token; loopback always allowed.
- Security *settings* routes are loopback-only (`403 loopback only`), not merely token-gated.
- The Cell: forged code runs in a separate process with codegen disabled and an **empty env** — no API key reaches it. Static scan blocks `eval`/`Function`/`require`/`process`/`child_process`/bare `fetch`. Path traversal fails closed (`NAME_RE` before `join`).
- `logSecurity("alert", "blocked-untrusted-local", …)` on refusals.

The gap:
- **The Handshake is opt-in and OFF by default** (`SAM_REQUIRE_CONTROL_TOKEN`). Today that's defensible — mutating routes can't run shell. **The moment a builder can run `npm`/`git`, loopback position alone must stop being sufficient.**
- **There is no shell tool at all.** `tools.ts` (2,595 lines, 184 tools) exposes `read_file` (safe) and `write_file` (not safe) — and no general executor. Every `child_process` import in `server/` is a *fixed-argument* internal call (`ffmpeg` in `render.ts`, `security` in `safe.ts`, `execFile` in `signing.ts`/`proactive.ts`/`lifeindex.ts`), not a model-driven one.

*Fix:* land the executor and the Handshake-on default **in the same slice** — never the executor alone.

## 6. Dependency health — **6/10**

`npm audit`: **4 vulnerabilities — 3 high, 1 low, 0 critical.** All are denial-of-service, all fixable by `npm audit fix`:

| Package | Sev | Reach |
|---|---|---|
| `brace-expansion` | high | dev/build only (electron asar/universal, glob, filelist) |
| `shell-quote` | high | dev/build |
| `body-parser <1.20.6` | low | **runtime** — express request path |

Majors deliberately held back: React **18.3.1** (19 out), Express **4.22.2** (5 out), TypeScript **5.9.3** (7 out), dotenv 16 (17 out).

**Node version drift:** `engines` = `^20.19.0 || >=22.12.0`, `.nvmrc` = `20`, **actually running v25.9.0**. Untested combination; the launchd daemon inherits it.

*Fix:* run `npm audit fix` (non-breaking) and reconcile `.nvmrc` with the Node actually in use, both before Phase 1.

## 7. Scalability blockers — **4/10 · the real work**

This is where the builder programme is genuinely blocked. Five concrete gaps:

1. **No job queue.** `scheduler.ts` is plain `setInterval` over a `schedules.json`, by design ("no external cron deps"). There is no notion of a long-running, resumable, cancellable *job*. A 10-minute build has nowhere to live.
2. **Single process.** One Express server on `:8787` under one launchd job. A blocking build starves chat, voice and the HUD. The brief's "SAM stays responsive while building" requires either worker processes or strict async + a queue.
3. **No executor.** See §5. Nothing can run `npm install`, `git commit`, `vercel deploy`.
4. **No managed-project store.** `projects.ts` is 76 lines of read-only brand metadata loaded once and memoised. There is no per-project git repo, working dir, port allocation, or lifecycle.
5. **No per-job cost/token meter.** `analytics.ts`/`metrics.ts`/`pulse.ts` measure SAM globally, not per build job — so the brief's "cost meter + hard stop" has nothing to attach to.

*Fix:* Phase 1 should be the **job spine** (persistent job table + worker + cancel + budget), not the intent router. Everything else in the brief hangs off it.

## 8. Quality baseline — **10/10**

Proven this session, locally:

```
npm run typecheck  → tsc --noEmit, exit 0
npm test           → 88 files, 786 passed | 2 skipped (788), 3.92s
npm run lint       → biome, 280 files, no findings
git status         → clean
```

*Fix:* none. This is the bar to hold; the brief's "never leave the repo broken" is already the house rule (doctrine #1, #5).

---

## Prioritised remediation list

**Before Phase 1 (cheap, unblocks everything):**
1. Resolve the naming collision — the builder needs its own SAM name, distinct from the Forge. *Operator decision.*
2. Decide modules-in-`server/` vs adding npm workspaces. *Recommend modules — matches house style, avoids a repo-wide refactor.*
3. `npm audit fix` (4 vulns, non-breaking).
4. Reconcile `.nvmrc` / `engines` with the Node actually running (v25.9.0).

**Phase 1 ordering (revised from the brief):**
5. **The job spine first** — persistent job records, worker execution, cancel, per-job token/cost budget with hard stop. Nothing else works without it.
6. **The executor + Handshake-on together** — allowlisted binaries (npm, node, git, and only the deploy CLIs actually installed), cwd pinned under the managed-projects root, no `sudo`, no path escape, refusal logged via `logSecurity`. Flag-gated **off** by default, per house rule §4.
7. Managed-project store (own dir, own git repo, own port) — separate from `projects.ts`.
8. Intent routing + spec generation — genuinely last; it is the cheapest part and worthless without 5–7.

**Deferred / needs a decision:**
9. The brief's default stack (Vercel/Railway/Neon/Supabase) is a network-dependent, account-bound path that sits awkwardly against SAM's local-first north star. Recommend: builder works fully offline; deploy is an explicit opt-in surface, never a default.
10. `crypto-vault.ts` rename.

## Scorecard

| Area | Score | One-line fix |
|---|---|---|
| Architecture | 8/10 | Decide modules-vs-workspaces before writing any Phase 1 path |
| Provider vault | 10/10 | None — free-first already exceeds the brief |
| Secrets / history | 10/10 | None — 585 commits, zero leaks |
| Dead code | 9/10 | Rename `crypto-vault.ts`; nothing to delete |
| Security | 8/10 | Ship the executor and Handshake-on in one slice, never apart |
| Dependencies | 6/10 | `npm audit fix`; pin Node to what actually runs |
| Scalability | 4/10 | Build the job spine first — it is the true blocker |
| Quality baseline | 10/10 | None — hold 786 green |

**Overall: 8.1/10 as a codebase. 4/10 as a foundation for autonomous long-horizon builds** — the gap is entirely §7, and it is buildable.
