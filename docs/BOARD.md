# BOARD — SAM living state

*Read at boot, update at session end (CLAUDE.md doctrine #9). Newest truth wins; keep it
honest and short. Last updated: 2026-07-18 02:13 BST, by the Cowork session (master-prompt
landed + reconciled + watchdog wired + full audit & zero-warning sweep).*

## Loops (the machine running itself)

| Loop | When | Proof it ran | State |
|---|---|---|---|
| Colosseum nightly benchmark (`com.sam.dailybenchmark`) | 04:00 daily | `~/sam/logs/daily_benchmark.log` new line + `vault/arena-ranking.json` fresh | Installed, entrypoint `~/sam/scripts/daily_benchmark.sh` verified. **First real firing: 2026-07-18 04:00** (still ~4h out at last update). `runs=0` is correct until then |
| FLIP IT forward step (`com.flipit.dailystep`) | daily | `~/flip-it/logs/daily_step.log` new block + `~/flip-it/state/forward_mom_12_1.json` grows | **Live.** Separate repo at `~/flip-it` (NOT `~/sam/flipit`), entrypoint `~/flip-it/scripts/daily_step.sh` verified. Fired cleanly 07-17 (11:08, 22:00). `mom_12_1` **wired** (state file present, target_vol 0.1, cutoff 2025-05-06). 0 forward days yet — armed, waiting for first post-cutoff trading bar |

## Now (in flight)

- **Colosseum**: fixed + merged on `8ab6f4f` (champion pinned first · tested > untested · ≥2-brain guard), 16 unit tests, CI green. **Waiting on first clean nightly (07-18 04:00)** for the live proof yesterday's drained quotas blocked. Until quotas reset: no live brain hammering (Doctrine #3). Ranking on disk correct: groq 1115 / cerebras 963 / hermes 961 / nvidia 960 (matches last champion log line).
- **FLIP IT paper-forward** @10% vol under Amendment A-001: extended Gate 2 = 60 forward days + 20 closed trades + in-band + beats-costs. Loop is live and `mom_12_1` is wired; clock is months, not days — that's by design. Nothing owed here until the forward gate is met.

## Next (top unblocked, in order)

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

*(none — the nightly proves itself; FLIP IT sign-off only becomes due if/when the forward gate is met)*

## Recently done (receipts)

- 07-18: **v2.1.4 "Brakes" SHIPPED** (Latest, signed+notarized, all assets + auto-update manifests, real SHA-256 in notes). Two fixes for the runaway/loop bug Romeo hit: (1) **stop-word** — "stop"/"shut up"/"stop listening" instantly halts SAM (typed or spoken), never sent to the brain, interrupts mid-stream (`src/lib/stopIntent.ts`, 77 tests); (2) **repetition guard** — cuts off degenerate model loops at the stream source + collapses the tail (`server/repetition.ts`, 17 tests). 379 tests green. Deliberately skipped frequency_penalty (unverifiable across ~40 providers, some 400 on it).
- 07-18: **v2.1.3 "Colosseum" SHIPPED** (Latest, signed+notarized) — the backlog wave merged-but-unreleased since v2.1.2 (Colosseum Elo routing, Markets, memory panel, render_video + 5 file tools, Bestie/Mentor personas, capability-scoped skills, settings redesign) + tonight's zero-warning hardening. Real SHA-256 in notes.
- 07-18: **Full audit + zero-warning sweep.** Whole-repo biome lint 315 → **0** across 4 commits (`8610ed3` buttons, `c6b9007` a11y-interactions, `e83a584` src hooks/keys/iterables, `a314f35` server). Real fixes where genuine (185 `type=button`; braced void `forEach`s; `parseInt(…,10)`; regex `while`→`for`; un-nested comma-operator cache in world.ts), documented `biome-ignore` where intentional (modal backdrops w/ Esc, mount-once effects, index-is-identity lists). Verified each batch: typecheck + 285 tests + build green; FLIP IT 28 tests green; `npm audit` 0 vulns. Also: pruned stale `origin/fix/telemetry-loopback` (already merged), confirmed GitHub branches = just `main`. Open threads for Romeo: external PR #20 (`--version`; SAM has no CLI `bin`, may not fit), rolling draft release v2.1.3 (Release Drafter — publish or leave).
- 07-18: Two-sided nightly watchdog wired. **Cloud** (`trig_01NSKNi9Kzhgq3itShZyyDd5`, cron `0 7 * * *` = 08:00 London): reads GitHub Actions on `richhabits/sam` main, pings only on red, silent on green — a smoke alarm, never a builder. **Mac** (`scripts/daily_benchmark.sh`, pushed `d3f3d39`): fires a macOS notification when SAM is down at benchmark time or the arena writes no champion line; best-effort osascript, guarded so it can't break the loop; verified loop still loads (`runs=0`, program /bin/bash). Cloud watches GitHub; Mac watches Mac.
- 07-18: Master-prompt landed on the Mac — `CLAUDE.md` (doctrine, auto-loads every session) + `docs/BOARD.md` (this file) created on `main` @ `8ab6f4f`. Reconciled BOARD against verified reality: FLIP IT lives at `~/flip-it` (sibling repo), both loops have verified entrypoints, `mom_12_1` already wired.
- 07-17: Colosseum routing order fixed (3 real bugs: spread-load rotated the champion; unranked leapfrogged tested losers; 1-brain benchmark corrupted ranking). 16 tests, merged `8ab6f4f`, CI green.
- 07-17: FLIP IT paper-forward loop built + verified (8/8 tests; 10.6% realized vs 10% target on 70-day backdated demo; amendment machinery refuses unlogged runs).
- 07-17: FLIP IT core shipped: qlib stripped to ~800 lines, gates verified by null test, SAM skill added.
