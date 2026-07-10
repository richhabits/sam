# SAM architecture

A map for contributors. SAM is a local-first Electron desktop app: a TypeScript/Express backend runs in
the Electron main process and serves a React HUD on `127.0.0.1:8787`. No cloud backend — everything is on
the user's machine.

## Layout

```
electron/     Electron main + overlay + preboot (the desktop shell)
server/       the backend — agent loop, tools, routing, safety, storage
src/          the React HUD (App, Dashboard, panes)
skills/       markdown playbooks the router selects from
packs/        starter .sampack bundles
scripts/      build, bench, release, create-tool
docs/         these docs
```

## The core loop

1. **`routing.ts`** — a model-free classifier picks the relevant tools + skill for a request (semantic).
2. **`agent.ts`** — the doer. Runs the tool loop; **fences untrusted tool output** (injection defense);
   returns a final answer or a `pending` gate for a tool that needs approval.
3. **`models.ts`** — the cascade router: local → free → premium, provider-agnostic (`ADD-A-PROVIDER.md`).
4. **`authz.ts`** — the permission gate. `safe`/`confirm`/`dangerous` tiers; `mayAutoRun`; dangerous
   ALWAYS asks. This is the security spine — read `SECURITY.md`.

## Safety-critical modules (touch with care + tests)

- `authz.ts` — the tier gate. Nothing bypasses it.
- `forge.ts` — self-written tools run in a **separate codegen-disabled process** (not `node:vm`).
- `packs.ts` — signed bundles; import re-runs the full forge pipeline, installs disabled.
- `consent.ts` *(v1.8)* — the autonomy contract: every proactive behavior OFF by default.
- `preferences.ts` *(v1.8)* — learned state is local-only; a tripwire test locks it off the wire.

## v1.8 additions ("Indispensable")

| Module | Role |
|---|---|
| `consent.ts` | What SAM may do on its own — per-behavior toggles, off by default |
| `autonomy-log.ts` | Append-only local record of every autonomous act/suggestion |
| `triggers.ts` | Rules → suggestion cards. Surfaces only; cannot execute a tool |
| `workflows.ts` | Named multi-step sequences; the run engine PAUSES on dangerous steps |
| `starter-workflows.ts` | 6 shipped workflows |
| `preferences.ts` | On-device preference memory; drives local decisions, never prompts |

## Storage

Everything the user owns lives in `vault/` (gitignored): memory DB, life index, forged tools, packs,
consent/autonomy/preferences/workflows JSON. Optional at-rest encryption (scrypt → AES-256-GCM).

## Conventions

- Backend modules are pure where possible + unit-tested (inject the clock/executors, as the v1.8 modules
  do — that's why they're deterministic in tests).
- Never interpolate model/user input into a shell string — `execFile` with an args array.
- New autonomous behavior → register it in `consent.ts` (inherits off-by-default) and log to the autonomy
  log. New dangerous tool → add it to `DANGEROUS` in `authz.ts`.
- Keep it green: `npm run lint && npm test && npx tsc --noEmit`. See `CONTRIBUTING.md`.
