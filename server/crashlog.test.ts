import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/private/tmp/claude-501/-Users-user/sam-crash-test";
let C: typeof import("./crashlog.ts");
beforeAll(async () => { process.env.VAULT_DIR = SCRATCH; C = await import("./crashlog.ts"); });
beforeEach(() => rmSync(SCRATCH, { recursive: true, force: true }));

describe("crash log redaction (zero-telemetry safety)", () => {
  it("scrubs API keys, long tokens and secret assignments", () => {
    const raw = "key sk-abcdefgh12345678 and AIzaAbc1234567890 token=supersecretvalue123 password: hunter2xyz";
    const r = C.redact(raw);
    expect(r).not.toContain("sk-abcdefgh12345678");
    expect(r).not.toContain("AIzaAbc1234567890");
    expect(r).toContain("«redacted");
    expect(r.toLowerCase()).not.toContain("hunter2xyz");
  });
  it("scrubs the home path", () => {
    expect(C.redact(`${process.env.HOME}/SAM/vault/keys`)).toContain("~/SAM/vault/keys");
  });
});

describe("crash recording + bundle", () => {
  it("records a crash and reads it back (redacted)", () => {
    C.recordCrash("uncaughtException", new Error("boom sk-secretkey12345678"), "2026-07-09T00:00:00Z");
    const recent = C.recentCrashes();
    expect(recent).toContain("boom");
    expect(recent).toContain("uncaughtException");
    expect(recent).not.toContain("sk-secretkey12345678");
  });
  it("diagnostic bundle includes env + crash log, no raw secrets", () => {
    C.recordCrash("test", new Error("fail token=abcdefghijklmnopqrstuvwxyz0123456789XY"), "2026-07-09T00:00:00Z");
    const b = C.diagnosticBundle("1.5.0", "2026-07-09T00:00:00Z");
    expect(b).toContain("1.5.0");
    expect(b).toContain("diagnostic bundle");
    expect(b).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789XY");
  });
});
