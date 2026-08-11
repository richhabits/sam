import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CWD-RELATIVE PATHS IN A SERVER THAT RUNS FROM "/".
//
// quick_note wrote to safePath("./vault/notes/quick.md") and backup_vault copied safePath("./vault").
// Both resolve against process.cwd(). In the packaged app that is "/" — measured on the running
// process, not assumed — so they became /vault/notes/quick.md and /vault: EACCES and ENOENT, every
// single time. Both only ever worked in dev, where cwd happens to be the repo root, which is
// exactly why they looked fine to whoever wrote them.
//
// backup_vault was the costly one: a backup that has never run is the failure you discover at the
// worst possible moment.
//
// Every other module in server/ resolves the vault from its own module location
// (VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault")),
// which is correct from any cwd AND honours the VAULT_DIR override that the tests and the packaged
// app both rely on. This pins that nothing drifts back.
const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.includes(".test."));

describe("server paths must not depend on the working directory", () => {
  it("no module resolves a path from './' or '../'", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/\b(?:safePath|resolve|join|readFile|writeFile|cp|mkdirSync)\(\s*(["'`])(\.\.?\/[^"'`]*)\1/g)) {
        // A relative path inside a comment is documentation of the bug, not the bug.
        const line = src.slice(src.lastIndexOf("\n", m.index) + 1, m.index);
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
        offenders.push(`${f}: ${m[2]}`);
      }
    }
    expect(offenders, `cwd-relative path(s) — the packaged app runs with cwd "/"`).toEqual([]);
  });

  it("the two tools that had this bug now use VAULT_DIR", () => {
    const src = readFileSync(join(dir, "tools.ts"), "utf8");
    const quick = src.slice(src.indexOf('name: "quick_note"'), src.indexOf('name: "crypto_price"'));
    expect(quick).toContain("join(VAULT_DIR");
    const backup = src.slice(src.indexOf('name: "backup_vault"'), src.indexOf('name: "backup_vault"') + 1200);
    expect(backup).toContain("cp(VAULT_DIR");
  });
});
