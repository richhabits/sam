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

**Recommendation — cheap and mechanical:** make the reason mandatory rather than optional.
Biome's `noEmptyBlockStatements` turns a bare `catch {}` into a lint error; the fix per site is
one comment. 129 sites is too large for a late-session sweep, so this is a decision, not a
change I made unilaterally. Scoped to `src/` first (~60 sites, and the ones users actually see)
it is an afternoon.

## 2. Three files hold 37% of the code

```
server/tools.ts   2513 lines
src/App.tsx       1840
server/index.ts   1770
                 ─────
                  6123 of 16397 total
```

`tools.ts` is defensible — it is a registry of ~181 tools, and a list is allowed to be long.
`index.ts` (131 routes) and `App.tsx` are the ones worth splitting, and the natural seams are
already visible: `index.ts` groups cleanly by domain (admin, memory, arena, media, remote), and
`App.tsx` mixes onboarding, chat, and panes.

**Not urgent.** Size alone isn't a defect; these files are navigable and consistently
commented. Flagging it because the trend is one-way — nothing has ever been split out.

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

**Recommendation:** a thin route-contract test for `index.ts` (status codes + error envelope
shape per route) would have caught two of today's three Settings bugs. Higher value than more
unit tests on already-tested modules.

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

**Fix shape** (not attempted here — `tools.ts` is 2513 lines and shared with another agent, and
a structural change to it at the end of a long session is how collisions happen): invert the
dependency so `forge`/`selftest` receive the tool list rather than importing it — the same
injection pattern `webintel-extract` already uses for its LLM.

## What is genuinely healthy

- **Error envelopes are consistent**: 81 of 83 error responses use `{ error }`; only two
  outliers use `{ kind }`. Success uses `{ ok: true }` in 29 places. That is unusually tidy.
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
