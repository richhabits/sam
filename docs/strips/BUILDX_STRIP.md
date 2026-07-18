# Stripping build-your-own-x — the honest verdict

*Source: [codecrafters-io/build-your-own-x](https://github.com/codecrafters-io/build-your-own-x)
— ~300+ tutorials across 31 categories (3D renderers to web servers), all links to
guides/articles, zero code to vendor.*

## Verdict

This repo is a **curriculum index, not code** — there is nothing to port, only something
to *point at*. Its entire philosophy ("understand it by building a small one yourself")
is already this project's operating method: qlib (56k lines) → our own 800-line
backtester; freqtrade (65k) → our own 300-line protections. We didn't strip
build-your-own-x so much as recognize it as the doctrine we were already running.

## What SAM takes

**`skills/buildx/SKILL.md`** (shipped) — a build-mentor skill: user says "I want to build
my own X" → SAM picks the right tutorial from the catalog live, frames an honest toy
scope, and runs a milestone plan where **every milestone ends with running proof** (the
no-fake-receipts doctrine applied to learning). Uses only tools SAM already has
(read_webpage, write_file ask-first, create_note, remember_fact). This upgrades the
`learn` pack from explaining to building — the strongest teaching mode there is.

One rule wired in deliberately: finance/trading builds do NOT get the toy treatment —
they route to the FLIP IT constitution and its gates. No side door to money via "just
learning".

## What FLIP IT takes

**Nothing direct — and saying so is the point.** No trading category exists in the
catalog, and inventing a flip-it angle would be a fake receipt. FLIP IT's inheritance is
the method itself, already applied twice with receipts (QLIB_STRIP.md, FREQTRADE_STRIP.md).

## Binned

Nothing to bin — but one standing rule from this strip: **tutorials never become
dependencies.** The catalog is an index SAM reads live, not 300 links pasted into a
prompt that rot in place.

## BOARD paste block

```
- build-your-own-x stripped (BUILDX_STRIP.md): it's a curriculum index — shipped
  skills/buildx SKILL.md (build-mentor with proof-gated milestones; finance builds
  route to FLIP IT gates). FLIP IT takes nothing direct, by honest design.
```
