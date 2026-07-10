// Point every test at a throwaway vault BEFORE any module (memory.ts opens its DB at
// import time) can touch the real one — otherwise `npm test` writes test facts into
// the developer's actual vault/memory.db. Runs before the test files are imported.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.VAULT_DIR?.includes("sam-test")) {
  process.env.VAULT_DIR = mkdtempSync(join(tmpdir(), "sam-test-vault-"));
}
