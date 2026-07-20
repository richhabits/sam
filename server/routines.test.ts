import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/tmp/sam-routines-test";

let R: typeof import("./routines.ts");

beforeAll(async () => {
  process.env.VAULT_DIR = SCRATCH;
  process.env.SAM_ROUTINES = "1";        // arm the feature for the behaviour tests
  rmSync(SCRATCH, { recursive: true, force: true });
  R = await import("./routines.ts");
});
beforeEach(() => { rmSync(SCRATCH, { recursive: true, force: true }); });
afterAll(() => { delete process.env.SAM_ROUTINES; });

const NOW = "2026-07-18T09:00:00.000Z";

describe("routines — bind + spoken match resolves to the right workflow", () => {
  it("binds phrases and matchRoutine resolves an utterance that contains one", () => {
    expect(R.bind("morning-flow", ["run my morning", "start my day"], NOW).ok).toBe(true);
    expect(R.matchRoutine("hey sam, run my morning please")).toBe("morning-flow");
    expect(R.matchRoutine("start my day")).toBe("morning-flow");
  });

  it("routes to the correct workflow when several are bound", () => {
    R.bind("morning-flow", ["run my morning"], NOW);
    R.bind("shutdown-flow", ["wrap up the day"], NOW);
    expect(R.matchRoutine("please wrap up the day now")).toBe("shutdown-flow");
    expect(R.matchRoutine("run my morning")).toBe("morning-flow");
  });

  it("a near-miss the utterance does not contain returns null", () => {
    R.bind("morning-flow", ["run my morning briefing"], NOW);
    // close, but not a superstring of the bound phrase → no match, no wrong-workflow fire
    expect(R.matchRoutine("run my evening briefing")).toBeNull();
    expect(R.matchRoutine("run the morning")).toBeNull();
  });

  it("an unknown utterance returns null", () => {
    R.bind("morning-flow", ["run my morning"], NOW);
    expect(R.matchRoutine("what's the weather in london")).toBeNull();
  });

  it("prefers the more specific (longer) matching phrase on overlap", () => {
    R.bind("generic-flow", ["run"], NOW);
    R.bind("morning-flow", ["run my morning briefing"], NOW);
    // utterance contains BOTH "run" (score 1) and "run my morning briefing" (score 4) → longer wins
    expect(R.matchRoutine("please run my morning briefing")).toBe("morning-flow");
  });

  it("bind upserts — re-binding a workflow replaces its phrase set", () => {
    R.bind("morning-flow", ["old phrase"], NOW);
    R.bind("morning-flow", ["new phrase"], NOW);
    expect(R.matchRoutine("old phrase")).toBeNull();
    expect(R.matchRoutine("new phrase")).toBe("morning-flow");
    expect(R.list().filter((r) => r.workflowId === "morning-flow")).toHaveLength(1);
  });
});

describe("routines — persistence", () => {
  it("survives a module reload (persisted atomically to vault/routines.json)", async () => {
    R.bind("morning-flow", ["run my morning"], NOW);

    // fresh import = a cold process reading the map back from disk
    const { vi } = await import("vitest");
    vi.resetModules();
    const R2 = await import("./routines.ts");

    expect(R2.list().find((r) => r.workflowId === "morning-flow")?.phrases).toEqual(["run my morning"]);
    expect(R2.matchRoutine("run my morning")).toBe("morning-flow");
  });
});

describe("routines — the flag is the kill switch", () => {
  it("with SAM_ROUTINES off, matchRoutine returns null even for a bound phrase", () => {
    R.bind("morning-flow", ["run my morning"], NOW);
    const prev = process.env.SAM_ROUTINES;
    process.env.SAM_ROUTINES = "0";
    try {
      expect(R.routinesEnabled()).toBe(false);
      expect(R.matchRoutine("run my morning")).toBeNull();
    } finally {
      process.env.SAM_ROUTINES = prev;
    }
    // and back on again
    expect(R.matchRoutine("run my morning")).toBe("morning-flow");
  });
});

describe("routines — no silent failures on bad input", () => {
  it("rejects an invalid workflow id with a typed reason", () => {
    const res = R.bind("../../etc/passwd", ["do it"], NOW);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/id/i);
  });

  it("rejects an empty / whitespace-only phrase set", () => {
    const res = R.bind("morning-flow", ["   ", ""], NOW);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/phrase/i);
  });

  it("unbind reports whether it removed anything", () => {
    R.bind("morning-flow", ["run my morning"], NOW);
    expect(R.unbind("morning-flow")).toBe(true);
    expect(R.unbind("morning-flow")).toBe(false);
    expect(R.matchRoutine("run my morning")).toBeNull();
  });
});
