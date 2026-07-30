import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { addSchedule, removeSchedule, toggleSchedule, listSchedules, parseCron, scheduleStatus, type Schedule } from "./scheduler.ts";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const iso = (ms: number) => new Date(ms).toISOString();

describe("Scheduler Subsystem", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.VAULT_DIR;
    process.env.VAULT_DIR = join(tmpdir(), `sam-test-vault-scheduler-${Date.now()}-${Math.random()}`);
    mkdirSync(process.env.VAULT_DIR, { recursive: true });
    // Also clear out any existing in memory if there was any caching, though there shouldn't be.
    for (const s of listSchedules()) {
      removeSchedule(s.id);
    }
  });

  afterEach(() => {
    if (process.env.VAULT_DIR) {
      try {
        rmSync(process.env.VAULT_DIR, { recursive: true, force: true });
      } catch { /* best-effort test cleanup — the tmp dir may already be gone */ }
    }
    process.env.VAULT_DIR = originalEnv;
  });

  it("starts empty", () => {
    expect(listSchedules().length).toBe(0);
  });

  it("can add a valid cron schedule", () => {
    const s = addSchedule("test command", "daily 09:00"); // SAM cron format
    expect(s.id).toBeDefined();
    expect(s.command).toBe("test command");
    expect(s.cron).toBe("daily 09:00");
    expect(s.enabled).toBe(true);
    
    const list = listSchedules();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(s.id);
  });

  it("throws on invalid cron schedule", () => {
    expect(() => addSchedule("bad cron", "invalid cron string")).toThrow();
  });

  it("can disable and re-enable a schedule", () => {
    const s = addSchedule("test command", "hourly");
    expect(s.enabled).toBe(true);

    const s2 = toggleSchedule(s.id);
    expect(s2?.enabled).toBe(false);

    const s3 = toggleSchedule(s.id);
    expect(s3?.enabled).toBe(true);
  });

  it("can remove a schedule", () => {
    const s = addSchedule("test command", "weekly mon 09:00");
    expect(listSchedules().length).toBe(1);

    const ok = removeSchedule(s.id);
    expect(ok).toBe(true);
    expect(listSchedules().length).toBe(0);
  });
});

// A7 — "daily"/"weekly" name a WALL-CLOCK time, so they must stay correct across BST/GMT.
// Same reference dates flipit.test.ts already validated for the desk's own schedule maths
// (2026-07-20 is BST/UTC+1, 2026-01-20 and 2026-11-03 are GMT/UTC+0, 2026-07-20 is a Monday).
describe("parseCron — zone-correct daily/weekly (the desk's BST/GMT maths, reused)", () => {
  it("daily: 09:00 local in BST is 08:00 UTC", () => {
    const p = parseCron("daily 09:00")!;
    expect(iso(p.nextAfter(Date.parse("2026-07-20T07:00:00Z")))).toBe("2026-07-20T08:00:00.000Z");
  });

  it("daily: 09:00 local in GMT is 09:00 UTC", () => {
    const p = parseCron("daily 09:00")!;
    expect(iso(p.nextAfter(Date.parse("2026-01-20T08:00:00Z")))).toBe("2026-01-20T09:00:00.000Z");
  });

  it("daily: rolls to tomorrow once today's time has passed, correct just after the clocks go back", () => {
    const p = parseCron("daily 09:00")!;
    const justAfter = Date.parse("2026-11-03T09:30:00Z");   // 30 min past 09:00 GMT
    expect(iso(p.nextAfter(justAfter))).toBe("2026-11-04T09:00:00.000Z");
  });

  it("weekly: only its named weekday, rolling a full week forward correctly across BST", () => {
    const p = parseCron("weekly mon 09:00")!;
    const tuesday = Date.parse("2026-07-21T10:00:00Z");   // Tue, after Monday's slot already passed
    expect(iso(p.nextAfter(tuesday))).toBe("2026-07-27T08:00:00.000Z");   // next Monday, 09:00 BST
  });

  it("previousAtOrBefore is the true inverse of nextAfter, inclusive at the exact instant", () => {
    const p = parseCron("daily 09:00")!;
    const at = Date.parse("2026-07-20T08:00:00Z");   // exactly 09:00 BST
    expect(p.previousAtOrBefore(at)).toBe(at);
    expect(p.previousAtOrBefore(at + 1)).toBe(at);
    expect(p.nextAfter(at)).toBeGreaterThan(at);
  });

  it("shouldRun answers by the zone's own clock, not the host's raw getHours()", () => {
    // The bug this replaces: Date#getHours() reads the HOST's local time. This proves the
    // contract directly — due exactly at the zone's 09:00, not at 09:00 in some other zone.
    const p = parseCron("daily 09:00")!;
    expect(p.shouldRun(new Date(Date.parse("2026-07-20T08:00:00Z")), null)).toBe(true);    // 09:00 BST
    expect(p.shouldRun(new Date(Date.parse("2026-07-20T09:00:00Z")), null)).toBe(false);   // 10:00 BST — not the minute
  });
});

describe("scheduleStatus — the stale watchdog (the desk's loop.stale, generalised)", () => {
  const base: Omit<Schedule, "cron" | "lastRun"> = {
    id: "s1", command: "x", enabled: true, created: "2026-01-01T00:00:00.000Z", runCount: 0,
  };

  it("not stale when it has never had the chance to fire yet", () => {
    const s: Schedule = { ...base, cron: "daily 09:00", created: new Date().toISOString() };
    expect(scheduleStatus(s, Date.now()).stale).toBe(false);
  });

  it("stale when overdue past the grace period with no run recorded at all", () => {
    const s: Schedule = { ...base, cron: "daily 09:00" };
    const now = Date.parse("2026-07-20T09:00:00Z");   // an hour past 09:00 BST
    expect(scheduleStatus(s, now).stale).toBe(true);
  });

  it("not stale once a run has been recorded since the due time", () => {
    const s: Schedule = { ...base, cron: "daily 09:00", lastRun: "2026-07-20T08:00:05.000Z" };
    const now = Date.parse("2026-07-20T09:00:00Z");
    expect(scheduleStatus(s, now).stale).toBe(false);
  });

  it("not stale within the grace window even with no run yet", () => {
    const s: Schedule = { ...base, cron: "daily 09:00" };
    const now = Date.parse("2026-07-20T08:05:00Z");   // 5 minutes overdue — inside the 15-minute grace
    expect(scheduleStatus(s, now).stale).toBe(false);
  });

  it("a disabled schedule is never stale, and reports no next run", () => {
    const s: Schedule = { ...base, cron: "daily 09:00", enabled: false };
    const now = Date.parse("2026-07-20T09:00:00Z");
    const status = scheduleStatus(s, now);
    expect(status.stale).toBe(false);
    expect(status.nextRun).toBeNull();
  });

  it("reports the next run using the same zone-correct math nextAfter uses", () => {
    const s: Schedule = { ...base, cron: "daily 09:00" };
    const now = Date.parse("2026-07-20T07:00:00Z");
    expect(iso(scheduleStatus(s, now).nextRun!)).toBe("2026-07-20T08:00:00.000Z");
  });
});
