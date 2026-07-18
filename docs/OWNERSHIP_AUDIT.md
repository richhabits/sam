# Ownership audit — "make sure nothing isn't ours" (2026-07-18)

Romeo's check: everything we added to SAM must be **ours** (owned, not vendored), **simple**, and
**learned-and-adapted from the best** — not bolted-on dependencies. Verified, with receipts.

## Rule we held to every time

Take the **idea**, never the **code**. Where a licence allowed the *content* (CC BY), we ripped it
in and credited it. Where a licence would infect us (AGPL: wigolo), we built our own from scratch
and connected to nothing. Every strip was "learn from the best → rebuild lean as ours."

## Code we put into SAM — dependency audit (grep of every import)

| File | Imports | External dep? |
|---|---|---|
| `server/webintel.ts` | `node:fs`, `node:path`, global `fetch` | **none** (Node stdlib) — and it *removes* the jina.ai reader dependency |
| `server/webintel-extract.ts` | `./webintel.ts` | **none** (our own module + an injected LLM = SAM's brain) |
| `server/colosseum-significance.ts` | `type { Rating } from ./colosseum.ts` | **none** (type-only, SAM-internal) |
| `flipit/tools/blastradius.py` | `ast`, `os`, `sys`, `collections` | **none** (Python stdlib) |
| `flipit/protections.py`, `universe_filters.py`, `warmup_check.py`, `protected.py` | `pandas`, `numpy` | none *new* (flip-it already had them) |

**Zero npm packages added. Zero vendored source. Nothing to `pip install` new.** Net dependencies
went *down* (webintel replaces the external jina.ai service).

## Skills we added — all our own compilations

- `skills/buildx/SKILL.md` — our mentor playbook (idea from build-your-own-x). Ours.
- `skills/codeaudit/SKILL.md` — our review method (What→Why→How, adapted from DeepAudit). Ours.
- `skills/security/SKILL.md` — our self-contained 12-area checklist (adapted from Lissy93, **CC BY,
  attributed**; embedded + offline, no fetch dependency). Ours.

Skills are plain markdown playbooks — no runtime, no deps.

## Config

- `models.ts` MOONSHOT default bumped `moonshot-v1-8k` → `kimi-k2.7-code`. Uses SAM's existing brain
  plumbing; a one-line fix, not a new dependency.

## "Simple" check

Everything is lean and readable: webintel ~110 lines, extract ~95, significance ~90, blastradius
~150, skills are prose. No frameworks, no build steps, no services. SAM stays a small local-first
app that owns its capabilities.

## The discipline half: the "nexts"

AirLLM · ai-engineering-from-scratch · JAX · SwiftLint · Keploy · strix · prompt-kit · reviewdog —
declined, each with the reason on file. Saying *no* to what doesn't fit is how "simple + ours" stays
true; every "next" is bloat avoided.

**Verdict: everything in SAM is ours, dependency-free (or dependency-reducing), simple, and
adapted-not-vendored. Confirmed.**
