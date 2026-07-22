// Point every test at a throwaway vault BEFORE any module (memory.ts opens its DB at
// import time) can touch the real one — otherwise `npm test` writes test facts into
// the developer's actual vault/memory.db. Runs before the test files are imported.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every throwaway dir this worker makes, so it can take them all back down when the
// worker exits. Without this, each run left three temp dirs behind — thousands piled up
// over a session's test runs, because nothing ever removed them.
const created: string[] = [];
function throwaway(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

if (!process.env.VAULT_DIR?.includes("sam-test")) {
  process.env.VAULT_DIR = throwaway("sam-test-vault-");
}
// The yard writes a job database, per-job logs, a single-flight lock, and managed project
// repos. Without redirecting these, tests fall back to the REAL ~/sam/yard and ~/SAMYard —
// which (a) pollutes the operator's actual directories and (b) makes parallel yard test
// files collide on the same lock and project paths, a flake that only shows when several
// yard files happen to run at once. One temp root per worker fixes both.
if (!process.env.YARD_DIR?.includes("sam-test")) {
  process.env.YARD_DIR = throwaway("sam-test-yard-");
}
if (!process.env.SAMYARD_DIR?.includes("sam-test")) {
  process.env.SAMYARD_DIR = throwaway("sam-test-samyard-");
}

// Take them down on the way out. `process.on("exit")` fires on a normal finish and after
// a caught failure; the handler must be synchronous, so rmSync (not the promise API).
// Best-effort — a dir already gone, or one the OS cleared, is exactly the state we wanted.
process.on("exit", () => {
  for (const dir of created) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* already gone — fine */ }
  }
});
