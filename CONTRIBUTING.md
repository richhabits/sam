# Contributing to SAM

Thanks for helping make SAM better! SAM is a free, private, local-first AI assistant by HECTIC.

## Quick start
```bash
git clone https://github.com/richhabits/sam.git
cd sam && npm install && npm start     # http://localhost:8787
npm run dev      # hot reload
npm test         # tests
npx tsc --noEmit # type-check
```

## Ground rules (non-negotiable)
- **Never commit secrets** — no keys, `.env`, or `vault/` contents. CI runs a gitleaks secret-scan that fails the build on any leaked key. `.env.example` holds placeholders only.
- **Keep it free & private** — no telemetry, no phone-home, no paid-provider defaults. User data stays local.
- **Safety tiers hold** — dangerous tools (shell, send, delete, push, payments) must always ask first, even under Autopilot/Swarm. If you touch the tool or auth layer, add a test in the same PR.
- **Tests green + `tsc` clean** before you open a PR. New tools/features tested on the 3-OS CI matrix.

## Adding a tool
One entry in `server/tools.ts` (`{ name, safe, description, params, run }`). Mark `safe: false` if it changes state; dangerous tools are gated in `server/authz.ts`. Add it to the platform matrix if it's OS-specific (it must degrade cleanly off-platform).

## Adding a free provider
One entry in `PROVIDERS` in `server/models.ts` + the env var in `PROVIDER_ENV`. Add it to the key wizard (`src/KeyWizard.tsx` + `KEY_TEST`) if it has a free tier.

## Good first issues
Look for the [`good-first-issue`](https://github.com/richhabits/sam/labels/good-first-issue) label — scoped, genuinely useful starters.

## PRs
Small, focused, one concern each. Explain the *why*. Match the surrounding code's style. Run `npm run stats` if you changed tool/agent/provider counts (badges/docs generate from `docs/stats.json`).
