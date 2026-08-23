# SAM Development Rules

## Domain Boundaries
- You may edit `src/**` (including `styles.css`, `App.tsx`, and frontend components) for design/UI work — Romeo has asked for this explicitly.
- To avoid merge conflicts and type bugs on `main`: commit early and often, keep design changes scoped to one view/component at a time, and don't run in parallel with Claude editing the same files. If in doubt about a file Claude is actively touching, ask first.
- `server/` remains your primary domain for backend work.

## Local-Only Execution (CRITICAL — NO EXCEPTIONS)
- **DO NOT run `git push` or push anything to GitHub. Ever. For any reason.**
- This rule has no implicit exceptions. Romeo approving a push for one commit, in one conversation, does NOT authorize you to push a *different* commit later — even in the same session, even if it's "just" a frontend change, even if tests pass. If you are not looking at an explicit "push this" instruction for the exact commit in front of you, the answer is no.
- All work must remain 100% local on this machine. You may run `git commit` to save checkpoints locally, but pushing to any remote is never your call to make.
- SAM is a **public** repo with a real-money-capable trading engine (`server/flipit-execution.ts` submits live Polymarket orders once API keys are set). An unreviewed push here is not a style violation — it's a compliance and security incident waiting to happen. This actually occurred on 2026-08-22 (commit `ca15e2e`, a FlipIt frontend change pushed without asking) — don't repeat it.

## Pre-commit Checks (CRITICAL)
- You MUST run `npx tsc --noEmit` before every single local commit. Do not skip this step.

## FlipIt Compliance & Modifications (CRITICAL)
- **NEVER** modify or remove the words "mock", "simulated", "paper", or "beta" from `src/FlipItView.tsx`, `src/wallet.ts`, or any FlipIt-related code.
- **NEVER** replace compliance banners (e.g. "Simulated Beta Mode") with claims of a live "Production Market Maker Engine".
- The FlipIt frontend is strictly a simulated interface for FCA compliance purposes. Any automated attempts to "clean up" or "productionize" these disclaimers will result in severe regulatory risk. Consider these files READ-ONLY for any language, disclaimer, or compliance text changes.

## Background Processes & Daemons (CRITICAL)
- **DO NOT run a long-lived background process** (a daemon, a watch loop, anything you start and leave running after you finish responding) **without being explicitly asked to start it.**
- Writing a script is not the same as running it. Committing `scripts/local-automation-daemon.ts` is fine; launching it yourself is not — that's Romeo's or Claude's call, made once the code has actually been reviewed.
- This happened twice on 2026-08-23: the same daemon was launched unprompted, then launched again (as a second, duplicate, un-killed instance) after already being stopped. It touches FlipIt simulation and a job queue with no atomic claim at the time, so two copies running at once was a real (if low-impact, since the queue was empty) race condition, not a hypothetical one.
