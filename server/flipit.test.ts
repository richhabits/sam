import { describe, it, expect } from "vitest";
import {
  foldLedger, drawdown, parseStepLog, loopState, previousRun, nextRun,
  wallAt, instantForWall, buildDesk,
} from "./flipit.ts";

// The desk's only real logic is arithmetic and calendars, so that is what gets tested:
// fold the journal the way the rig folds it, and get the schedule right across weekends
// and the summer-time boundary — the two places this kind of code dies quietly.

const iso = (ms: number) => new Date(ms).toISOString();

describe("the forward journal fold", () => {
  const header = JSON.stringify({ kind: "header", strategy: "mom_12_1", anchor_mu: 0.0005, anchor_sigma: 0.0067, cutoff: "2026-07-17" });
  const day = (date: string, ret: number, trades_cum = 0) => JSON.stringify({ kind: "day", date, ret, trades_cum });

  it("compounds returns into equity rather than summing them", () => {
    const f = foldLedger([header, day("2026-07-20", 0.1), day("2026-07-21", 0.1)].join("\n"))!;
    expect(f.days).toBe(2);
    // 1.1 * 1.1 = 1.21 — compounded, not 1.2
    expect(f.cumNet).toBeCloseTo(0.21, 10);
    expect(f.cumSimple).toBeCloseTo(0.2, 10);
    expect(f.series.map((p) => p.equity)).toEqual([1.1, expect.closeTo(1.21, 10)]);
  });

  it("reproduces the live day-1 reading", () => {
    const f = foldLedger([header, day("2026-07-20", 0.00841802664799629)].join("\n"))!;
    expect(f.days).toBe(1);
    expect(f.trades).toBe(0);
    expect(f.cumNet).toBeCloseTo(0.0084180266, 9);   // the rig reports +0.84%
    expect(f.status).toBe("IN PROGRESS");
    expect(f.inBand).toBe(true);
  });

  it("keeps the first line for a date and ignores later duplicates", () => {
    const f = foldLedger([header, day("2026-07-20", 0.05), day("2026-07-20", 0.99)].join("\n"))!;
    expect(f.days).toBe(1);
    expect(f.cumNet).toBeCloseTo(0.05, 10);
  });

  it("orders by date regardless of the order lines were appended", () => {
    const f = foldLedger([header, day("2026-07-21", 0.2), day("2026-07-20", 0.1)].join("\n"))!;
    expect(f.series.map((p) => p.date)).toEqual(["2026-07-20", "2026-07-21"]);
  });

  it("carries the last cumulative trade count forward", () => {
    const f = foldLedger([header, day("2026-07-20", 0, 3), day("2026-07-21", 0, 7)].join("\n"))!;
    expect(f.trades).toBe(7);
  });

  it("survives a torn final line without losing the days before it", () => {
    const f = foldLedger([header, day("2026-07-20", 0.01), '{"kind":"day","date":"2026-07-2'].join("\n"))!;
    expect(f.days).toBe(1);
  });

  it("refuses to guess when the anchor header is absent", () => {
    expect(foldLedger([day("2026-07-20", 0.01)].join("\n"))).toBeNull();
    expect(foldLedger("")).toBeNull();
  });

  it("flags a run below the lower band", () => {
    // one day, sigma 0.0067 ⇒ half-width ≈ 0.0134; a -5% day is far below it
    const f = foldLedger([header, day("2026-07-20", -0.05)].join("\n"))!;
    expect(f.inBand).toBe(false);
    expect(f.status).toBe("OUT-LOW");
  });

  it("only reads READY once both the day and trade targets are met", () => {
    const lines = [header];
    for (let i = 0; i < 60; i++) lines.push(day(`2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, 0.0005, 25));
    const f = foldLedger(lines.join("\n"))!;
    expect(f.days).toBe(60);
    expect(f.trades).toBe(25);
    expect(f.status).toBe("READY");
  });
});

describe("drawdown from the high-water mark", () => {
  it("is zero at or above the mark", () => {
    expect(drawdown(5, 5)).toBe(0);
    expect(drawdown(6, 5)).toBe(0);
  });
  it("measures the fall below it", () => {
    expect(drawdown(4, 5)).toBeCloseTo(0.2, 10);
  });
  it("reads zero rather than NaN on a fresh or broken mark", () => {
    expect(drawdown(0, 0)).toBe(0);
    expect(drawdown(5, Number.NaN)).toBe(0);
  });
});

describe("the rig's wall clock", () => {
  it("reads summer time an hour ahead of UTC", () => {
    const w = wallAt(Date.parse("2026-07-20T21:00:00Z"));
    expect([w.y, w.mo, w.d, w.h]).toEqual([2026, 7, 20, 22]);
  });
  it("reads winter time level with UTC", () => {
    const w = wallAt(Date.parse("2026-01-20T22:00:00Z"));
    expect([w.mo, w.h]).toEqual([1, 22]);
  });
  it("places the run hour correctly on both sides of the boundary", () => {
    expect(iso(instantForWall(2026, 7, 20, 22))).toBe("2026-07-20T21:00:00.000Z");   // BST
    expect(iso(instantForWall(2026, 1, 20, 22))).toBe("2026-01-20T22:00:00.000Z");   // GMT
  });
});

describe("the step schedule", () => {
  it("looks forward to the same evening before the run hour", () => {
    const now = Date.parse("2026-07-21T09:00:00Z");            // Tue morning
    expect(iso(nextRun(now)!)).toBe("2026-07-21T21:00:00.000Z");
  });
  it("rolls to the next day once the run hour has passed", () => {
    const now = Date.parse("2026-07-21T21:30:00Z");            // Tue, just after
    expect(iso(nextRun(now)!)).toBe("2026-07-22T21:00:00.000Z");
  });
  it("skips the weekend in both directions", () => {
    const sat = Date.parse("2026-07-25T12:00:00Z");            // Saturday
    expect(iso(nextRun(sat)!)).toBe("2026-07-27T21:00:00.000Z");        // → Monday
    expect(iso(previousRun(sat)!)).toBe("2026-07-24T21:00:00.000Z");    // ← Friday
  });
  it("treats Sunday as still owing Friday's step", () => {
    const sun = Date.parse("2026-07-26T20:00:00Z");
    expect(iso(previousRun(sun)!)).toBe("2026-07-24T21:00:00.000Z");
  });
  it("does not count today's step as due before its hour", () => {
    const now = Date.parse("2026-07-21T09:00:00Z");            // Tue morning
    expect(iso(previousRun(now)!)).toBe("2026-07-20T21:00:00.000Z");    // Monday's
  });
  it("keeps the run hour at 22:00 local across the boundary", () => {
    // late October, after the clocks go back — still 22:00 on the rig's wall clock
    const now = Date.parse("2026-11-03T09:00:00Z");
    expect(iso(nextRun(now)!)).toBe("2026-11-03T22:00:00.000Z");
  });
});

describe("the step log", () => {
  const log = [
    "=== 2026-07-17 22:00:05 BST ===",
    "STEP 2026-07-17 base=mom_12_1: 0 forward days yet",
    "",
    "2026-07-20 08:00 BST morning brief: Waiting for the first bar.",
    "=== 2026-07-20 22:07:28 BST ===",
    "STEP 2026-07-20 base=mom_12_1: IN_PROGRESS days=1 trades=0",
    "backup: committed=yes pushed=no",
  ].join("\n");

  it("reads one run per banner and ignores briefing lines", () => {
    const runs = parseStepLog(log);
    expect(runs.length).toBe(2);
    expect(iso(runs[1].at)).toBe("2026-07-20T21:07:28.000Z");
    expect(runs[1].ok).toBe(true);
    expect(runs[1].detail).toContain("IN_PROGRESS");
  });

  it("marks a banner with no step line as not clean", () => {
    const runs = parseStepLog("=== 2026-07-20 22:00:00 BST ===\nTraceback (most recent call last):");
    expect(runs.length).toBe(1);
    expect(runs[0].ok).toBe(false);
  });

  it("returns nothing for an empty or absent log", () => {
    expect(parseStepLog("")).toEqual([]);
  });
});

describe("the watchdog", () => {
  const clean = (at: string) => [{ at: Date.parse(at), ok: true, detail: "STEP ok" }];

  it("is calm inside the grace period after a due step", () => {
    const now = Date.parse("2026-07-21T22:00:00Z");            // 1h after Tue's step was due
    expect(loopState([], now).stale).toBe(false);
  });

  it("raises the alarm once a due step is overdue with nothing clean since", () => {
    const now = Date.parse("2026-07-21T23:00:00Z");            // 2h after due
    const s = loopState([], now);
    expect(s.stale).toBe(true);
    expect(iso(s.previousScheduled!)).toBe("2026-07-21T21:00:00.000Z");
  });

  it("stays calm when a clean step landed after the due time", () => {
    const now = Date.parse("2026-07-21T23:00:00Z");
    expect(loopState(clean("2026-07-21T21:07:00Z"), now).stale).toBe(false);
  });

  it("still alarms when the only recent step failed", () => {
    const now = Date.parse("2026-07-21T23:00:00Z");
    const runs = [{ at: Date.parse("2026-07-21T21:07:00Z"), ok: false, detail: "Traceback" }];
    expect(loopState(runs, now).stale).toBe(true);
  });

  it("does not alarm on a weekend for a Friday step that ran clean", () => {
    const now = Date.parse("2026-07-26T12:00:00Z");            // Sunday
    expect(loopState(clean("2026-07-24T21:05:00Z"), now).stale).toBe(false);
  });

  it("keeps alarming through the weekend if Friday's step never ran", () => {
    const now = Date.parse("2026-07-26T12:00:00Z");            // Sunday
    expect(loopState([], now).stale).toBe(true);
  });

  it("reports the last run it saw even when calm", () => {
    const now = Date.parse("2026-07-21T22:00:00Z");
    const s = loopState(clean("2026-07-21T21:07:00Z"), now);
    expect(iso(s.lastRun!)).toBe("2026-07-21T21:07:00.000Z");
    expect(s.lastOk).toBe(true);
  });
});

describe("assembling the desk", () => {
  const now = Date.parse("2026-07-21T09:00:00Z");

  it("reports absence plainly when the rig is not on this machine", () => {
    const d = buildDesk("/nonexistent/rig", now);
    expect(d.present).toBe(false);
    expect(d.schema).toBe(2);
    expect(d.now).toBeNull();
    expect(d.degraded).toContain("ladder");
  });

  it("never claims individual fills, because the journal does not record them", () => {
    const d = buildDesk("/nonexistent/rig", now);
    expect(d.trades).toEqual([]);
    expect(d.tradesAvailable).toBe(false);
  });
});
