# Stripping code-review-graph — the first one worth actually building from

*Source: [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) — MIT,
Python. A real, runnable CLI/MCP tool (not a curriculum): Tree-sitter parses your code into an
AST, a SQLite knowledge graph stores functions/classes/imports + their edges, and "blast-radius
analysis" answers *given this change, which files/tests does it actually touch?* — feeding
minimal context to AI coding tools. Claims 8.2× token reduction. 28 MCP tools, a daemon, watch
mode, optional embeddings/community-detection/wiki-gen.*

## Verdict

**A genuine idea, worth taking — and unlike the last three repos, there's something to build.**
The idea is *blast radius*: before an AI (or a human, or a second session) touches a symbol,
know its callers, dependents, and the tests that cover it. That's real value on three axes we
actually have. So I stripped the idea and **built a lean version** — `blastradius.py`, ~150
stdlib-`ast` lines, no Tree-sitter / SQLite / daemon / MCP — and verified it on the flipit tree.

## Nicked → `blastradius.py` (built + verified)

The one idea, three uses, all demonstrated on `~/flip-it`:

**1. Dependency safety** — `python blastradius.py <root> backtest`:
```
BLAST RADIUS — symbol 'backtest'   defined in: flipit/engine.py
direct callers / dependents (4 files):
  flipit/forward.py    → simulate
  flipit/overlay.py    → book_vol_target_exposure
  flipit/protected.py  → _active_mask
  run.py               → cmd_backtest, cmd_nulltest
test coverage (2 files): tests/test_core.py, tests/test_protected.py
risk: MEDIUM — 4 dependents.
```
Accurate — it even found `protected._active_mask`, the code added this session. *This* is what
you'd want before changing the engine's `backtest` signature: the four things that break.

**2. Code health** — `--hotspots` ranks symbols by callers × test-gap. On flipit it surfaced a
real finding: `_wide`, `Strategy`, and `BacktestResult` are among the most-depended-on symbols
with **no test that names them directly** (they're tested only transitively, through `backtest`).
That's an honest "add a direct test / handle with care" signal, produced automatically.

**3. Token reduction for AI review** — the original's headline. The dependents+tests set for a
change *is* the minimal file list an AI should read, instead of dumping the repo. The lean
version gives that list; wiring it into SAM's review path is where the 8.2× would come from.

## Honest scope of the lean build

Python-only (Tree-sitter did many languages); **name-resolved** (a call to `backtest` matches
any def named `backtest` — no type resolution, so a same-named method elsewhere could
false-match); direct-naming test coverage (transitive coverage reads as "untested"). It flags
risk well; it is not a compiler. The original's SQLite graph + incremental re-parse + 28 MCP
tools are the production version of this — worth adopting *only if* SAM wants a standing code
graph, which is a bigger decision than one file.

## What SAM takes

- **`blastradius.py` as a candidate SAM dev-tool / skill:** "before you edit X, show its blast
  radius." Fits SAM's tool layer (`server/tools.ts` already has `find_files` et al.) and its
  local-first ethos (SQLite/AST stays on device — no cloud, like the original). Delivered
  standalone + verified; wiring into `server/` is the reviewed step (shared territory).
- **The token-reduction pattern** for SAM's own code work: when an agent reviews a change,
  feed it the blast-radius file set, not the whole tree.
- The 2-session collision this week is *adjacent*: blast radius raises care on shared symbols,
  but the actual fix for concurrent edits is git + the doctrine's coordination note. Said
  plainly so nobody oversells the tool.

## What FLIP IT takes

Direct, immediate use — it's a small Python package where correctness is everything.
`blastradius.py flipit engine` before touching the engine, and `--hotspots` as a pre-commit
sanity check, both work *today* (verified above). The hotspot finding (`_wide`/`Strategy`/
`BacktestResult` under-named-by-tests) is a real, actionable flip-it code-health item.

## Binned

The daemon + watch-mode + multi-repo orchestration (SAM/flip-it are single repos), ollama
wiki-generation, igraph community detection, sentence-transformers embeddings (nice for
semantic search, but a heavy dep for the marginal gain here), and vendoring their 28-tool MCP
server wholesale (SAM has its own tool layer — take the idea, not the server).

## BOARD paste block

```
- code-review-graph stripped (CODEGRAPH_STRIP.md): first strip with real buildable value.
  Idea = blast radius (callers/dependents/tests of a change). Built lean `blastradius.py`
  (~150 stdlib-ast lines, no tree-sitter/sqlite/daemon), verified on ~/flip-it: `backtest`
  → 4 dependents incl. protected._active_mask + 2 tests; `--hotspots` surfaced a real
  code-health finding (_wide/Strategy/BacktestResult high-dependency, no direct test).
  SAM: candidate dev-tool/skill + token-reduction for AI review (wiring into server/ is the
  reviewed step). FLIP IT: usable today as a pre-edit/pre-commit guard. Landed in
  incoming-cowork, unwired.
```
