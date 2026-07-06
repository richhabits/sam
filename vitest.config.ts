import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts (which carries the electron/react build plugins the
// tests don't need). The setup file redirects the vault to a temp dir so tests never
// write to the real vault/memory.db.
export default defineConfig({
  test: {
    setupFiles: ["./server/test-setup.ts"],
  },
});
