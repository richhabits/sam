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
