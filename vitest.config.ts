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
    // "._*" is macOS's AppleDouble sidecar: when the repo lives on a non-native volume (an
    // external exFAT drive), writing foo.test.ts also drops a binary ._foo.test.ts beside it.
    // It is gitignored, so it is invisible in `git status` — but it matches the test glob, and
    // vitest reports it as a failed suite with a parse error on a file you did not write.
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**", "e2e/**", ".claude/worktrees/**", ".agents/**", "**/._*"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      // Ratchet-only floor — set just below the current baseline so coverage can never REGRESS.
      // Raise these numbers as tests are added; never lower them. Run via `npm run test:coverage`.
      //
      // These sat at 22/18/18/24 while actual coverage was 57/52/52/61 — the floor was less than
      // HALF the ceiling, so coverage could have fallen by half and still passed. A ratchet that
      // stops ratcheting is worse than none: it reads as protection on every run while protecting
      // nothing. Re-set 2026-08-11 to ~2 points under the real baseline, which is the margin that
      // absorbs an ordinary refactor without absorbing a regression.
      thresholds: { statements: 55, branches: 50, functions: 50, lines: 59 },
    },
  },
});
