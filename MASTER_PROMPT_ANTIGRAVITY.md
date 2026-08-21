# SAM — Master Prompt for Antigravity

You (Antigravity, running Gemini) and Claude Code both work on this repo,
`/Volumes/ROMEO HQ/SAM` — `richhabits/sam`, public, MIT. This is the standing
brief for your side of that split. Read it before starting work each session.

## The split — and why it works

- **You own `server/**` and `mobile/**`.** Backend, MCP tools, the yard worker,
  mobile app logic, iOS/Android native layers.
- **Claude owns `src/**`.** Frontend, styling, UI components (FlipIt, Studio,
  Chat, the desktop shell).
- Romeo has been explicit: your `src/**` design work (FlipIt trading desk,
  Studio Director, the chat UI) is what he wants — Claude's instruction is to
  wire it to real data, not redesign it. Keep shipping design work with
  confidence; nobody is going to quietly revert it.
- Don't wait on each other. Commit early and often so the other side can see
  what changed before building on top of it — the worst outcomes this project
  has had were either agent working for hours on a stale view of the repo.

## The actual standing complaint: "SAM is never done right"

That's the thing to fix, more than any single bug. The recurring failure
pattern across this repo's history (see `git log`, and ask Claude for the
specifics if you want them) is **real code that exists but was never wired to
anything reachable** — a feature gets built, looks done in a diff, and then
sits disconnected: never called by the UI, never included in the running
build, guarded by a flag nobody flipped, or exercised only by a test that
imports the wrong (dead) copy of a duplicated route.

So the bar is not "the code compiles" or "the test suite is green" — those
have both been true while the actual feature did nothing. The bar is:

1. **Trace it end to end.** If you build a backend route, confirm something
   real calls it — grep the frontend, don't assume Claude will wire it later,
   and if you build UI, confirm it's mounted somewhere a user actually
   reaches (not just defined).
2. **Verify in the running app, not just in a test.** Start the server, hit
   the route with curl or drive the UI in a browser. A green test has, more
   than once, mocked past the exact thing that was actually broken.
3. **No silent failures.** An operation that "succeeds" while changing
   nothing is a bug and must surface — this has been SAM's single most
   common failure class historically (dead route duplicates, unregistered
   handlers, flags left off by default with no UI to turn them on).
4. **Before marking something done, ask: is there a duplicate/dead copy of
   this route or handler that a test might be exercising instead of the real
   one?** This has happened more than once — the fix landed, tests stayed
   green, and the live bug remained live because the test imported the
   unreachable handler.

## Open items worth picking up

- **Firecrawl MCP `E404`.** `@mendable/firecrawl-mcp-server` fails npm
  registry lookup on boot (`npm error 404`). This is yours — Claude saw it in
  a server log but has no access to fix MCP config.
- **ghostdetail Vercel admin-credential rotation** — flagged weeks ago as
  outstanding (a published admin token needed rotating on Vercel). If that's
  done, close it out; if not, it's overdue.
- Anything currently flag-gated off that's actually finished and proven —
  worth a pass to check whether it should be flipped on for real, per the
  slice workflow (investigate → smallest flag-off slice → prove live at zero
  quota → turn on + prove again).

## Working rules that apply to both of us

- **No credit-burning tests.** Local Ollama or mocks — the free-tier routing
  is the product; tests that burn paid quota undermine the thing SAM sells
  itself on.
- **Local-first, no phone-home.** Redact secrets from anything logged.
- **Every new behavior gets a test AND gets driven live once.** Neither
  alone is sufficient — see point 2 above.
- Destructive/large/cross-cutting changes: say what you're about to do before
  doing it. Silent is the enemy here specifically because "silent" is the
  exact shape of SAM's historical bugs.

## What "done" looks like

Not "I wrote the code." Not "tests pass." It's: the feature is reachable from
somewhere a real user or the real app actually goes, it was exercised live
(browser, curl, or the packaged app — not just unit tests), and if it's
flag-gated, the flag path to turning it on for real is documented or already
flipped. If you're not sure a change clears that bar, say so rather than
reporting it as finished — Romeo would rather hear "this is 80% there, X is
unverified" than find out three weeks later nothing was ever wired up.
