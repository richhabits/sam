# BOARD — SAM living state

*Read at boot, update at session end (CLAUDE.md doctrine #9). Newest truth wins; keep it
honest and short. Last updated: 2026-07-18, terminal session (mom_12_1_protected REJECTED at
Gate 1; registry/clock mom_12_1 aligned; cage reviewed + 7 defects fixed; 99 tests green).*

## Loops (the machine running itself)

| Loop | When | Proof it ran | State |
|---|---|---|---|
| Colosseum nightly benchmark (`com.sam.dailybenchmark`) | 04:00 daily | `~/sam/logs/daily_benchmark.log` new line + `vault/arena-ranking.json` fresh | ✅ **First nightly landed 2026-07-18 04:00:05** — champion groq:llama-3.3-70b-versatile (1115), 18 matches. Entrypoint now path-portable (was hardcoded to Romeo's home). Mac guard correctly stayed silent (it landed a champion) |
| FLIP IT forward step (`com.flipit.dailystep`) | **Mon–Fri 22:00** (not daily) | `~/flip-it/logs/daily_step.log` new block + `ledger/forward_mom_12_1.jsonl` gains a `kind:"day"` line | **Live, armed, day 0.** `~/flip-it` (NOT `~/sam/flipit`), last exit 0. Read the clock with `python3 scripts/clock.py` — **never** from `state/`. Cutoff = A-001's date (2026-07-17), so the first lived bar is **Mon 2026-07-20 22:00** (or Tue, if the vendor lags US close by more than an hour). That run freezes the ledger's anchor |

## Now (in flight)

### 🌙 SESSION END — 2026-07-18 (terminal). Read this first tomorrow.

**Both repos clean, green, backed up.** SAM `main` = origin, **409 tests**, typecheck + build
green, biome clean, `npm audit` 0 vulns. FLIP IT `30ba8a5`, **112 tests**, mirrored to
`/Volumes/ROMEO HQ/flip-it.git` — and that mirror was `git fsck`'d clean and **restore-tested**
(cloned to scratch, suite ran green) after the drive was physically disconnected mid-session.

**The one calendar item: Mon 2026-07-20 22:00** — `com.flipit.dailystep` fires and, if the
vendor has the bar, writes the **first lived forward day**, freezing the ledger's anchor, then
commits and mirrors it unattended. Clock is **day 0/60**. Read it with
`cd ~/flip-it && python3 scripts/clock.py` — never from `state/`.

**In force since today: A-002** — the 2σ band is *monitoring* during a run, a verdict only at
the horizon. A mid-run breach prints and notifies but does NOT end the run. Never restore the
early kill without a new amendment.

**Full repo audit (this session).** 361 tracked files. Clean: no secrets in tree **or history**,
`.gitignore` covers `.env`/`vault`/`logs`, no junk or stale files, no untracked strays, all 11
TODOs are intentional generator scaffolding. **One real finding:** `CLAUDE.md` — the doctrine
that auto-loads every session — mapped `flipit/` as an in-repo folder with `flipit/FLIPIT.md`
and `run_forward.py`. **None of it exists**: FLIP IT is a sibling repo at `~/flip-it`, its
constitution is `FLIP_IT.md`, its CLI is `run.py`, and the verify crib's
`python -m pytest flipit/tests -q` could only ever fail. Fixed. Also fixed two lint findings
(both mine from today). Dead reference left standing: `docs/strips/AIRLLM_STRIP.md` →
`docs/LOCAL-MODELS.md`, never written.

**GLM 5.2 was already implemented** — `ZHIPU_MODEL=glm-5.2`, endpoint `open.bigmodel.cn`, and
already **#2 in both the `deep` and `code` lanes** (after Hermes), so with a key it handles hard
reasoning and coding before the others are tried. Nothing to build. **What was actually broken
was discoverability: 19 of 43 wired providers were missing from `.env.example`** — including
zhipu — so nearly half of SAM's brains were invisible to anyone setting up. All 19 documented,
grouped by lane, with GLM's free-tier note (`ZHIPU_MODEL=glm-4-flash`). Verified: 0 providers
now undocumented.

**Settings/admin key entry audited and fixed.** GLM/zhipu was already both offered in Settings
*and* saveable — so the key goes in via **Admin → API keys & providers → Zhipu GLM-5.2**, no
`.env` editing (it writes `ZHIPU_API_KEYS` and hot-loads the pool, no restart). The audit found
three real defects around it: **(1)** `hermes` was offered in the UI and pooled in `keys.ts` but
absent from `PROVIDER_ENV`, so saving a Nous key returned `400 unknown provider`; **(2)** the UI
**ignored the response** — a 400 still flashed "Saved ✓", so you'd believe a key was stored that
never was; **(3)** `baidu`, `tencent`, `volcengine` were wired brains with no UI entry at all.
All fixed: hermes mapped, failures now render "✗ not saved — nothing was written", the three
invisible providers added, and `leonardo` routed to `/api/admin/config` (it's a single config
key, not a rotating pool, so it was 400ing too). Verified: 0 providers unsaveable, 0 invisible.

**API audit — 131 endpoints, keys layer, Settings.** Clean where it counts: `GET /api/keys`
returns **counts only, zero key material** (verified against the live payload); remote access is
off unless `SAM_REMOTE=1` + a ≥16-char token, checked with `timingSafeEqual` and per-IP backoff.
**Two real fixes:**
  - 🔒 **`/api/admin/keys` and `/api/admin/config` were the only privileged writes NOT
    loopback-gated** — while standing authorizations, autopilot, Elon Mode and remote-token ops
    all say "this computer only". And `CONFIG_ENV` can write the **Slack bot token, Discord
    webhook, Notion/Linear keys and Cloudflare token** — so a remote token-holder could redirect
    SAM's outbound integrations at their own endpoints. Both now loopback-only. *Trade-off: you
    can no longer add keys from a phone over remote — same rule as every other privileged write.*
  - 🧩 **Root cause of every provider bug today: provider identity lives in FIVE files**
    (`models.ts` lanes · `keys.ts` pools · `index.ts` PROVIDER_ENV · `Admin.tsx` UI ·
    `.env.example`). That drift produced all of it — 19 undocumented, `hermes` offered but
    unsaveable (400), 3 invisible, `leonardo` miswired. **`server/providers.drift.test.ts` (6
    tests) now fails CI when the lists disagree** — verified by reverting the hermes fix and
    watching it go red. **The deeper fix is one registry the others derive from**; that is a
    refactor across shared files and is the next real piece of work here, not a late-session
    change. 415 tests green.

**✅ Single provider registry — the refactor is done.** `server/providers.registry.ts` is now the
one hand-written provider list (43 entries). `keys.ts` pools, `index.ts` PROVIDER_ENV and the
Settings list all **derive** from it; `src/Admin.tsx` has **no provider list at all** — it renders
what `/api/admin/config` sends, so the `src/`↔`server/` boundary stays clean and there is still
only one list. Adding a provider is now one line: it is pooled, saveable and visible at once.
  - **What deliberately stays separate:** the `run()` closures and lane preferences in
    `models.ts`. Those are *behaviour* (how to call it, when to prefer it); the registry is
    *identity* (name, env var, how it appears). Mixing them is what made the old setup drift —
    and `providers.drift.test.ts` (7 tests) enforces that the two agree.
  - **The tests assert the derivation is real, not a copy** — they fail if anyone re-hardcodes
    the pools, PROVIDER_ENV, or a `PROVIDERS` literal back into `Admin.tsx`. Verified by doing
    exactly that and watching CI go red.
  - Fixed en route: `leonardo` was miscategorised (it has a real pool, so it is saveable
    normally now — the earlier config-style workaround is gone), and `fal` was a special case in
    `PROVIDER_ENV`; both are ordinary registry entries. **0 special cases left.** 416 tests green.

**Signup + Settings audited.** Two real defects, both mine from the registry refactor an hour
earlier — which is the useful part: the refactor was sound, the *edges* were not.
  - 🐛 **Settings rendered an EMPTY panel on a failed load.** Moving the provider list to the
    server means `cfg === null` shows nothing, and `refresh()` swallowed the error with
    `.catch(() => {})` — so a dead server looked identical to "SAM has no providers". Now:
    "Loading providers…" while pending, and an explicit error + **Retry** on failure.
  - 🧩 **`KeyWizard.tsx` was the SIXTH provider list** — four providers with the only copies of
    the key-format regexes. Those moved into the registry as `keyPattern`, and the wizard now
    derives from `/api/admin/config` like Settings. **`src/` now contains zero provider data.**
  - The drift test grew a guard: a signup URL or key regex reappearing anywhere in `src/` fails
    CI. Verified by re-adding one and watching it go red. **8 tests.**
  - Also caught: `loadErr` captured but never rendered — the same "state set, nothing shown"
    mistake as `saveError` earlier today, in the file I was fixing *because of* that mistake.
    Both render now. 416 tests, typecheck, lint and build all green.

**Deep design audit — `docs/DESIGN-AUDIT.md`** (measured with scripts, re-runnable). Structure is
sound: consistent error envelopes (81/83 use `{error}`), no import tangle, the `src/`↔`server/`
boundary held through the registry refactor, security model coherent. **Four findings, in order:**
  1. **Silent error handling is the dominant pattern — 129 bare catches vs 85 documented (60%).**
     Worst: `App.tsx` 43 · `tools.ts` 14 · `index.ts` 13 · `Admin.tsx` 10. This is not abstract:
     it caused today's empty-Settings bug, where `.catch(() => {})` made an unreachable server
     look identical to "no providers". **A deliberate swallow and an accidental one are
     byte-identical**, so review cannot tell them apart. Fix is mechanical — biome's
     `noEmptyBlockStatements` forces a one-line reason — but 129 sites is a decision, not a
     late-session sweep. `src/` first (~60 sites, the user-visible ones) is an afternoon.
  2. **Three files hold 37% of the code** (`tools.ts` 2513 · `App.tsx` 1840 · `index.ts` 1770).
     `tools.ts` is a registry and allowed to be long; the other two have visible seams. Not
     urgent — flagged because the trend is one-way, nothing has ever been split out.
  3. **12 of 24 sizeable modules have no direct test**, including `index.ts` (all 131 routes) and
     `src/lib/api.ts` (the whole client API surface) — *exactly where today's three Settings
     defects landed*. A thin route-contract test (status + envelope shape per route) would have
     caught two of them.
  4. **Two real circular imports**: `forge⇄tools` and `selftest⇄tools` (both import `TOOLS`, a
     value, while `tools` imports back). Survivable in ESM but makes init order load-bearing.
     `metrics⇄models` is a false alarm — type-only, erased at compile. Fix shape: inject the
     tool list instead of importing it. **Not attempted** — `tools.ts` is 2513 lines and shared,
     and restructuring it at the end of a long session is how collisions happen.

**Needs Romeo (nothing blocking):** ① one call on the `moonshot` lane with a real key — the
model ID `kimi-k2.7-code` is **unverified in both directions** · ② for the cage to go live:
key, `verify-fractional` in practice (earns the sell-encoding receipt), deposit, sign-off,
promote — all five Romeo-only.

**Rules paid for today, now in code rather than prose:** `scripts/board-guard.sh` (blocked 5 of
11 board clobbers; the written rule failed 3 times first) · stage **explicit paths**, never
`git add -A`, in repos two sessions write to · verify a claimed regression with `git show`
before re-applying from a stale copy · **drops should write a `BOARD_LINE.md`, not a whole
board** — that fix is still unadopted and would end the clobbers entirely.



**Strip records moved to `docs/strips/`** — 13 repos assessed, 5 landed something, the rest declined with reasons. That folder is the record; this list is only for what is actually in flight.

- **Colosseum**: fixed + merged on `8ab6f4f` (champion pinned first · tested > untested · ≥2-brain guard), 16 unit tests, CI green. ✅ **Proven live** — the 04:00 nightly ran clean (champion groq 1115, 18 matches). The self-improving loop works end-to-end; leave it running.- **FLIP IT paper-forward** @10% vol under Amendment A-001: extended Gate 2 = 60 forward days + 20 closed trades + in-band + beats-costs. Loop is live and `mom_12_1` is wired; clock is months, not days — that's by design. Nothing owed here until the forward gate is met.- **mom_12_1_protected — REJECTED at Gate 1 (2026-07-18).** Run in-tree on the real 30-name panel, both variants at `top_n=3` so the breaker was the only difference. **It failed worse than unprotected on every dimension, including the one it exists to improve:** max DD **43.8% vs 40.0%**, Sharpe 0.52 vs 0.71, WF folds 50% vs 88%, return +323% vs +800%. Mechanism is whipsaw — it goes flat after a 12% fall from the 20d high (near the bottom, in a momentum book) and sits in cash through the first 5 days of the rebound, the days that repair drawdown fastest. **It sells the bottom, on a schedule.** Stays unregistered/out of FORWARD_BASES; `A-002` draft marked MOOT (must not be logged); no tuning — a re-run with different thresholds is a *different* strategy at Gate 1 with its own record. Receipt: `incoming-cowork/GATE1_RESULT_mom_12_1_protected.md`. **This is the case for "a tweak is a new strategy": the breaker is obviously prudent by intuition and actively harmful in fact, and only running it revealed that.**## Next (top unblocked, in order)

1. Verify tomorrow's nightly result (read `~/sam/logs/daily_benchmark.log`, confirm champion + "steering now" in Colosseum panel) — 5 min, then leave it alone.
2. **hyperframes → SAM** ([heygen-com/hyperframes](https://github.com/heygen-com/hyperframes), 34k★): port the pattern — HTML→MP4 video as SAM skills. Start with a strip-map (what we take/bin), not a wholesale vendor drop.
3. **Vibe-Trade architecture study** ([spyderweb47/Vibe-Trade](https://github.com/spyderweb47/Vibe-Trade)): their SKILL.md-driven trading agent ≈ SAM's skills system pointed at trading — read for ideas that harden `skills/` + `~/flip-it`, write up, no port yet.
4. **Alpha Zoo → FLIP IT candidates** ([HKUDS/Vibe-Trading](https://github.com/HKUDS/Vibe-Trading), 452 factors): pick 2–3 one-sentence factors, file each through `~/flip-it/prompts/SAM_NEW_STRAT.md`, let the gates judge.

## Later / parked

- camoufox — only if SAM actually hits scrape walls (heavy dependency, no current need).
- Telemetry endpoint deploy + GitHub Discussions enablement (`docs/ROADMAP-SIGNAL.md`) — unlocks build-what-retains.
- "open-gen-ai" — link never resolved; llm-colosseum is the front-runner and is *already* the colosseum inspiration. Drop unless Romeo re-raises with a URL.

## Blocked / open threads

- **"Can't see SAM mobile"** (Romeo, in passing, never unpacked): `docs/ios_companion.md` describes the iCloud drop-folder companion. Next session with Romeo present: ask what he saw vs expected — likely folder-sync or docs-discoverability, not code.
- Free-tier quotas drained 07-17 by testing (groq rate-limiting; cerebras/hermes/nvidia dead until reset). Self-heals overnight; the point of Doctrine #3 is that this never happens again.

## Decisions Romeo owes

*(none blocking before Monday's first bar.)* Standing, only when Romeo wants the cage live — all
five are Romeo-only and a session may never do them: generate a T212 key · run
`T212_MODE=practice python t212.py verify-fractional` (earns the sell-encoding receipt that
unblocks live SELLs) · deposit · type `FLIPIT_LIVE_SIGNOFF` · promote PROVEN→LIVE. The auth seam
is unresolved by nature (T212's docs are JS-rendered, the endpoint has never been called) —
`check` is the first command to run with a key, and a 401 points at exactly one function.

## Recently done (receipts)

- 07-18 (later): **FLIP IT hardened end to end — 28 → 99 tests, 12 commits.** Beyond the items in flight above: append-only forward ledger with divergence detection (a restated vendor bar can no longer silently rewrite a lived day; verdicts judged on the *record*, not the re-derivation); sandbox output renamed + separated from the clock so `run.py forward` can never be quoted as Gate 2 progress; universe hygiene filters wired into `step` (**they drop nothing on the S&P today — 500/500 kept — so the value is future-facing and the danger is silent mid-clock change**, hence a loud `UNIVERSE_CHANGE` guard); protections wired **shadow-only** (they observe and log, gate nothing — there is no entry path, and making them bite would be a new strategy). Operator prompts written: `SAM_NEW_STRAT.md` (the only door a strategy enters by), `SAM_DAILY.md` (default outcome: *nothing to do*), `SAM_WEEKLY.md` (audit incl. doctrine-drift check). `scripts/clock.py` reads the clock from the ledger so no report ever quotes `state/`.

- 07-18: **FLIP IT: git-tracked, doctrine landed, state made durable.** `~/flip-it` was **not a git repo** — now `main` @ `e86f77c`, 4 commits, 49 tests green (was 28). (1) `CLAUDE.md` Money Doctrine landed, map corrected against reality — the draft referenced `t212.py`/`run_forward.py`/`ledger/`/`prompts/SAM_NEW_STRAT.md`, **none of which exist**; there is no broker integration at all, which is the safest state and now says so explicitly instead of implying a cage guards something. (2) **Durability**: deleting `state/ladder.json` used to read as "never seeded", so §1's one-and-only £5 could be handed out twice with no trace — `load()` now raises `LostStateError` (ledger says SEED, state file gone = *lost*, not fresh); all 5 write sites atomic (temp+fsync+`os.replace`); `state/ladder.json` un-ignored. (3) **Append-only forward ledger**: `simulate()` re-derives the window from `data/` every step, so a restated vendor bar would silently rewrite a lived day — *the clock could be wound through the data*. `ledger/forward_<base>.jsonl` records days at first observation with a frozen anchor/cutoff header, reconciles re-derivation against the record, and reports `FORWARD_DIVERGENCE` as AMBER rather than repairing it; **verdicts judged on the record, not the re-derivation**. New tests verified failing against the old behaviour before the fix.
  - ⚠️ **The real forward clock is at day 0** — A-001 is dated 07-17 and `step` takes its cutoff from the amendment, so no lived bar yet. the 299-day / 22-trade file that used to sit at `state/forward_mom_12_1.json` was a **sandbox artifact** from `run.py forward --cutoff 2025-05-06` — backtest tail standing in for the future. It has since been renamed `state/sandbox_forward_mom_12_1.json` and the two write paths separated in code, so the sandbox can no longer overwrite (or be mistaken for) the clock. Read the clock from the ledger via `scripts/clock.py`, never from state, or you'll report "day 299/60, nearly PROVEN" on day 0.
  - Self-reported defect: `log_amendment` began appending AMEND events while `test_forward.py` patched only `AMEND_PATH`, so **every pytest run wrote fabricated events into the real `ledger/events.jsonl`** (9 committed in `8bd24af`). Fixed structurally — `tests/conftest.py` autouse ledger redirect + a canary test. `events.jsonl` reset to empty (all 18 lines were same-day test artifacts; genuine A-001 predates the ledger), Romeo ratified the reset; contaminated version preserved at `8bd24af`.
  - Loop health: `com.flipit.dailystep` loaded, last exit 0, fires **Mon–Fri 22:00** — so *not tonight* (Sat). First lived forward bar lands Mon 07-20 or Tue 07-21; that run freezes the ledger's yardstick, per Romeo's call.

- 07-18: **Dead/old/universal sweep** — repo is clean. Fixed the one real universality bug: `scripts/daily_benchmark.sh` hardcoded `/Users/romeovalentine/sam` → now derived from the script's own location (portable for anyone who clones, still correct under launchd; loop re-verified). No dead modules (only false-positive was the vitest setup file), no stale/.bak files, no hardcoded version strings, TODOs are intentional scaffolding placeholders. All platform-specific code (osascript/notifications) is properly mac/win/linux-guarded.

- 07-18: **v2.1.4 "Brakes" SHIPPED** (Latest, signed+notarized, all assets + auto-update manifests, real SHA-256 in notes). Two fixes for the runaway/loop bug Romeo hit: (1) **stop-word** — "stop"/"shut up"/"stop listening" instantly halts SAM (typed or spoken), never sent to the brain, interrupts mid-stream (`src/lib/stopIntent.ts`, 77 tests); (2) **repetition guard** — cuts off degenerate model loops at the stream source + collapses the tail (`server/repetition.ts`, 17 tests). 379 tests green. Deliberately skipped frequency_penalty (unverifiable across ~40 providers, some 400 on it).
- 07-18: **v2.1.3 "Colosseum" SHIPPED** (Latest, signed+notarized) — the backlog wave merged-but-unreleased since v2.1.2 (Colosseum Elo routing, Markets, memory panel, render_video + 5 file tools, Bestie/Mentor personas, capability-scoped skills, settings redesign) + tonight's zero-warning hardening. Real SHA-256 in notes.
- 07-18: **Full audit + zero-warning sweep.** Whole-repo biome lint 315 → **0** across 4 commits (`8610ed3` buttons, `c6b9007` a11y-interactions, `e83a584` src hooks/keys/iterables, `a314f35` server). Real fixes where genuine (185 `type=button`; braced void `forEach`s; `parseInt(…,10)`; regex `while`→`for`; un-nested comma-operator cache in world.ts), documented `biome-ignore` where intentional (modal backdrops w/ Esc, mount-once effects, index-is-identity lists). Verified each batch: typecheck + 285 tests + build green; FLIP IT 28 tests green; `npm audit` 0 vulns. Also: pruned stale `origin/fix/telemetry-loopback` (already merged), confirmed GitHub branches = just `main`. Open threads for Romeo: external PR #20 (`--version`; SAM has no CLI `bin`, may not fit), rolling draft release v2.1.3 (Release Drafter — publish or leave).
- 07-18: Two-sided nightly watchdog wired. **Cloud** (`trig_01NSKNi9Kzhgq3itShZyyDd5`, cron `0 7 * * *` = 08:00 London): reads GitHub Actions on `richhabits/sam` main, pings only on red, silent on green — a smoke alarm, never a builder. **Mac** (`scripts/daily_benchmark.sh`, pushed `d3f3d39`): fires a macOS notification when SAM is down at benchmark time or the arena writes no champion line; best-effort osascript, guarded so it can't break the loop; verified loop still loads (`runs=0`, program /bin/bash). Cloud watches GitHub; Mac watches Mac.
- 07-18: Master-prompt landed on the Mac — `CLAUDE.md` (doctrine, auto-loads every session) + `docs/BOARD.md` (this file) created on `main` @ `8ab6f4f`. Reconciled BOARD against verified reality: FLIP IT lives at `~/flip-it` (sibling repo), both loops have verified entrypoints, `mom_12_1` already wired.
- 07-17: Colosseum routing order fixed (3 real bugs: spread-load rotated the champion; unranked leapfrogged tested losers; 1-brain benchmark corrupted ranking). 16 tests, merged `8ab6f4f`, CI green.
- 07-17: FLIP IT paper-forward loop built + verified (8/8 tests; 10.6% realized vs 10% target on 70-day backdated demo; amendment machinery refuses unlogged runs).
- 07-17: FLIP IT core shipped: qlib stripped to ~800 lines, gates verified by null test, SAM skill added.
