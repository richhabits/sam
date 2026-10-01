import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FLIP IT is an add-on (flipit-builtin.ts). With the built-in desk off, nothing in the default install
// may advertise it: wallet/revenue routes 404, and its cards, intents, actions and playbook disappear.
vi.mock("./models.ts", async (orig) => ({ ...(await orig<typeof import("./models.ts")>()), runModel: vi.fn(async () => ({ text: "ok", provider: "test" })) }));
vi.mock("./studio-higgsfield.ts", async (orig) => ({
  ...(await orig<typeof import("./studio-higgsfield.ts")>()),
  generateStoryboardDirector: vi.fn().mockResolvedValue({ title: "t", narrativeGoal: "g", shots: [] }),
}));

import { appleAppIntents, processWatchPrompt } from "./apple-ecosystem.ts";
import { flipitBuiltinGuard } from "./flipit-builtin.ts";
import { generateMobileFeed } from "./mobile-feed.ts";
import { getMasterDashboard } from "./orchestrator.ts";
import { seedStarterPlaybooks } from "./starter-playbooks.ts";
import { processUniversalPrompt, universalShortcuts } from "./universal-ecosystem.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-flipit-gating-"));
  process.env.VAULT_DIR = dir;
  process.env.SAMYARD_DIR = join(dir, "yard");
});
afterEach(() => {
  delete process.env.SAM_FLIPIT_BUILTIN;
  delete process.env.VAULT_DIR;
  delete process.env.SAMYARD_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("FLIP IT remnants with the built-in desk OFF", () => {
  it("the add-on guard 404s wallet and revenue like /api/flipit", async () => {
    const app = express();
    app.use(["/api/flipit", "/api/mt5", "/api/wallet", "/api/revenue"], flipitBuiltinGuard);
    app.get("/api/wallet", (_q, r) => r.json({ secret: "balance" }));
    app.get("/api/revenue/scale-100m", (_q, r) => r.json({ secret: "plan" }));
    let server!: Server;
    await new Promise<void>((r) => { server = createServer(app).listen(0, "127.0.0.1", () => r()); });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      for (const p of ["/api/wallet", "/api/revenue/scale-100m"]) {
        const res = await fetch(base + p);
        expect(res.status).toBe(404);
        expect((await res.json()).addon).toBe("flipit");
      }
      process.env.SAM_FLIPIT_BUILTIN = "1";
      expect((await fetch(`${base}/api/wallet`)).status).toBe(200);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("index.ts mounts the guard on wallet and revenue", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    expect(src).toMatch(/app\.use\(\[[^\]]*"\/api\/wallet"[^\]]*"\/api\/revenue"[^\]]*\], flipitBuiltinGuard\)/);
  });

  it("mobile feed drops the FlipIt market card (and keeps it when ON)", async () => {
    expect((await generateMobileFeed()).activeCards.some((c) => c.type === "MARKET")).toBe(false);
    process.env.SAM_FLIPIT_BUILTIN = "1";
    expect((await generateMobileFeed()).activeCards.some((c) => c.type === "MARKET")).toBe(true);
  });

  it("the master dashboard omits flipitQuant", () => {
    expect(getMasterDashboard().flipitQuant).toBeUndefined();
    process.env.SAM_FLIPIT_BUILTIN = "1";
    expect(getMasterDashboard().flipitQuant).toBeDefined();
  });

  it("universal shortcuts and Apple intents drop the FlipIt entries", () => {
    expect(universalShortcuts().some((s) => s.id === "flipit_shield_status")).toBe(false);
    expect(appleAppIntents().some((i) => i.intentId === "FlipItRiskHaltIntent")).toBe(false);
    process.env.SAM_FLIPIT_BUILTIN = "1";
    expect(universalShortcuts().some((s) => s.id === "flipit_shield_status")).toBe(true);
    expect(appleAppIntents().some((i) => i.intentId === "FlipItRiskHaltIntent")).toBe(true);
  });

  it("no flipit:circuit_breaker action is offered on any surface", async () => {
    const u = await processUniversalPrompt({ transcript: "halt the risky trade circuit", platform: "pwa" });
    const w = await processWatchPrompt({ transcript: "halt the risky trade portfolio", sourceDevice: "apple_watch" });
    expect(JSON.stringify(u.actions)).not.toContain("flipit:circuit_breaker");
    expect(JSON.stringify(w.suggestedActions)).not.toContain("flipit:circuit_breaker");
    process.env.SAM_FLIPIT_BUILTIN = "1";
    const u2 = await processUniversalPrompt({ transcript: "halt the risky trade circuit", platform: "pwa" });
    const w2 = await processWatchPrompt({ transcript: "halt the risky trade portfolio", sourceDevice: "apple_watch" });
    expect(JSON.stringify(u2.actions)).toContain("flipit:circuit_breaker");
    expect(JSON.stringify(w2.suggestedActions)).toContain("flipit:circuit_breaker");
  });

  it("does not seed the prediction-market-bot playbook", () => {
    const off = seedStarterPlaybooks().map((p) => p.id);
    expect(off).not.toContain("prediction-market-bot");
    expect(off).toContain("fullstack-saas-core");
    process.env.SAM_FLIPIT_BUILTIN = "1";
    expect(seedStarterPlaybooks().map((p) => p.id)).toContain("prediction-market-bot");
  });
});
