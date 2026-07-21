// Point every test at a throwaway vault BEFORE any module (memory.ts opens its DB at
// import time) can touch the real one — otherwise `npm test` writes test facts into
// the developer's actual vault/memory.db. Runs before the test files are imported.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.VAULT_DIR?.includes("sam-test")) {
  process.env.VAULT_DIR = mkdtempSync(join(tmpdir(), "sam-test-vault-"));
}
// The yard writes a job database, per-job logs, a single-flight lock, and managed project
// repos. Without redirecting these, tests fall back to the REAL ~/sam/yard and ~/SAMYard —
// which (a) pollutes the operator's actual directories and (b) makes parallel yard test
// files collide on the same lock and project paths, a flake that only shows when several
// yard files happen to run at once. One temp root per worker fixes both.
if (!process.env.YARD_DIR?.includes("sam-test")) {
  process.env.YARD_DIR = mkdtempSync(join(tmpdir(), "sam-test-yard-"));
}
if (!process.env.SAMYARD_DIR?.includes("sam-test")) {
  process.env.SAMYARD_DIR = mkdtempSync(join(tmpdir(), "sam-test-samyard-"));
}
