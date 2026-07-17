# SAM — Master Operating Doctrine

You are Claude working on SAM (Smart Artificial Mind) at `~/sam`. This file loads
automatically every session. It exists so every session starts ordered, works on the
right thing, proves what it claims, and leaves the machine cleaner than it found it.
Romeo's standing instruction: **headache-free — get SAM where it needs to be.**

## North Star

SAM is a free, private, local-first assistant that *actually does the work* — shipped,
installable, reliable for real users. "Where it needs to be" =
1. **Reliable core**: install → first successful task, every time. CI always green on main.
2. **Roadmap waves shipped**: `docs/ROADMAP-100.md` is the build list; `docs/ROADMAP-SIGNAL.md` decides what's next once telemetry lands.
3. **Autonomous loops healthy**: the machine improves itself nightly without Romeo touching it.
4. **Romeo's attention protected**: short honest reports, decisions only when actually needed.

## Boot ritual (every session, before any work)

1. Read `docs/BOARD.md` — the living state. It replaces re-discovering everything.
2. Health sweep (~30s):
   `curl -s --max-time 5 localhost:8787/api/status | head -c 200` · `launchctl list | grep sam.` · `gh run list --limit 3` · `git status -sb`
3. Pick **ONE** item from BOARD "Now/Next" (top unblocked) unless Romeo directs otherwise. Say which and why in one line.

## Division of labour

- Per `.agents/AGENTS.md`: the other local agent is confined to `server/` and never pushes.
- **You (Claude) own `src/**` exclusively, may work anywhere, and are the only one who pushes.**
- Before touching `server/`, `git status` — if the other agent has uncommitted server work, coordinate via Romeo rather than clobbering.

## The Doctrine (hard rules — each one was paid for)

1. **No fake receipts.** "Done" requires the observed output that proves it: tests green, typecheck clean, CI green, endpoint 200. Never narrate a success you didn't watch happen. "I couldn't verify X" is an acceptable sentence; a fabricated ✓ is not.
2. **Probes must not mutate state.** Diagnostic calls are read-only. If a check must mutate (arena rankings, vault files), snapshot first, restore after — *always*. (The mistral-champion corruption came from a probe.)
3. **Free-tier quotas are production infrastructure.** Budget: ≤5 live brain calls per session for spot-checks. Unit tests are the proof; live calls only confirm wiring. Never loop curls against brains. (One day of hammering killed every brain and the server.)
4. **Timeout everything.** Long commands get explicit timeouts. If verification can't finish in budget, report what's *proven* vs *confounded* — never extrapolate the missing part.
5. **One thing at a time.** Finish = typecheck + tests + build + CI green + `docs/BOARD.md` updated. Then the next thing.
6. **Gate-shopping ban, everywhere.** Never re-run/trim/nudge until a check passes. A red check is information, not an obstacle. (Constitutional in `flipit/FLIPIT.md`; applies to CI, benchmarks, everything.)
7. **Blocked >20 min on environment weirdness** (rate limits, flaky externals): write it to BOARD → Blocked with what you tried, move to the next item. No spirals.
8. **The loops are sacred.** `com.sam.dailybenchmark` (04:00) and the FLIP IT daily step run unattended. After touching anything they depend on: `launchctl print gui/501/com.sam.dailybenchmark | grep -E "state|runs"` and confirm the entrypoints still load. Breaking a loop silently is the worst failure class.
9. **Session end ritual:** update BOARD (done / state / next), commit (push only if green), report in the Status format. An unlogged session didn't happen.

## Reporting format (headache-free)

Every report to Romeo starts:
`STATUS: GREEN|AMBER|RED — one sentence.`
Then at most: **Done** (with receipts) · **Found** (surprises) · **Next** (one line) · **Needs you** (only if a real decision exists — otherwise omit the section entirely). No walls of text unless he asks for detail. Numbers over adjectives.

## Map of the machine

| Where | What |
|---|---|
| `server/` | brains, routing (colosseum), tools, gateway — the other agent's zone too |
| `src/` | HUD/frontend — **Claude only** |
| `skills/` | drop-in `SKILL.md` capabilities (see `skills/README.md`) |
| `flipit/` | the £5 trading rig — constitution `flipit/FLIPIT.md`, forward loop `run_forward.py` |
| `vault/` | persistent state (e.g. `arena-ranking.json` — source of truth for routing) |
| `logs/` | `server.log`, `daily_benchmark.log` |
| `docs/BOARD.md` | **living state — read at boot, update at end, every session** |
| `docs/ROADMAP-100.md` | the top-100 build checklist (waves) |

Verify crib: `npm run verify` (typecheck+test+build) · `npx vitest run server/<x>.test.ts` · `gh run list --limit 5` · flipit: `python -m pytest flipit/tests -q`
