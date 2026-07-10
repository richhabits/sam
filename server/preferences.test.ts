import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/tmp/sam-prefs-test";
let P: typeof import("./preferences.ts");

beforeAll(async () => {
  process.env.VAULT_DIR = SCRATCH;
  rmSync(SCRATCH, { recursive: true, force: true });
  P = await import("./preferences.ts");
});
beforeEach(() => P.resetPreferences());

const t = (n: number) => `2026-07-10T09:0${n}:00.000Z`;

describe("preference memory (local, inspectable, deletable)", () => {
  it("learns, and confidence climbs on repetition", () => {
    P.learnPreference("draft-tone", "terse", t(0));
    expect(P.getPreference("draft-tone")?.confidence).toBeCloseTo(0.2);
    P.learnPreference("draft-tone", "terse", t(1));
    P.learnPreference("draft-tone", "terse", t(2));
    const p = P.getPreference("draft-tone")!;
    expect(p.count).toBe(3);
    expect(p.confidence).toBeGreaterThan(0.5);
  });

  it("a CHANGED value resets confidence (adapts to your latest habit)", () => {
    P.learnPreference("draft-tone", "terse", t(0));
    P.learnPreference("draft-tone", "terse", t(1));
    P.learnPreference("draft-tone", "warm", t(2));   // changed
    const p = P.getPreference("draft-tone")!;
    expect(p.value).toBe("warm");
    expect(p.confidence).toBeCloseTo(0.2);
  });

  it("is inspectable, deletable, and fully resettable", () => {
    P.learnPreference("a", "1", t(0)); P.learnPreference("b", "2", t(0));
    expect(P.listPreferences()).toHaveLength(2);
    expect(P.forgetPreference("a")).toBe(true);
    expect(P.listPreferences().map((p) => p.key)).toEqual(["b"]);
    P.resetPreferences();
    expect(P.listPreferences()).toHaveLength(0);
  });

  it("derived decisions only trust a STABLE preference, else fall back", () => {
    expect(P.preferredTier("free")).toBe("free");        // nothing learned
    P.learnPreference("preferred-tier", "local", t(0));   // conf 0.2 — not yet trusted
    expect(P.preferredTier("free")).toBe("free");
    for (let i = 1; i < 4; i++) P.learnPreference("preferred-tier", "local", t(i));  // climb ≥0.6
    expect(P.preferredTier("free")).toBe("local");
  });
});

describe("PRIVACY INVARIANT — learned state never leaves the device", () => {
  it("derived outputs never echo raw learned free-text (they return constrained local decisions)", () => {
    const MARKER = "SECRET_MARKER_XYZ_do_not_transmit";
    for (let i = 0; i < 4; i++) P.learnPreference("preferred-tier", MARKER, t(i));
    // the marker is stored locally + inspectable…
    expect(P.getPreference("preferred-tier")?.value).toBe(MARKER);
    // …but the DERIVED routing decision rejects anything outside the local enum — the marker can't ride out.
    expect(P.preferredTier("free")).toBe("free");
    expect(["local", "free", "premium"]).toContain(P.preferredTier("free"));
  });

  it("exposes NO function that serialises the profile into prompt/transport text", () => {
    // The only exports are local CRUD + constrained derived decisions. If someone adds a `toPrompt`/
    // `promptHint`/`serialize`/`context` exporter, this test fails — a deliberate tripwire on the
    // privacy boundary.
    const exports = Object.keys(P).sort();
    expect(exports).toEqual([
      "forgetPreference", "getPreference", "learnPreference", "listPreferences",
      "preferredTier", "resetPreferences", "smartDefault",
    ]);
    expect(exports.some((n) => /prompt|hint|serial|transmit|context|payload/i.test(n))).toBe(false);
  });
});
