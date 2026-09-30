// FLIP IT is its own app now and an optional MCP add-on (docs/decisions/0001-flipit-is-an-add-on.md).
// The built-in desk (routes, tools, HUD pane) is still here but OFF unless SAM_FLIPIT_BUILTIN=1.
import type { NextFunction, Request, Response } from "express";

export const flipitBuiltinEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.SAM_FLIPIT_BUILTIN === "1";

export const FLIPIT_ADDON_HINT = { error: "FLIP IT is an add-on now — connect it in Add-ons", addon: "flipit" } as const;

// Tools that belong to the built-in desk; left out of TOOLS when it is off.
export const isFlipitBuiltinTool = (name: string): boolean => /^(flipit_|mt5_)/.test(name) || name === "smart_flipit_summary";

// Mounted on /api/flipit and /api/mt5 (prefix match, so every sub-route is covered, registered or not).
export function flipitBuiltinGuard(_req: Request, res: Response, next: NextFunction): void {
  if (flipitBuiltinEnabled()) { next(); return; }
  res.status(404).json(FLIPIT_ADDON_HINT);
}
