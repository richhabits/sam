import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _reset as resetIssues, listIssues } from "./issues.ts";
import { _reset as resetPulse, snapshot } from "./pulse.ts";
import { type Guard, startKeeper, stopKeeper, tick } from "./keeper.ts";

// The Keeper: one pass observes actual vs intent, corrects SAFE drift, and records every correction
// (Black Box issue + Pulse metric). Injected guards drive the scenarios so nothing real is touched.

beforeEach(() => { resetIssues(); resetPulse(); delete process.env.SAM_KEEPER; });
afterEach(() => { stopKeeper(); resetIssues(); resetPulse(); delete process.env.SAM_KEEPER; });

const guard = (over: Partial<Guard> & { name: string }): Guard => ({ observe: () => ({ ok: true }), autoHeal: false, ...over });
const metric = (name: string) => snapshot().find((m) => m.name === name);

describe("tick — drift, heal, record", () => {
  it("no drift → a cheap no-op (heal is never called)", async () => {
    const heal = vi.fn(() => ({ ok: true }));
    const r = await tick([guard({ name: "fine", observe: () => ({ ok: true }), heal, autoHeal: true })]);
    expect(r.ok).toEqual(["fine"]);
    expect(r.healed).toEqual([]);
    expect(heal).not.toHaveBeenCalled();
  });

  it("drift + autoHeal → heals AND records to the Pulse and the Black Box", async () => {
    const heal = vi.fn(() => ({ ok: true, detail: "warmed" }));
    const r = await tick([guard({ name: "brain.warm", observe: () => ({ ok: false, detail: "cold" }), heal, autoHeal: true })]);
    expect(r.healed).toEqual(["brain.warm"]);
    expect(heal).toHaveBeenCalledOnce();
    expect(metric("keeper.drift")?.value).toBe(1);
    expect(metric("keeper.heal")?.value).toBe(1);
    expect(listIssues().some((i) => /healed: brain\.warm/.test(i.message))).toBe(true); // recorded, not silent
  });

  it("drift that is NOT auto-healable is SURFACED, never silently corrected", async () => {
    const heal = vi.fn(() => ({ ok: true }));
    const r = await tick([guard({ name: "keys.invalid", observe: () => ({ ok: false, detail: "all keys rejected" }), heal, autoHeal: false })]);
    expect(r.surfaced).toEqual(["keys.invalid"]);
    expect(r.healed).toEqual([]);
    expect(heal).not.toHaveBeenCalled();           // never auto-fixed
    expect(listIssues().some((i) => /drift: keys\.invalid/.test(i.message))).toBe(true);
  });

  it("a heal that fails is recorded as failed, not swallowed", async () => {
    const r = await tick([guard({ name: "flaky", observe: () => ({ ok: false }), heal: () => ({ ok: false, detail: "couldn't" }), autoHeal: true })]);
    expect(r.failed).toEqual(["flaky"]);
    expect(metric("keeper.heal")?.labels).toContain("result=fail");
  });

  it("an observe that throws is captured, not fatal to the pass", async () => {
    const r = await tick([
      guard({ name: "boom", observe: () => { throw new Error("probe blew up"); }, autoHeal: false }),
      guard({ name: "after", observe: () => ({ ok: true }) }), // the pass continues past a bad guard
    ]);
    expect(r.failed).toEqual(["boom"]);
    expect(r.ok).toEqual(["after"]);
    expect(metric("keeper.error")).toBeDefined();
    expect(listIssues().length).toBeGreaterThan(0);
  });

  it("a tick bumps keeper.ticks", async () => {
    await tick([]);
    expect(metric("keeper.ticks")?.value).toBe(1);
  });
});

describe("the loop — on by default, kill-switch off", () => {
  it("starts by default and SAM_KEEPER=0 disables it", () => {
    process.env.SAM_KEEPER = "0";
    expect(startKeeper([], 10)).toBe(false);   // kill-switch → no loop
    delete process.env.SAM_KEEPER;
    expect(startKeeper([], 10)).toBe(true);    // default on → starts
    expect(startKeeper([], 10)).toBe(false);   // idempotent — already running
    stopKeeper();
  });
});
