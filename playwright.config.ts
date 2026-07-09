import { defineConfig } from "@playwright/test";

// Electron overlay e2e (v1.5). Kept out of the default `npm test` (vitest) — run explicitly:
//   npm run build && SAM_E2E=1 npx playwright test
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,      // one Electron app instance, serial specs
  workers: 1,
  reporter: [["list"]],
  retries: process.env.CI ? 1 : 0,
});
