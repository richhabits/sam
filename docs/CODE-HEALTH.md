# Code health (v1.6 clean-code pass)

## Headline
The honest result of the dead-code + dependency audit: **SAM's codebase is already lean.** No "we deleted 30%" flex here — the truth is it was built clean across six release cycles and stays that way. The value of this pass is the *enforcement* (below) that keeps it that way.

## What the scan found

| Check | Tool | Result |
|---|---|---|
| **Unused dependencies** | `depcheck` | **None.** (`cross-env` flags as unused but drives the `build` script; `@playwright/test`/`playwright` are intentionally installed on-the-fly in the e2e job, not in `package.json`.) |
| **Unused exports** | `ts-prune` | 177 raw candidates, but **false-positive-dominated** — nearly all are exports consumed by the server entry (`server/index.ts`), which ts-prune doesn't trace through (verified: `cache.lookup`=10 refs, `classify.route`=12, etc., all live). |
| **Genuinely unused** | manual cross-ref | **3 helpers**, tested but not yet consumed in production: `crypto-vault.isEncrypted`, `remote-tokens.scopeCanMutate`, `remote-tokens.scopeAllowsDangerous`. Kept as intentional API surface (cheap, documented, tested); flagged here for a future YAGNI call. |
| **TODO/FIXME/HACK** | grep | **0** in source. |

## Size
| Surface | LOC |
|---|--:|
| Server (source) | 9,602 |
| Server (tests) | 1,743 (190 tests) |
| React UI (`src/`) | 6,546 |
| Server bundle (`dist/server.mjs`) | 457 KB |

## Enforced going forward (the point of this pass)
- **Self-hosted-runner security**: fork-PR lock in place before the runner exists (see [PIPELINE.md](PIPELINE.md)).
- **CI concurrency**: superseded runs auto-cancel; release builds never cancel mid-flight.
- **Biome — configured, gate pending triage.** `biome.json` is committed with the **linter on** (correctness) and the **formatter deliberately OFF** — reformatting SAM's distinctive dense style is a reviewable aesthetic decision, not one to impose. Baseline against Biome's recommended rules: **231 errors + 7 warnings** (normal for a codebase not born under Biome). Wiring the *blocking* gate needs a one-pass triage: for each rule class, either fix or consciously disable in `biome.json`. That's a your-standards call — flagged, not force-fixed overnight.
- _Still queued:_ `dependency-cruiser` module-boundary rules (no circular deps / cross-layer reach), a `c8` coverage floor, and an Electron bundle-size analysis.

_Regenerate the scan: `npx depcheck`, `npx ts-prune`._
