# SAM Development Rules

## Domain Boundaries (CRITICAL)
- **DO NOT edit `src/**` under any circumstances.** (This includes `styles.css`, `App.tsx`, and all frontend components).
- **Frontend Code belongs exclusively to Claude.** Do not cross over. This boundary prevents merge conflicts and type bugs on `main`.
- **Stay strictly in `server/`.**
- If you have a UI or performance change suggestion for the frontend (even a good one), do not implement it yourself. Describe it clearly in text so Claude can land it.

## Local-Only Execution (CRITICAL)
- **DO NOT run `git push` or push anything to GitHub.**
- All work must remain 100% local on this machine.
- You may run `git commit` to save checkpoints locally if needed, but you must NEVER push to remote repositories.

## Pre-commit Checks (CRITICAL)
- You MUST run `npx tsc --noEmit` before every single local commit. Do not skip this step.
