import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// env-file resolves ENV_PATH at load from DOTENV_CONFIG_PATH, so each test points it at a scratch
// .env and re-imports a fresh module. The promise under test: a secret VALUE round-trips exactly —
// even one containing `$`, which String.replace would otherwise interpret and silently corrupt.
let dir: string, envPath: string;
let E: typeof import("./env-file.ts");

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-envfile-"));
  envPath = join(dir, ".env");
  process.env.DOTENV_CONFIG_PATH = envPath;
  vi.resetModules();
  E = await import("./env-file.ts");
});
afterEach(() => { delete process.env.DOTENV_CONFIG_PATH; rmSync(dir, { recursive: true, force: true }); });

describe("writeEnv stores values verbatim (audit finding: $-corruption)", () => {
  it("round-trips a value containing $ when UPDATING an existing key", () => {
    E.writeEnv("SMTP_PASS", "placeholder");        // create
    E.writeEnv("SMTP_PASS", "P@$$w0rd");           // update — the corrupting path
    const txt = readFileSync(envPath, "utf8");
    expect(txt).toContain("SMTP_PASS=P@$$w0rd");   // NOT "P@$w0rd" ($$ interpreted)
    expect(process.env.SMTP_PASS).toBe("P@$$w0rd");
  });

  it("does not inject the prior line via $& / $` sequences", () => {
    writeFileSync(envPath, "SECRET=old_secret_value\n");
    vi.resetModules();
    // re-import so the module reads the file we just wrote
    return import("./env-file.ts").then((mod) => {
      mod.writeEnv("SECRET", "pa$&ss");            // $& would splice the WHOLE matched line (old secret!)
      const txt = readFileSync(envPath, "utf8");
      expect(txt).toContain("SECRET=pa$&ss");
      expect(txt).not.toContain("old_secret_value");
    });
  });

  it("handles $` and $1 without expansion", () => {
    E.writeEnv("K", "first");
    E.writeEnv("K", "a$`b$1c");
    expect(readFileSync(envPath, "utf8")).toContain("K=a$`b$1c");
  });
});
