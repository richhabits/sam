import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { addSchedule, removeSchedule, toggleSchedule, listSchedules } from "./scheduler.ts";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
      } catch {}
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
