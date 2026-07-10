import { describe, it, expect } from "vitest";
import { supporterEnabled, supporterStatus, coreFeatureGated } from "./supporter.ts";

describe("supporter tier — free-forever guardrails", () => {
  it("is OFF by default (no SAM_SUPPORTER flag)", () => {
    const prev = process.env.SAM_SUPPORTER; delete process.env.SAM_SUPPORTER;
    try { expect(supporterEnabled()).toBe(false); expect(supporterStatus().tier).toBe("free"); }
    finally { if (prev !== undefined) process.env.SAM_SUPPORTER = prev; }
  });

  it("core function is NEVER gated by the supporter tier (tripwire)", () => {
    // coreFeatureGated is typed `false` — this can't drift to true without failing the type + this test.
    expect(coreFeatureGated()).toBe(false);
  });

  it("enabling the flag only changes the tier label, nothing about core", () => {
    const prev = process.env.SAM_SUPPORTER; process.env.SAM_SUPPORTER = "1";
    try {
      expect(supporterEnabled()).toBe(true);
      expect(supporterStatus().tier).toBe("supporter");
      expect(coreFeatureGated()).toBe(false);   // still never gates core
    } finally { if (prev === undefined) delete process.env.SAM_SUPPORTER; else process.env.SAM_SUPPORTER = prev; }
  });
});
