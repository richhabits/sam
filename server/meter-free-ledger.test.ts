import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./cost-optimizer.ts", () => ({
  getSavingsSummary: () => ({ ledger: { dollarsSpentTotal: 4.5 }, freeEfficiencyPercentage: 0, cacheEfficiencyPercentage: 0, estimatedGbpSaved: 0 }),
}));

import { meterFreeSummary } from "./meter-free-ledger.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "meter-free-"));
  process.env.VAULT_DIR = dir;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const fakeStore = (minutes: number) => ({ taskMinutesThisMonth: () => minutes });

describe("meterFreeSummary", () => {
  it("multiplies real task minutes by the reference rate, and reports real lifetime spend alongside it", () => {
    const r = meterFreeSummary(fakeStore(100));
    expect(r.monthTaskMinutes).toBe(100);
    expect(r.usdPerAgentMinute).toBeGreaterThan(0);
    expect(r.wouldHaveCostElsewhereUsd).toBeCloseTo(100 * r.usdPerAgentMinute, 2);
    expect(r.actualSpendLifetimeUsd).toBe(4.5);   // from the mocked cost meter — real usage, not invented
  });

  it("a quiet month is a real zero, not a missing field", () => {
    const r = meterFreeSummary(fakeStore(0));
    expect(r.wouldHaveCostElsewhereUsd).toBe(0);
  });

  it("creates the rates file with a safe default on first run, so it's real and editable, not silently absent", () => {
    meterFreeSummary(fakeStore(1));
    const file = join(dir, "meter-free-rates.json");
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.usdPerAgentMinute).toBeGreaterThan(0);
    expect(typeof parsed.note).toBe("string");
  });

  it("honours an operator-edited rate", () => {
    writeFileSync(join(dir, "meter-free-rates.json"), JSON.stringify({ usdPerAgentMinute: 1, note: "test override" }));
    const r = meterFreeSummary(fakeStore(10));
    expect(r.usdPerAgentMinute).toBe(1);
    expect(r.wouldHaveCostElsewhereUsd).toBe(10);
    expect(r.rateNote).toBe("test override");
  });

  it("falls back to the safe default on a corrupted or nonsensical rate — never presents a wild number as real", () => {
    writeFileSync(join(dir, "meter-free-rates.json"), JSON.stringify({ usdPerAgentMinute: -5, note: "bad" }));
    expect(meterFreeSummary(fakeStore(10)).usdPerAgentMinute).toBeGreaterThan(0);

    writeFileSync(join(dir, "meter-free-rates.json"), "{ not json");
    expect(meterFreeSummary(fakeStore(10)).usdPerAgentMinute).toBeGreaterThan(0);

    writeFileSync(join(dir, "meter-free-rates.json"), JSON.stringify({ usdPerAgentMinute: 999 }));
    expect(meterFreeSummary(fakeStore(10)).usdPerAgentMinute).toBeLessThan(5);
  });
});
