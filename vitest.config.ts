import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts (which carries the electron/react build plugins the
// tests don't need). The setup file redirects the vault to a temp dir so tests never
// write to the real vault/memory.db.
export default defineConfig({
  test: {
    setupFiles: ["./server/test-setup.ts"],
    // e2e/ holds Playwright Electron specs (run via `npx playwright test`, not vitest).
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      // Ratchet-only floor — set just below the current baseline so coverage can never REGRESS.
      // Raise these numbers as tests are added; never lower them. Run via `npm run test:coverage`.
      thresholds: { statements: 22, branches: 18, functions: 18, lines: 24 },
    },
  },
});
