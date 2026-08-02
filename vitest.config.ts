import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts (which carries the electron/react build plugins the
// tests don't need). The setup file redirects the vault to a temp dir so tests never
// write to the real vault/memory.db.
export default defineConfig({
  test: {
    setupFiles: ["./server/test-setup.ts"],
    // Sweeps the workers' sam-test-* temp dirs after the whole run, in the main process,
    // because vitest kills its workers rather than letting per-worker exit handlers fire.
    globalSetup: ["./server/test-teardown.ts"],
    // e2e/ holds Playwright Electron specs (run via `npx playwright test`, not vitest).
    // .claude/worktrees holds live git worktrees for background agents, each a FULL copy of the
    // repo. Without this, running the suite while an agent is working collects its half-written
    // tests as if they were yours — and they fail for reasons that have nothing to do with your
    // change (no node_modules in the worktree, work in progress), which is the worst kind of red.
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**", "e2e/**", ".claude/worktrees/**"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      // Ratchet-only floor — set just below the current baseline so coverage can never REGRESS.
      // Raise these numbers as tests are added; never lower them. Run via `npm run test:coverage`.
      thresholds: { statements: 22, branches: 18, functions: 18, lines: 24 },
    },
  },
});
