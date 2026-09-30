# 0001 — FLIP IT is its own app; inside SAM it is an optional MCP add-on

- **Status:** accepted (2026-09-30)
- **Decided by:** Romeo

## Context

FLIP IT started inside SAM (`server/flipit*.ts`, `routes.flipit-scale.ts`, `server/mt5/`,
`src/FlipItView.tsx`, `src/Mt5Pane.tsx`). It has since become its own product with its own
repo (`richhabits/flip-it`), native app, and a **read-only** MCP server (`mcp/flipit_mcp.py`,
12 tools, no tool trades, writes, or takes a path or URL). Keeping trading code in SAM's core
kept tripping the financial-code boundary and App Review, and made SAM look like a trading app.

## Decision

1. SAM's core does not include FLIP IT. Nobody gets it unless they switch it on.
2. SAM connects to FLIP IT the same way it connects to Stripe or Notion: an MCP preset
   (`flipit` in `server/mcp-presets.ts`, "Add-ons" group). Connecting adds FLIP IT's read-only
   tools; SAM can look at the rig, never touch it.
3. The native Apple app (`apple/`) has no FLIP IT screen. Add-ons show up as tools.
4. The preset launches through `python3` rather than a shell, so it works on macOS, Linux and Windows.

## Consequences / follow-ups (separate PRs, nothing deleted without sign-off)

- [x] `flipit` MCP preset + tests.
- [x] Put the built-in FLIP IT HUD pane and `/api/flipit*` routes behind `SAM_FLIPIT_BUILTIN=1`
      (default off), and point the pane at the add-on instead. (Also gates `/api/mt5*` and the
      `flipit_*` / `mt5_*` / `smart_flipit_summary` tools; set `SAM_FLIPIT_BUILTIN=1` to turn it all back on.)
- [ ] Once the add-on covers what the pane showed, move `server/flipit*` and `server/mt5/`
      out of SAM (to the FLIP IT repo) in one reviewed PR, keeping their tests.
- [ ] Other "mini-apps" follow the same pattern: own repo, own MCP server, SAM preset.
