# Design audit — 2026-07-18

Measured, not opined. Every number below came from a script over the tracked source, and the
commands are in this file so you can re-run them. **Nothing here is a crisis** — SAM's structure
is sound: no god-object tangle, consistent error envelopes, a clean `src/`↔`server/` boundary.
These are the four things worth knowing, in priority order.

## 1. Silent error handling is the dominant pattern — and it caused a real bug today

```
documented catches (comment inside):  85
bare / silent catches:               129   ← 60%
worst: App.tsx 43 · tools.ts 14 · index.ts 13 · Admin.tsx 10 · Dashboard.tsx 6
```

**Why it matters, concretely.** Settings' provider list moved server-side today, and
`refresh()` ended in `.catch(() => {})`. The result: an unreachable server rendered an **empty
Settings panel**, indistinguishable from "SAM has no providers". Nobody would have found that
from reading the code — the swallow *looks* deliberate.

Many of the 129 are legitimately best-effort (telemetry, warm-up, "never break the loop"
guards). That is exactly the problem: **a deliberate swallow and an accidental one are
byte-identical**, so review can't separate them and neither can a future session.

**DONE for `src/` — 79 sites, 0 bare catches remain.** Not a blanket comment sweep: each was
classified, and **seven were hiding user-visible failures**, now surfaced —
  · **Elon Mode and Autopilot toggles** flipped in the UI even when the server write failed, so
    the switch showed a state SAM was not in. They now revert and say so.
  · **The onboarding key** was dropped silently — the user finished setup believing SAM was
    configured when it wasn't. The worst version of this bug, and the exact class that bit
    Settings today.
  · **Memory delete** looked successful while the row stayed stored.
  · **Arena reset** cleared the panel while routing kept steering by the "removed" champion.
  · **Markets quotes** and **the crew roster** rendered empty on failure — "no data" and
    "couldn't reach it" were indistinguishable.

The other 72 are genuinely best-effort and now say *why* in one line (notifications denied,
idempotent teardown, corrupt localStorage, background poll retries next tick). **`biome.json` enables `noEmptyBlockStatements` as an
error REPO-WIDE**, so a new bare catch fails lint — verified by adding one in `src/` and again in
`server/`.

**`server/` swept too — finding #1 is closed. 0 bare catches repo-wide, 171 documented.**
Server's dangerous class was different: not lying UI, but **silent write failures**, where the
caller believes state was persisted.
  · **`authz.ts` — standing authorizations.** A failed write meant the in-memory grant/revoke
    diverged from disk, so on the next boot a **revoked authorization could come back**. Now
    logged loudly (not thrown — doctrine #8 keeps the loops alive).
  · **`scheduler.ts`** lost the user's schedules on restart with no trace · **`memory.ts`** let
    the *next* named user silently become owner · **`swarm.ts`** lost state (in-memory stays
    authoritative, so cost is persistence, not correctness).

The other ~40 are genuinely best-effort and now say why: provider fallback chains (pexels →
pixabay → …), malformed SSE chunks skipped so the stream continues, idempotent teardown,
absent-config-file defaults. Also swept `electron/` and `scripts/` (17) and documented 9 empty
*callbacks* the rule correctly flagged but which were never swallows — so the rule holds
repo-wide with **zero exceptions**.

## 2. Three files hold 37% of the code

```
server/tools.ts   2513 lines
src/App.tsx       1840
server/index.ts   1770
                 ─────
                  6123 of 16397 total
```

`tools.ts` is defensible — it is a registry of ~181 tools, and a list is allowed to be long.
`index.ts` (132 routes) and `App.tsx` are the ones worth splitting, and the natural seams are
already visible: `index.ts` groups cleanly by domain (admin, memory, arena, media, remote), and
`App.tsx` mixes onboarding, chat, and panes.

**Started, deliberately one slice.** All four cheap sections are out — `routes.memory.ts` (4 routes),
`routes.workflows.ts` (5), `routes.voice.ts` (1), `routes.creative.ts` (1). **`index.ts`
1770 → 1638**, and every route is accounted for. Small on purpose: the value of this first cut is the *pattern
and the map*, not the line count.

**The pattern:** a `registerXRoutes(app)` function, not an Express `Router`. A Router with a
mount point would have changed the route paths; passing `app` keeps paths and registration order
byte-identical, so an extraction can never silently move an endpoint.

**The map — measured coupling, so the next slice is chosen rather than guessed.** "shared" =
`index.ts`-local identifiers a section closes over; those must be threaded before it can move.

| section | lines | routes | shared | cheap to extract? |
|---|---|---|---|---|
| Memory dashboard | 60 | 9 | **1** | ✅ done → `routes.memory.ts` |
| Workflows | 36 | 5 | 1 | ✅ done → `routes.workflows.ts` |
| ElevenLabs voice | 42 | 1 | 1 | ✅ done → `routes.voice.ts` |
| Creative Space proxy | 34 | 1 | 1 | ✅ done → `routes.creative.ts` |
| ADMIN keys & config | 169 | 8 | ~~8~~ **2** | ✅ done → `routes.admin.ts` |
| Generated-image cache / Studio | 153 | 12 | 2 | ✅ done → `routes.studio.ts` |
| People / faces | 114 | 15 | ~~8~~ **1** | ✅ done → `routes.people.ts` |
| Rollback + bench/ios/update/status | 74 | 8 | 4 | ❌ **not a section** — see below |
| MAIN COMMAND LOOP | 118 | 1 | **11** | ❌ deeply coupled — leave it |

**Also fixed here, and it is the interesting part:** `routes.contract.test.ts` read *only*
`index.ts`, so the moment 4 routes moved out it silently stopped covering them — a test shrinking
its own scope with every extraction while still reporting green. It now scans `index.ts` plus
every `routes.*.ts`, and asserts an extracted route is among them.

**And a second hole in the same test, found by extracting Creative Space:** its route matcher read
`app.(get|post|delete|put|patch)` — so **`app.all` was invisible**, and the one route using it was
the muapi *proxy*: a wildcard path, an outbound credential, and hand-rolled SSRF sanitisation. The
single route in the repo most worth contract-checking was the one route the contract test could not
see, and it read green the whole time. Matcher widened to include `all`; verified by breaking the
proxy's error envelope and watching the test go red (it stayed green before the widening).

**Then the proxy's actual SSRF filtering got tested too — `routes.creative.ssrf.test.ts` (5).** The
guard is now a pure exported `isSafeCreativePath()` that the route calls, because a test
re-declaring the regex would only prove a copy matches itself. The assertions are on the outbound
**host** (`https` + `api.muapi.ai` + no credentials), not on the boolean — an intent-level property
that survives a rewrite of the guard, and one that swept every code point 0x00–0x2ff.

That property immediately earned itself: **my first draft asserted `//evil.com/x` was rejected. It
isn't** — it is only slashes and letters, so it passes the charset. It is harmless for a reason
worth writing down, because the reason is fragile:

```
concatenated:  "https://api.muapi.ai/api/v1/" + "//evil.com/x"   -> api.muapi.ai  ✅
resolved:      new URL("//evil.com/x", ".../api/v1/")            -> evil.com      ❌
```

**The route's safety rests on a property of string concatenation.** Tidying it into the more
idiomatic `new URL(path, base)` would hand an attacker the muapi key while making the code look
*better*. Both branches are now pinned, including the counterfactual, so that refactor fails loudly
instead of silently. Verified by neutering the guard to `return true` — two assertions go red.

**One caveat learned the hard way:** the coupling table counts `index.ts`-*local* identifiers,
which is the right measure for "can this move", but an extracted section also needs its
**imports** to travel. `routes.workflows.ts` needed seven names the table never showed
(`getWorkflow`, `dangerousStepsIn`, `recordRun`, `recordWorkflowRun`, `Tier`, `Workflow`,
`runModel`). Typecheck catches every one immediately, so this costs a minute — but budget for it.

**The split is finished: `index.ts` 1770 → 1210 (−32%), 7 route modules, 132 routes preserved
exactly at every step.** Two sections were extracted only after the things they *shared* moved
first — `isLoopback` (used 32×, the gate on every privileged write) into `http-guards.ts`, and
`writeEnv`/`ENV_PATH` (5 callers) into `env-file.ts`. `PORT` was **injected**
(`registerPeopleRoutes(app, PORT)`) rather than promoted to a shared module, so index.ts stays
the single place the port is decided.

**The coupling table was wrong in both directions, and that is the lesson.** It said ADMIN shared
8 identifiers; the real number was 2. It said People shared 8; really 1. Yet it *under*-counted
imports on workflows. It measures one thing (index-local declarations) and was read as if it
measured difficulty. **Use it to pick a candidate, never to estimate the work.**

**Where it stopped, deliberately.** What is left around the old ROLLBACK marker is not a section —
it is rollback + bench + ios + update-check + update + status + keys + capacity, needing
`BENCH_MODE`, `SKILLS`, `User` and `git` threaded through it. Extracting that buys line count and
costs cohesion, which is the opposite of the point. Also noted and *not* touched:
`app.post("/api/schedules/:id/toggle")` is stranded at the end of the notebooks block, away from
the other schedules routes. Moving a route during an extraction is how registration-order bugs get
introduced — separate change or none.

**`App.tsx` (1840) and `tools.ts` (2513) untouched.** `tools.ts` is a 181-entry registry and long
by nature — splitting it buys little. `App.tsx` shares state across onboarding/chat/panes, so it
needs prop or context threading, which is a different and riskier job than moving routes.

## 3. Twelve of 24 sizeable modules have no direct test

```
NO test file, largest first:
  1840  src/App.tsx          ← onboarding + chat + panes
  1770  server/index.ts      ← all 131 routes
   423  src/Admin.tsx        ← settings, key entry
   281  server/swarm.ts
   230  src/lib/api.ts       ← the entire client API surface
   195  src/VoiceMode.tsx
   187  src/StudioView.tsx
   181  server/p2p.ts
```

417 tests pass, so this isn't "untested code" — much is covered indirectly. But the **client API
surface (`src/lib/api.ts`) and the route layer (`index.ts`) have no direct tests**, and those are
precisely where today's defects landed: a 400 the UI ignored, a loopback gate that was missing, a
save handler that reported success on failure. All three were found by *reading*, not by a test.

**Done — `server/routes.contract.test.ts` (6 assertions).** Static over the source, because
`index.ts` calls `app.listen()` at module scope with no export, so importing it in a test would
boot a real server. It pins: no duplicate registrations · **every privileged write is
loopback-gated** (the 10 routes that call `writeEnv`/`setAllow`/token ops) · every error response
uses one of the two documented envelopes · everything lives under `/api` · no GET mutates
privileged state. Each assertion was verified by reintroducing its bug — removing the
`/api/admin/keys` gate, registering a duplicate route, and returning `{message}` instead of
`{error}` each turn it red. **If `app` is ever exported, replace this with supertest and drive
the real handlers — strictly better.**

## 4. Two real circular imports (and one false alarm)

```
forge.ts    ⇄ tools.ts    REAL — forge imports TOOLS (a value); tools imports forgeTool()
selftest.ts ⇄ tools.ts    REAL — selftest imports TOOLS; tools imports runSelftest()
metrics.ts  ⇄ models.ts   NOT a cycle — metrics uses `import type { Tier }`, erased at compile
```

The two real ones survive because ESM tolerates them, but they make initialisation order
load-bearing and undocumented: `tools.ts` is mid-evaluation when it reaches into a module that
is itself waiting on `TOOLS`. It works today; it breaks confusingly if either file is
reorganised.

**FIXED — both cycles gone, `server/imports.cycle.test.ts` (3 tests) stops them returning.**
Inverted rather than papered over, and differently for each because their needs differ:
  · **`selftest`** only read `TOOLS.map(t => t.name)`, so it now **receives** the list:
    `runSelftest(tools)`. Its own CLI entry uses a *dynamic* import — resolved at call time, when
    `tools.ts` is fully evaluated — so the convenience of running it standalone didn't restore
    the cycle.
  · **`forge` mutates the registry** (it splices and pushes forged tools at runtime), so a
    parameter would have rippled through 7 call sites including `index.ts` and the tests.
    Instead `tools.ts` calls `bindToolRegistry(TOOLS)` immediately after the array exists, and
    forge **throws** if anything reaches it unbound — a silent no-op would mean forged tools
    quietly never register, which looks exactly like "the user has no forged tools".

The guard excludes `import type` deliberately: it is erased at compile time and cannot create a
runtime cycle, which is why `metrics ⇄ models` was never one. Verified by reintroducing the
`selftest` import and watching two assertions go red.

## What is genuinely healthy

- **Error envelopes are consistent — fully, on a closer look.** 81 of 83 use `{ error }`; the
  rest use `{ kind: "final", text }`, which is not an outlier but the **chat protocol** envelope,
  so a mid-stream failure renders as a friendly message instead of a raw error. (`/api/quotes`
  looked like a third case and isn't — it returns `{ quotes: [], error }`, and my first regex
  only read the leading key.) **Zero violations.** Now enforced by `routes.contract.test.ts`.
- **No import tangle**: the most-imported modules (`models` 11, `tools` 6, `keys` 6, `authz` 6)
  are the ones you would expect to be shared. No hub-and-spoke mess.
- **`src/` never imports `server/`** — the boundary held even through today's registry refactor,
  which is why the UI gets its provider list over HTTP rather than by reaching across.
- **Provider identity is now a single registry** (43 entries) with 8 drift tests enforcing it.
  That was five hand-maintained lists this morning.
- **Security model is coherent**: privileged writes are loopback-only, the remote gate uses
  `timingSafeEqual` with per-IP backoff, and `/api/keys` exposes counts with zero key material.

## Re-run the numbers

```bash
# catches, coverage, coupling
python3 - <<'EOF'
import re, subprocess, os, collections
files=[f for f in subprocess.run(["git","ls-files"],capture_output=True,text=True).stdout.split()
       if re.search(r'^(server|src)/.*\.(ts|tsx)$', f) and ".test." not in f]
doc=bare=0
for f in files:
    t=open(f,encoding="utf-8").read()
    for m in re.finditer(r'catch\s*(?:\([^)]*\))?\s*\{([^}]{0,40})', t):
        s=m.group(1).strip()
        doc += s.startswith(("/*","//")); bare += s==""
    bare += len(re.findall(r'\.catch\(\(\) => \{\}\)', t))
print("documented:", doc, "silent:", bare)
EOF
```
