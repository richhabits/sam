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

## Fastest first PR (scaffolded — no need to read the source)

```bash
npm run create-tool my_tool           # scaffolds a tool stub + prints where to wire it
npm run create-pack "My Pack"          # scaffolds a shareable .sampack draft
npm run validate-packs                 # runs the same safety gate CI runs on packs
```

Full guides: **[BUILD-A-TOOL.md](docs/BUILD-A-TOOL.md)** · **[BUILD-A-PACK.md](docs/BUILD-A-PACK.md)** ·
**[ADD-A-PROVIDER.md](docs/ADD-A-PROVIDER.md)** · the map: **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Adding a tool
`npm run create-tool <name>`, then implement `run()` and register it in `server/tools.ts`
(`{ name, safe, description, params, run }`). Mark `safe: false` if it changes state; dangerous tools
are gated in `server/authz.ts`. OS-specific tools must degrade cleanly off-platform.

## Adding a pack
`npm run create-pack "Name"` scaffolds it; fill it in, export+sign from inside SAM, then PR it to
[`richhabits/sam-packs`](https://github.com/richhabits/sam-packs). Every pack PR is auto-validated
(structure + signature + the forge static-scan on every tool) — see `docs/BUILD-A-PACK.md`.

## Adding a free provider
One entry in `PROVIDERS` in `server/models.ts` + the env var in `PROVIDER_ENV`. Add it to the key wizard (`src/KeyWizard.tsx` + `KEY_TEST`) if it has a free tier. See `docs/ADD-A-PROVIDER.md`.

## For maintainers: PRs from strangers are safe
Fork PRs can't touch secrets (self-hosted signing jobs are locked to non-fork refs), the pack gate + forge
scan block unsafe code, and required CI must pass before merge. Review the diff; the automation guards the rest.

## Good first issues
Look for the [`good-first-issue`](https://github.com/richhabits/sam/labels/good-first-issue) label — scoped, genuinely useful starters.

## PRs
Small, focused, one concern each. Explain the *why*. Match the surrounding code's style. Run `npm run stats` if you changed tool/agent/provider counts (badges/docs generate from `docs/stats.json`).
