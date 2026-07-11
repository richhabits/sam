import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/tmp/sam-telemetry-test";
let T: typeof import("./telemetry.ts");
type Analytics = import("./analytics.ts").Analytics;

beforeAll(async () => {
  process.env.VAULT_DIR = SCRATCH;
  rmSync(SCRATCH, { recursive: true, force: true });
  T = await import("./telemetry.ts");
});
beforeEach(() => rmSync(SCRATCH, { recursive: true, force: true }));

const NOW = "2026-07-11T09:00:00.000Z";
const analytics = (over: Partial<Analytics> = {}): Analytics => ({
  firstSeen: "2026-07-04", lastSeen: NOW, activeDays: ["2026-07-04", "2026-07-11"],
  tasks: 12, toolUses: { web_search: 5, read_file: 3 }, workflowRuns: 2, cacheHits: 4, crashes: 0, activatedAt: "2026-07-04T10:00:00Z",
  ...over,
});

describe("telemetry — OFF by default, opt-in only", () => {
  it("is OFF by default and sends NOTHING", () => {
    expect(T.telemetryEnabled()).toBe(false);
    expect(T.telemetryDecided()).toBe(false);
    expect(T.buildPayload(analytics(), "2.0.0", "darwin", NOW)).toBeNull();   // null ⇒ nothing to send
  });

  it("opting in mints an anonymous id; opting out discards it", () => {
    T.setTelemetry(true, NOW);
    expect(T.telemetryEnabled()).toBe(true);
    const p = T.buildPayload(analytics(), "2.0.0", "darwin", NOW)!;
    expect(p.anonId).toMatch(/^[0-9a-f]{32}$/);       // random, anonymous, no account
    T.setTelemetry(false, NOW);
    expect(T.telemetryEnabled()).toBe(false);
    expect(T.buildPayload(analytics(), "2.0.0", "darwin", NOW)).toBeNull();
  });

  it("'no' is a real decision, not indecision", () => {
    T.setTelemetry(false, NOW);
    expect(T.telemetryEnabled()).toBe(false);
    expect(T.telemetryDecided()).toBe(true);           // so first-run doesn't nag again
  });
});

describe("PRIVACY INVARIANT — content can NEVER be in a telemetry payload", () => {
  it("a payload contains ONLY whitelisted, aggregate fields", () => {
    T.setTelemetry(true, NOW);
    const p = T.buildPayload(analytics(), "2.0.0", "darwin", NOW)!;
    expect(Object.keys(p).sort()).toEqual([...T.ALLOWED_FIELDS].sort());
    expect(Object.keys(p.features as object).sort()).toEqual([...T.ALLOWED_FEATURES].sort());
    expect(typeof (p.features as any).toolUses).toBe("number");   // a COUNT, not a name
    expect(T.isSendable(p)).toBe(true);
  });

  it("even a POISONED analytics object leaks no content — tool names/paths/prompts never ride out", () => {
    T.setTelemetry(true, NOW);
    const poisoned = analytics({
      // simulate the worst case: sensitive strings smuggled into the local store
      toolUses: { "read_file:/Users/alex/taxes-2026.pdf": 3, "send_email:boss@acme.com": 1 } as any,
      ...( { userPrompt: "my bank password is hunter2", lastMessage: "SECRET_CONTENT_XYZ" } as any ),
    });
    const p = T.buildPayload(poisoned, "2.0.0", "darwin", NOW)!;
    const wire = JSON.stringify(p);
    for (const secret of ["taxes-2026", "alex", "boss@acme.com", "hunter2", "SECRET_CONTENT_XYZ", "/Users/"]) {
      expect(wire).not.toContain(secret);
    }
    expect((p.features as any).toolUses).toBe(4);        // the poisoned keys collapsed to a plain count
    expect(T.isSendable(p)).toBe(true);
  });

  it("isSendable REFUSES a payload with any non-whitelisted key (drift tripwire)", () => {
    expect(T.isSendable({ schema: "x", anonId: "y", stray: "leak" } as any)).toBe(false);
    expect(T.isSendable({ schema: "x", features: { tasks: 1, secretPath: "/x" } } as any)).toBe(false);
  });
});
