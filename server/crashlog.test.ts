import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/private/tmp/claude-501/-Users-user/sam-crash-test";
let C: typeof import("./crashlog.ts");
beforeAll(async () => { process.env.VAULT_DIR = SCRATCH; C = await import("./crashlog.ts"); });
beforeEach(() => rmSync(SCRATCH, { recursive: true, force: true }));

describe("crash log redaction (zero-telemetry safety)", () => {
  // Build key-SHAPED fixtures at runtime (never a literal key pattern in source) so the secret
  // scanner doesn't flag the test itself, while redact() still receives the full string to scrub.
  const FAKE_OPENAI = "sk-" + "abcdefgh12345678";
  const FAKE_GOOGLE = "AIza" + "Abc1234567890";

  it("scrubs API keys, long tokens and secret assignments", () => {
    const raw = `key ${FAKE_OPENAI} and ${FAKE_GOOGLE} token=supersecretvalue123 password: hunter2xyz`;
    const r = C.redact(raw);
    expect(r).not.toContain(FAKE_OPENAI);
    expect(r).not.toContain(FAKE_GOOGLE);
    expect(r).toContain("«redacted");
    expect(r.toLowerCase()).not.toContain("hunter2xyz");
  });
  it("scrubs the home path", () => {
    expect(C.redact(`${process.env.HOME}/SAM/vault/keys`)).toContain("~/SAM/vault/keys");
  });
});

describe("crash recording + bundle", () => {
  it("records a crash and reads it back (redacted)", () => {
    const secret = "sk-" + "secretkey12345678";
    C.recordCrash("uncaughtException", new Error(`boom ${secret}`), "2026-07-09T00:00:00Z");
    const recent = C.recentCrashes();
    expect(recent).toContain("boom");
    expect(recent).toContain("uncaughtException");
    expect(recent).not.toContain(secret);
  });
  it("diagnostic bundle includes env + crash log, no raw secrets", () => {
    const secret = "abcdefghijklmnop" + "qrstuvwxyz0123456789XY";
    C.recordCrash("test", new Error(`fail token=${secret}`), "2026-07-09T00:00:00Z");
    const b = C.diagnosticBundle("1.5.0", "2026-07-09T00:00:00Z");
    expect(b).toContain("1.5.0");
    expect(b).toContain("diagnostic bundle");
    expect(b).not.toContain(secret);
  });
});
