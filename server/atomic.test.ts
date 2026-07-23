import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";

// The promise: a reader never sees a half-written file, and a secret file is not left
// world-readable. These tests are that promise.
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sam-atomic-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("writeFileAtomic", () => {
  it("writes the whole file and creates missing parent directories", () => {
    const f = join(dir, "a", "b", "state.json");
    writeFileAtomic(f, '{"ok":true}');
    expect(JSON.parse(readFileSync(f, "utf8")).ok).toBe(true);
  });

  it("replaces an existing file wholesale, leaving no temp files behind", () => {
    const f = join(dir, "state.json");
    writeFileSync(f, "OLD");
    writeFileAtomic(f, "NEW");
    expect(readFileSync(f, "utf8")).toBe("NEW");
    // no .tmp siblings survive a successful write
    expect(readdirSync(dir).filter((n) => n.includes(".tmp"))).toHaveLength(0);
  });

  it("applies a 0600 mode for secret files (not world-readable)", () => {
    const f = join(dir, "secret.json");
    writeFileAtomic(f, "shh", { mode: 0o600 });
    // low 9 permission bits: owner-only read/write
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it("never leaves the previous good copy truncated (target always parseable)", () => {
    const f = join(dir, "state.json");
    writeFileAtomic(f, JSON.stringify({ n: 1 }));
    writeFileAtomic(f, JSON.stringify({ n: 2 }));
    expect(existsSync(f)).toBe(true);
    expect(JSON.parse(readFileSync(f, "utf8")).n).toBe(2);
  });
});
