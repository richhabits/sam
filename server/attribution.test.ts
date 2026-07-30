import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// FILE is computed once, at module load, from VAULT_DIR — same reasoning pairing.test.ts and
// scheduler.test.ts already established: a fresh directory per test needs a fresh module
// instance per test, via vi.resetModules() + a dynamic import, not a static top-level one.
let dir: string;
let A: typeof import("./attribution.ts");

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-attribution-"));
  process.env.VAULT_DIR = dir;
  vi.resetModules();
  A = await import("./attribution.ts");
});
afterEach(() => { delete process.env.VAULT_DIR; rmSync(dir, { recursive: true, force: true }); });

const AT = (iso: string) => ({ at: iso, deviceId: "d1", deviceLabel: "iPhone · Safari", capability: "assign-task" as const, detail: "project.build" });

describe("logAttribution / readAttribution — the single view", () => {
  it("records and reads back an entry", () => {
    A.logAttribution({ deviceId: "d1", deviceLabel: "iPhone · Safari", capability: "assign-task", detail: "project.build" });
    const entries = A.readAttribution();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ deviceId: "d1", deviceLabel: "iPhone · Safari", capability: "assign-task", detail: "project.build" });
    expect(entries[0].at).toBeTruthy();
  });

  it("survives being read across a fresh module load — this must outlive a restart to answer 'yesterday'", async () => {
    A.logAttribution({ deviceId: "d1", deviceLabel: "iPhone · Safari", capability: "cancel", detail: "project.edit" });
    vi.resetModules();   // simulates a restart: a genuinely fresh module instance, same VAULT_DIR
    const reloaded = await import("./attribution.ts");
    expect(reloaded.readAttribution()).toHaveLength(1);
  });

  it("newest first", () => {
    A.logAttribution({ ...AT("2026-01-01T00:00:00.000Z"), detail: "older" });
    A.logAttribution({ ...AT("2026-01-02T00:00:00.000Z"), detail: "newer" });
    const entries = A.readAttribution();
    expect(entries[0].detail).toBe("newer");
    expect(entries[1].detail).toBe("older");
  });

  it("filters by deviceId", () => {
    A.logAttribution({ ...AT("2026-01-01T00:00:00.000Z"), deviceId: "d1" });
    A.logAttribution({ ...AT("2026-01-01T00:00:00.000Z"), deviceId: "d2" });
    expect(A.readAttribution({ deviceId: "d1" })).toHaveLength(1);
    expect(A.readAttribution({ deviceId: "d1" })[0].deviceId).toBe("d1");
  });

  it("filters by time window — 'yesterday' actually excludes older entries", () => {
    const now = Date.parse("2026-01-10T12:00:00.000Z");
    A.logAttribution({ ...AT(new Date(now - 30 * 3600_000).toISOString()), detail: "over a day ago" });
    A.logAttribution({ ...AT(new Date(now - 2 * 3600_000).toISOString()), detail: "2 hours ago" });
    const entries = A.readAttribution({ sinceMs: now - 24 * 3600_000 });
    expect(entries.map((e) => e.detail)).toEqual(["2 hours ago"]);
  });

  it("respects a limit", () => {
    for (let i = 0; i < 10; i++) A.logAttribution({ ...AT("2026-01-01T00:00:00.000Z"), detail: `entry ${i}` });
    expect(A.readAttribution({ limit: 3 })).toHaveLength(3);
  });

  it("caps stored history at 1000 entries, oldest dropped first", () => {
    for (let i = 0; i < 1005; i++) A.logAttribution({ ...AT("2026-01-01T00:00:00.000Z"), detail: `entry ${i}` });
    const all = A.readAttribution({ limit: 2000 });
    expect(all).toHaveLength(1000);
    expect(all[all.length - 1].detail).toBe("entry 5");   // the first 5 were dropped
  });

  it("truncates an overlong detail — never a covert channel for real content", () => {
    A.logAttribution({ deviceId: "d1", deviceLabel: "x", capability: "assign-task", detail: "y".repeat(1000) });
    expect(A.readAttribution()[0].detail.length).toBe(200);
  });

  it("clearAttribution empties the log", () => {
    A.logAttribution(AT("2026-01-01T00:00:00.000Z"));
    expect(A.readAttribution()).toHaveLength(1);
    A.clearAttribution();
    expect(A.readAttribution()).toHaveLength(0);
  });
});
