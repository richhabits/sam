import { afterEach, describe, expect, it } from "vitest";
import { hedged } from "./models.ts";

// THE HEDGE. Before this, the free cascade was strictly serial and every provider call carries a
// 30s timeout — so one stalled brain owned the whole turn, and the 2026-08-01 audit measured real
// free brains taking 11s to answer and 24s to REFUSE. The race is what makes a slow leader cost
// the hedge window instead of its timeout.

type P = { id: string; tier: "free"; label: string; run: any };
const p = (id: string): P => ({ id, tier: "free", label: id, run: async () => "" });
const POOL = [p("a"), p("b"), p("c")];
const resolveIn = (ms: number, v: string | null) => new Promise<string | null>((r) => setTimeout(() => r(v), ms));

afterEach(() => { delete process.env.SAM_HEDGE; });

describe("hedged", () => {
  it("returns the leader's answer and never starts anyone else when it is quick", async () => {
    const started: string[] = [];
    const won = await hedged(POOL as any, "s", "p", "fast", {
      waitMs: 50,
      run: async (x) => { started.push(x.id); return x.id === "a" ? "from a" : null; },
    });
    expect(won).toMatchObject({ text: "from a" });
    expect(started).toEqual(["a"]);
  });

  it("starts the next brain alongside a stalled leader, and takes whoever answers first", async () => {
    const started: string[] = [];
    const t0 = Date.now();
    const won = await hedged(POOL as any, "s", "p", "fast", {
      waitMs: 60,
      run: (x) => { started.push(x.id); return x.id === "a" ? resolveIn(5000, "slow a") : resolveIn(20, `quick ${x.id}`); },
    });
    expect(won?.text).toBe("quick b");
    expect(won?.prov.id).toBe("b");
    expect(started).toEqual(["a", "b"]);
    // The point of the whole exercise: the turn cost the hedge window, not the leader's timeout.
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("moves on immediately when a brain comes back empty, without waiting out the window", async () => {
    const t0 = Date.now();
    const won = await hedged(POOL as any, "s", "p", "fast", {
      waitMs: 10_000,   // a window long enough that waiting it out would fail this test
      run: async (x) => (x.id === "a" ? null : "from b"),
    });
    expect(won?.prov.id).toBe("b");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("never runs more than the in-flight cap at once", async () => {
    let live = 0, peak = 0;
    await hedged([p("a"), p("b"), p("c"), p("d"), p("e")] as any, "s", "p", "fast", {
      waitMs: 20,
      run: async () => { live++; peak = Math.max(peak, live); await resolveIn(200, null); live--; return null; },
    });
    // The hedge buys latency with free quota; unbounded it would spend all of it on one turn.
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("gives the last brain its full attempt rather than spinning once nothing is left to start", async () => {
    const won = await hedged([p("a"), p("b")] as any, "s", "p", "fast", {
      waitMs: 20,
      run: (x) => (x.id === "a" ? resolveIn(50, null) : resolveIn(300, "late but real")),
    });
    expect(won?.text).toBe("late but real");
  });

  it("returns null when every brain has nothing, without hanging", async () => {
    expect(await hedged(POOL as any, "s", "p", "fast", { waitMs: 10, run: async () => null })).toBeNull();
  });

  it("SAM_HEDGE=0 restores the strictly serial walk", async () => {
    process.env.SAM_HEDGE = "0";
    const started: string[] = [];
    const won = await hedged(POOL as any, "s", "p", "fast", {
      waitMs: 10,
      run: async (x) => { started.push(x.id); return x.id === "c" ? "from c" : null; },
    });
    expect(won?.text).toBe("from c");
    expect(started).toEqual(["a", "b", "c"]);   // one at a time, in order
  });

  it("a single-brain pool is just a call — no timer, no race", async () => {
    const won = await hedged([p("only")] as any, "s", "p", "fast", { waitMs: 10, run: async () => "one" });
    expect(won).toMatchObject({ text: "one" });
  });
});
