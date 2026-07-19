import { describe, expect, it, vi } from "vitest";
import { logSecurity, securityEvents, securityStatus } from "./security.ts";

// security.ts is the in-memory watchdog log the HUD reads. It's used all over (blocked
// commands, bad origins) but had no direct test — so its ring buffer, newest-first order,
// truncation, and the "all clear vs flagged" summary were unproven. EVENTS is a module
// singleton with no reset, so assertions use DELTAS against the live count, never absolutes.

describe("security watchdog log", () => {
  it("records an event and returns it newest-first", () => {
    const before = securityStatus().total;
    logSecurity("info", "test-a", "first");
    logSecurity("info", "test-b", "second");
    expect(securityStatus().total).toBe(before + 2);
    // securityEvents is reversed → the most recent is [0].
    expect(securityEvents(2)[0].type).toBe("test-b");
    expect(securityEvents(2)[1].type).toBe("test-a");
    expect(securityEvents(1)[0].iso).toMatch(/^\d{4}-\d\d-\d\dT/); // ISO timestamp present
  });

  it("info events keep the status clear; warn/alert flip it", () => {
    const a0 = securityStatus().alerts;
    const w0 = securityStatus().warns;
    logSecurity("warn", "test-warn", "something odd");
    let s = securityStatus();
    expect(s.warns).toBe(w0 + 1);
    expect(s.clear).toBe(false);
    expect(s.headline).toMatch(/worth a look/i);
    logSecurity("alert", "test-alert", "blocked something dodgy");
    s = securityStatus();
    expect(s.alerts).toBe(a0 + 1);
    expect(s.headline).toMatch(/flagged and blocked/i);
  });

  it("truncates a long detail to 300 chars so one event can't bloat the log", () => {
    logSecurity("info", "test-long", "x".repeat(5000));
    const ev = securityEvents(40).find((e) => e.type === "test-long");
    expect(ev).toBeDefined();
    expect(ev!.detail.length).toBe(300);
  });

  it("warns to the console for non-info events, stays silent for info", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => { /* swallow warn during test */ });
    try {
      logSecurity("info", "test-quiet", "no console noise");
      expect(spy).not.toHaveBeenCalled();
      logSecurity("alert", "test-loud", "shout about this");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain("test-loud");
    } finally {
      spy.mockRestore();
    }
  });

  it("caps the ring buffer at 250 — the oldest fall off, never unbounded growth", () => {
    // Runs last on purpose: it fills the buffer. After 300 pushes total must be pinned at MAX.
    for (let i = 0; i < 300; i++) logSecurity("info", "flood", `e${i}`);
    expect(securityStatus().total).toBe(250);
    // and it's the NEWEST 250 that survive — the very first flood entry is gone.
    expect(securityEvents(250).some((e) => e.detail === "e299")).toBe(true);
    expect(securityEvents(250).some((e) => e.detail === "e0")).toBe(false);
  });
});
