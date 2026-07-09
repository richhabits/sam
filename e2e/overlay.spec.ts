// ─────────────────────────────────────────────────────────────
//  S.A.M. · OVERLAY GUI E2E  (v1.5 Phase 1 — closes the v1.4 caveat)
//
//  Real Electron end-to-end for the ⌥Space overlay. Runs on the macOS CI runner
//  (a global OS shortcut can't be fired from a test, so the spec drives summon
//  via the SAM_E2E main-process hook and injects a fixed selection). Asserts:
//    • summon-to-ready < 300ms   • palette renders   • Escape dismisses
//    • the injected selection round-trips into the palette
//
//  Run locally:  npm run build && SAM_E2E=1 npx playwright test e2e/overlay.spec.ts
// ─────────────────────────────────────────────────────────────

import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));   // ESM: no ambient __dirname
const MAIN = join(__dirname, "..", "dist-electron", "main.js");
let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, SAM_E2E: "1", SAM_BENCH_MOCK: "1", NODE_ENV: "production" },
  });
  // main.ts installs the E2E surface inside app.whenReady() — wait for it before driving anything.
  await expect.poll(async () => app.evaluate(() => !!(globalThis as any).__samE2E), { timeout: 20000 }).toBe(true);
});
test.afterAll(async () => { await app?.close(); });

test("overlay summons in under 300ms and is ready", async () => {
  const t0 = Date.now();
  await app.evaluate(() => (globalThis as any).__samE2E.summon());
  // Wait until the main process reports the overlay visible + finished loading.
  await expect.poll(async () => app.evaluate(() => (globalThis as any).__samE2E.overlayVisible() && (globalThis as any).__samE2E.overlayReady()), { timeout: 1500 }).toBe(true);
  const summonMs = Date.now() - t0;
  expect(summonMs, `summon-to-ready was ${summonMs}ms`).toBeLessThan(300);
});

test("palette renders and receives the injected selection", async () => {
  // The overlay is a separate BrowserWindow — grab its page.
  const pages = app.windows();
  const overlay = pages.find((p) => p.url().startsWith("data:text/html")) ?? pages[pages.length - 1];
  await overlay.waitForSelector("#q", { timeout: 1500 });
  await expect(overlay.locator("#q")).toBeVisible();
  // The injected selection ("the quick brown fox") should surface in the selection chip + action buttons.
  await expect(overlay.locator("#sel")).toContainText("quick brown fox", { timeout: 1500 });
  await expect(overlay.locator("#acts button")).toHaveCount(6);   // rewrite/reply/summarize/translate/explain/fix
});

test("Escape dismisses the overlay", async () => {
  const pages = app.windows();
  const overlay = pages.find((p) => p.url().startsWith("data:text/html")) ?? pages[pages.length - 1];
  await overlay.locator("#q").press("Escape");
  await expect.poll(async () => app.evaluate(() => (globalThis as any).__samE2E.overlayVisible()), { timeout: 1500 }).toBe(false);
});
