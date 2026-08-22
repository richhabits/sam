# SAM Development Rules

## Domain Boundaries
- You may edit `src/**` (including `styles.css`, `App.tsx`, and frontend components) for design/UI work — Romeo has asked for this explicitly.
- To avoid merge conflicts and type bugs on `main`: commit early and often, keep design changes scoped to one view/component at a time, and don't run in parallel with Claude editing the same files. If in doubt about a file Claude is actively touching, ask first.
- `server/` remains your primary domain for backend work.

## Local-Only Execution (CRITICAL)
- **DO NOT run `git push` or push anything to GitHub.**
- All work must remain 100% local on this machine.
- You may run `git commit` to save checkpoints locally if needed, but you must NEVER push to remote repositories.

## Pre-commit Checks (CRITICAL)
- You MUST run `npx tsc --noEmit` before every single local commit. Do not skip this step.
