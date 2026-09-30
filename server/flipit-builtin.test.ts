import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flipitBuiltinEnabled, flipitBuiltinGuard, isFlipitBuiltinTool } from "./flipit-builtin.ts";
import { registerFlipItScaleRoutes } from "./routes.flipit-scale.ts";
import { TOOLS } from "./tools.ts";

afterEach(() => vi.unstubAllEnvs());

describe("flipitBuiltinEnabled", () => {
  it("is off unless SAM_FLIPIT_BUILTIN is exactly 1", () => {
    expect(flipitBuiltinEnabled({})).toBe(false);
    expect(flipitBuiltinEnabled({ SAM_FLIPIT_BUILTIN: "0" })).toBe(false);
    expect(flipitBuiltinEnabled({ SAM_FLIPIT_BUILTIN: "true" })).toBe(false);
    expect(flipitBuiltinEnabled({ SAM_FLIPIT_BUILTIN: "1" })).toBe(true);
  });
  it("picks out the built-in desk's tools only", () => {
    for (const n of ["flipit_monte_carlo", "mt5_account", "smart_flipit_summary"]) expect(isFlipitBuiltinTool(n)).toBe(true);
    for (const n of ["web_search", "studio_director_storyboard"]) expect(isFlipitBuiltinTool(n)).toBe(false);
  });
  it("leaves FLIP IT / MT5 tools out of the registry by default", () => {
    expect(TOOLS.filter((t) => isFlipitBuiltinTool(t.name)).map((t) => t.name)).toEqual([]);
    expect(TOOLS.length).toBeGreaterThan(50);
  });
  it("keeps them registered when SAM_FLIPIT_BUILTIN=1", async () => {
    vi.resetModules();
    vi.stubEnv("SAM_FLIPIT_BUILTIN", "1");
    const on = await import("./tools.ts");
    const names = on.TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["flipit_monte_carlo", "mt5_account", "smart_flipit_summary"]));
  }, 30_000);
});

async function withApp<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(["/api/flipit", "/api/mt5"], flipitBuiltinGuard);
  registerFlipItScaleRoutes(app);
  app.get("/api/flipit", (_req, res) => res.json({ present: false }));
  app.get("/api/mt5/summary", (_req, res) => res.json({ connected: false }));
  const srv: Server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try { return await fn(`http://127.0.0.1:${(srv.address() as { port: number }).port}`); }
  finally { srv.close(); }
}

describe("FLIP IT routes", () => {
  it("answer 404 with the add-on hint by default", async () => {
    await withApp(async (base) => {
      for (const [m, p] of [["GET", "/api/flipit"], ["GET", "/api/flipit/signals"], ["POST", "/api/flipit/execute"], ["GET", "/api/mt5/summary"]]) {
        const r = await fetch(base + p, { method: m });
        expect(r.status, `${m} ${p}`).toBe(404);
        expect(await r.json()).toEqual({ error: "FLIP IT is an add-on now — connect it in Add-ons", addon: "flipit" });
      }
    });
  });
  it("behave as before when SAM_FLIPIT_BUILTIN=1", async () => {
    vi.stubEnv("SAM_FLIPIT_BUILTIN", "1");
    await withApp(async (base) => {
      expect(await (await fetch(`${base}/api/flipit`)).json()).toEqual({ present: false });
      expect((await fetch(`${base}/api/mt5/summary`)).status).toBe(200);
    });
  });
});
