import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// readVaultNote() is the one route (build order step 6, Vault's "note reader") that hands a
// FILE'S CONTENT back over HTTP by an id the client names — every other vault.ts export before
// it only ever returned metadata or parsed summaries. Same module-state-at-load reason as
// vault-crypto.test.ts's own comment: vault.ts reads VAULT_DIR once at import, so each test
// points it at a scratch dir and re-imports fresh.
let dir: string;
let V: typeof import("./vault.ts");

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-vaultnote-"));
  mkdirSync(join(dir, "projects"), { recursive: true });
  mkdirSync(join(dir, "daily"), { recursive: true });
  process.env.VAULT_DIR = dir;
  const { vi } = await import("vitest");
  vi.resetModules();
  V = await import("./vault.ts");
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("readVaultNote", () => {
  it("reads a project note that exists", () => {
    writeFileSync(join(dir, "projects", "teahouse.md"), "# Teahouse\nhello");
    expect(V.readVaultNote("project", "teahouse")).toEqual({ content: "# Teahouse\nhello" });
  });

  it("reads a daily note that exists", () => {
    writeFileSync(join(dir, "daily", "2026-01-05.md"), "### 09:00\nhi");
    expect(V.readVaultNote("daily", "2026-01-05")).toEqual({ content: "### 09:00\nhi" });
  });

  it("reads facts.md under the memory group, and ONLY under the id \"facts\"", () => {
    writeFileSync(join(dir, "facts.md"), "- likes tea");
    expect(V.readVaultNote("memory", "facts")).toEqual({ content: "- likes tea" });
    expect(V.readVaultNote("memory", "anything-else")).toBeNull();
  });

  it("returns null for a missing file rather than throwing", () => {
    expect(V.readVaultNote("project", "nope")).toBeNull();
    expect(V.readVaultNote("daily", "2020-01-01")).toBeNull();
  });

  it("refuses path traversal in a project id", () => {
    // If this ever read outside PROJECTS_DIR it would return the scratch dir's own facts.md —
    // planted here so a regression is a wrong non-null answer, not just a thrown error.
    writeFileSync(join(dir, "facts.md"), "secret");
    expect(V.readVaultNote("project", "../facts")).toBeNull();
    expect(V.readVaultNote("project", "..%2Ffacts")).toBeNull();
  });

  it("refuses a daily id that isn't YYYY-MM-DD", () => {
    writeFileSync(join(dir, "daily", "not-a-date.md"), "x");
    expect(V.readVaultNote("daily", "not-a-date")).toBeNull();
    expect(V.readVaultNote("daily", "../facts")).toBeNull();
  });

  it("refuses an unknown group", () => {
    expect(V.readVaultNote("link", "some-wikilink-target")).toBeNull();
    expect(V.readVaultNote("", "anything")).toBeNull();
  });
});
