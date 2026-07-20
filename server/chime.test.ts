import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The Chime resolves its vault file at module load, and SAM_CHIME gates the tick.
// So each test points VAULT_DIR at a fresh scratch dir, sets the flag ON, and
// re-imports the module clean — the pattern the other server *.test.ts files use.
let C: typeof import("./chime.ts");
let dir: string;
let prevVault: string | undefined;
let prevFlag: string | undefined;

beforeEach(async () => {
  prevVault = process.env.VAULT_DIR;
  prevFlag = process.env.SAM_CHIME;
  dir = join(tmpdir(), `sam-chime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.VAULT_DIR = dir;
  process.env.SAM_CHIME = "1";           // arm the tick for the fire tests
  vi.resetModules();
  C = await import("./chime.ts");
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  if (prevVault === undefined) delete process.env.VAULT_DIR; else process.env.VAULT_DIR = prevVault;
  if (prevFlag === undefined) delete process.env.SAM_CHIME; else process.env.SAM_CHIME = prevFlag;
});

const silent = { announce: () => {} };  // never touch the real OS notifier in tests

describe("the Chime — store", () => {
  it("sets an alarm and a timer, then lists both", () => {
    const t = C.setTimer("steep the tea", 5 * 60_000);
    const a = C.setAlarm("stand-up", { recur: "weekly mon 09:00" });

    expect(t.kind).toBe("timer");
    expect(t.fireAt).toBeDefined();
    expect(t.enabled).toBe(true);
    expect(a.kind).toBe("alarm");
    expect(a.recur).toBe("weekly mon 09:00");

    const list = C.listChimes();
    expect(list.length).toBe(2);
    expect(new Set(list.map((c) => c.id))).toEqual(new Set([t.id, a.id]));
  });

  it("rejects a bad recur pattern (no silent success)", () => {
    expect(() => C.setAlarm("nonsense", { recur: "sometimes maybe" })).toThrow();
  });

  it("cancels a chime, and reports false when nothing matched", () => {
    const t = C.setTimer("laundry", 60_000);
    expect(C.cancelChime(t.id)).toBe(true);
    expect(C.listChimes().length).toBe(0);
    expect(C.cancelChime(t.id)).toBe(false);        // already gone
    expect(C.cancelChime("chm-nope")).toBe(false);
  });

  it("snooze bumps the fire time and suppresses until it elapses", () => {
    const base = new Date("2026-07-20T12:00:00.000Z");
    const c = C.setTimer("meeting", 1000, base.getTime());   // fireAt = base + 1s

    const t2 = new Date(base.getTime() + 2000);               // now past fireAt → due
    const snz = C.snoozeChime(c.id, 60_000, t2.getTime());
    expect(snz).not.toBeNull();
    // snoozedUntil is pushed out beyond the original fire time
    expect(new Date(snz!.snoozedUntil!).getTime()).toBeGreaterThan(new Date(c.fireAt!).getTime());

    // at t2 the snooze is still live → nothing fires
    expect(C.fireDue(t2, () => {}, silent).length).toBe(0);
    // once the snooze window passes → it fires
    const later = new Date(t2.getTime() + 61_000);
    expect(C.fireDue(later, () => {}, silent).map((x) => x.id)).toContain(c.id);
  });

  it("snoozing a missing chime returns null", () => {
    expect(C.snoozeChime("chm-nope", 60_000)).toBeNull();
  });
});

describe("the Chime — fireDue", () => {
  it("fires only the chimes that are actually due", () => {
    const past = C.setAlarm("was due", { at: "2020-01-01T00:00:00.000Z" });
    const future = C.setAlarm("not yet", { at: "2999-01-01T00:00:00.000Z" });

    const rung: string[] = [];
    const fired = C.fireDue(new Date(), (c) => rung.push(c.id), silent);

    expect(fired.map((c) => c.id)).toEqual([past.id]);
    expect(rung).toEqual([past.id]);
    // the one-shot that fired is now spent; the future one is untouched
    expect(C.getChime(past.id)!.enabled).toBe(false);
    expect(C.getChime(past.id)!.fireCount).toBe(1);
    expect(C.getChime(future.id)!.enabled).toBe(true);
  });

  it("does nothing when the flag is off (default OFF)", () => {
    process.env.SAM_CHIME = "0";
    C.setAlarm("was due", { at: "2020-01-01T00:00:00.000Z" });
    expect(C.fireDue(new Date(), () => {}, silent)).toEqual([]);
  });

  it("reschedules a recurring alarm: fires, skips within the window, fires again next occurrence", () => {
    const a = C.setAlarm("daily brief", { recur: "daily 09:00" });

    const day20 = new Date(2026, 6, 20, 9, 0, 0);   // local 09:00
    const day21 = new Date(2026, 6, 21, 9, 0, 0);

    // first occurrence fires
    expect(C.fireDue(day20, () => {}, silent).map((c) => c.id)).toContain(a.id);
    // same day/minute → already ran, does NOT double-fire
    expect(C.fireDue(day20, () => {}, silent)).toEqual([]);
    // next day at the same time → fires again (rescheduled)
    expect(C.fireDue(day21, () => {}, silent).map((c) => c.id)).toContain(a.id);

    const after = C.getChime(a.id)!;
    expect(after.enabled).toBe(true);       // recurring stays armed
    expect(after.fireCount).toBe(2);
  });
});

describe("the Chime — persistence", () => {
  it("survives a reload (fresh import reads the same vault file)", async () => {
    C.setTimer("persisted timer", 10 * 60_000);
    C.setAlarm("persisted alarm", { recur: "daily 07:00" });

    vi.resetModules();
    const C2 = await import("./chime.ts");   // brand-new module instance, same VAULT_DIR
    const list = C2.listChimes();

    expect(list.length).toBe(2);
    expect(new Set(list.map((c) => c.label))).toEqual(new Set(["persisted timer", "persisted alarm"]));
  });
});
