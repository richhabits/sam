import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _reset as resetIssues, recentTrail } from "./issues.ts";
import { _reset as resetPulse, snapshot } from "./pulse.ts";
import { learnPreference, preferredTier, resetPreferences } from "./preferences.ts";
import { _reset, knackEnabled, recentInfluences, recordInfluence } from "./knack.ts";

// The Knack observes learned influence, never silently. Enabled → every application is attributed to
// the Pulse + the Trail + an inspectable log. Disabled (default) → a no-op, so behaviour is exactly
// baseline. It does not learn or decide; recording never changes the caller's return value.

beforeEach(() => { resetIssues(); resetPulse(); _reset(); delete process.env.SAM_KNACK; });
afterEach(() => { delete process.env.SAM_KNACK; });
const metric = (name: string) => snapshot().find((m) => m.name === name);

describe("the Knack — the SAM_KNACK=0 kill-switch is a silent no-op", () => {
  it("on by default (unset), and records nothing when disabled", () => {
    expect(knackEnabled()).toBe(true);         // default ON now
    process.env.SAM_KNACK = "0";               // kill-switch
    expect(knackEnabled()).toBe(false);
    recordInfluence("preferred-tier", "local", 0.8);
    expect(recentInfluences()).toEqual([]);
    expect(metric("knack.applied")).toBeUndefined();
    expect(recentTrail()).toEqual([]);
  });
});

describe("the Knack — enabled, every influence is attributed", () => {
  beforeEach(() => { process.env.SAM_KNACK = "1"; });

  it("logs the pattern, value and confidence to the log, the Pulse, and the Trail", () => {
    recordInfluence("preferred-tier", "local", 0.8, "2026-07-19T00:00:00.000Z");
    const inf = recentInfluences();
    expect(inf).toHaveLength(1);
    expect(inf[0]).toMatchObject({ pattern: "preferred-tier", value: "local", confidence: 0.8 });
    expect(metric("knack.applied")?.value).toBe(1);
    // Attributed in the Trail — surfaces in the Console/Scope — and value-safe (redacted at push).
    const dump = JSON.stringify(recentTrail());
    expect(dump).toContain("Knack: acted on learned");
    expect(dump).toContain("preferred-tier");
    expect(dump).toContain("confidence 0.80");
  });

  it("the log is a bounded ring (never grows unbounded)", () => {
    for (let i = 0; i < 150; i++) recordInfluence("default:x", `v${i}`, 0.7);
    expect(recentInfluences().length).toBeLessThanOrEqual(100);
  });

  it("reset fully clears the influence log", () => {
    recordInfluence("preferred-tier", "free", 0.9);
    expect(recentInfluences()).toHaveLength(1);
    _reset();
    expect(recentInfluences()).toEqual([]);
  });
});

describe("the Knack — the guardrail end-to-end (a low-confidence pattern cannot act OR be logged)", () => {
  let dir = "";
  beforeEach(() => {
    process.env.SAM_KNACK = "1";
    dir = join(tmpdir(), `sam-knack-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    process.env.VAULT_DIR = dir;
    resetPreferences();
  });
  afterEach(() => {
    delete process.env.VAULT_DIR;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("below the 0.6 threshold: returns the fallback AND records no influence", () => {
    learnPreference("preferred-tier", "local", "t0");        // confidence 0.2
    learnPreference("preferred-tier", "local", "t1");        // confidence 0.4 — still under threshold
    expect(preferredTier("free")).toBe("free");              // NOT trusted → fallback, behaviour unchanged
    expect(recentInfluences()).toEqual([]);                  // and nothing was recorded
  });

  it("at/above the threshold: acts on the learned value AND records the attributed influence", () => {
    for (const t of ["t0", "t1", "t2"]) learnPreference("preferred-tier", "local", t); // 0.2→0.4→0.6
    expect(preferredTier("free")).toBe("local");             // trusted → learned choice
    const inf = recentInfluences();
    expect(inf).toHaveLength(1);
    expect(inf[0]).toMatchObject({ pattern: "preferred-tier", value: "local" });
    expect(inf[0].confidence).toBeGreaterThanOrEqual(0.6);
  });
});
