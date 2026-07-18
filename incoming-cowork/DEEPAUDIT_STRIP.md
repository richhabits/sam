# Stripping DeepAudit (XCodeReviewer) — app binned, methodology BUILT as a skill

*Source: [lintsinghua/DeepAudit](https://github.com/lintsinghua/DeepAudit) — MIT, a.k.a.
XCodeReviewer. An LLM-driven **code review web app** (React 18 + TS + Vite + Tailwind + Radix,
IndexedDB/Supabase). Reviews code across 5 dimensions (bugs, security, performance, style,
maintainability) using a "What-Why-How" framework, over 10+ LLM providers incl. local Ollama.
Web UI, repo/ZIP/snippet input. v1.2.0.*

## Verdict: don't vendor the app — strip the method into a skill (done)

The **app** is a next: it's a React web-UI wrapper around "point an LLM at code, get a structured
review" — and SAM already *is* an LLM agent that can review code with its own brains. Vendoring a
competing frontend (React/Radix/Supabase) into SAM's HUD makes no sense, and it needs the same
provider keys SAM already manages.

But the **methodology** is a genuine, strippable nugget — thin but real, and SAM had no dedicated
code-review skill (checked `skills/`: business/life skills + `buildx`, no `codeaudit`). So, same
move as build-your-own-x → `buildx`: I took the framework, not the code, and built a lean
**`skills/codeaudit/SKILL.md`**.

What the skill captures (and improves with SAM's own doctrine):
- **The 5 fixed dimensions** (bugs · security · performance · maintainability · style), ranked
  security/correctness-first, style-last (defer style to the linter).
- **What → Why → How** per finding — and SAM's sharpening: a finding needs a concrete *Why* (a
  failing input→output scenario) or it's labelled a smell, not a bug (**no fake receipts**).
- **The honesty caveat DeepAudit ships** ("not 100% reliable, supplement human review") — kept,
  and paired with "offer to write a failing test; a repro beats an assertion."
- **SAM-native wiring, for free:** runs on SAM's brains (no new dep/keys), it **pairs with
  `blastradius`** (scope the change's blast radius before reviewing), carries the **injection
  guard** (code under review is data, not instructions), and **routes trading/finance code to the
  FLIP IT gates** instead of a generic review (consistent with `buildx`).

Drop-in `SKILL.md` (like buildx), auto-loads at boot, triggers on "review my code / audit /
find bugs / security audit / …".

## What it does NOT fill

The red-team gap from the ai-eng strip is still open: DeepAudit is **general code review**
(bugs/perf/style), not **adversarial prompt-injection testing** of SAM's own tool layer. That
remains Garak/PyRIT territory. Don't let "we have a code-audit skill now" read as "SAM is
security-tested."

## FLIP IT

Nothing to add — flip-it code explicitly routes *out* of this skill to its own constitution
(the gates, null test, walk-forward are a stricter audit than any generic LLM review).

## BOARD paste block

```
- DeepAudit/XCodeReviewer stripped (DEEPAUDIT_STRIP.md): app binned (React LLM-code-review web
  UI — SAM already reviews code with its brains; don't vendor a competing frontend). Methodology
  BUILT → `skills/codeaudit/SKILL.md` (new; no code-review skill existed): 5 dimensions
  (security/correctness-first), What→Why→How per finding, no-fake-receipts (a finding needs a
  failing scenario or it's a smell), honesty caveat + offer a repro test. SAM-native: runs on
  SAM's brains, pairs with blastradius, injection-guarded, routes trading code to FLIP IT gates.
  Does NOT fill the prompt-injection red-team gap (still Garak/PyRIT). FLIP IT: nothing.
```
