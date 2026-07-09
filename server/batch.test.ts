import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseToolBatch, executeToolBatch } from "./agent.ts";
import { TOOLS } from "./tools.ts";

// Inject fast + slow SAFE fake tools to prove the batch runs concurrently, then clean up.
const SLOW = 120;
beforeAll(() => {
  TOOLS.push(
    { name: "fake_slow", safe: true, description: "slow", params: "x", activity: () => "slow", run: async () => { await new Promise((r) => setTimeout(r, SLOW)); return "slow-done"; } },
    { name: "fake_fast", safe: true, description: "fast", params: "x", activity: () => "fast", run: async () => "fast-done" },
    { name: "fake_risky", safe: false, description: "risky", params: "x", activity: () => "risky", run: async () => "risky-done" },
  );
});
afterAll(() => { for (const n of ["fake_slow", "fake_fast", "fake_risky"]) { const i = TOOLS.findIndex((t) => t.name === n); if (i >= 0) TOOLS.splice(i, 1); } });

describe("parseToolBatch", () => {
  it("parses a well-formed batch of >=2 calls", () => {
    const b = parseToolBatch('{"tools":[{"tool":"a","input":{"q":"1"}},{"tool":"b","input":{}}]}');
    expect(b).toHaveLength(2);
    expect(b![0]).toEqual({ tool: "a", input: { q: "1" } });
  });
  it("ignores a single-tool call and non-batches", () => {
    expect(parseToolBatch('{"tool":"a","input":{}}')).toBeNull();
    expect(parseToolBatch('{"tools":[{"tool":"a"}]}')).toBeNull();   // batch of one → not a batch
    expect(parseToolBatch("just prose")).toBeNull();
  });
  it("finds a batch embedded in surrounding prose", () => {
    const b = parseToolBatch('Let me look these up: {"tools":[{"tool":"a","input":{}},{"tool":"b","input":{}}]} done');
    expect(b).toHaveLength(2);
  });
});

describe("executeToolBatch", () => {
  it("runs all-safe calls CONCURRENTLY (wall-clock ≈ slowest, not sum)", async () => {
    const t0 = Date.now();
    const run = await executeToolBatch([
      { tool: "fake_slow", input: {} }, { tool: "fake_slow", input: {} }, { tool: "fake_fast", input: {} },
    ]);
    const ms = Date.now() - t0;
    expect(run.parallel).toBe(true);
    expect(run.results).toHaveLength(3);
    expect(ms).toBeLessThan(SLOW * 2);   // two slow tools in parallel < their sum → proves concurrency
  });
  it("refuses to batch when any tool is risky (gate preserved)", async () => {
    const run = await executeToolBatch([{ tool: "fake_fast", input: {} }, { tool: "fake_risky", input: {} }]);
    expect(run.parallel).toBe(false);
    expect(run.results).toBeUndefined();
  });
  it("refuses to batch an unknown tool", async () => {
    const run = await executeToolBatch([{ tool: "fake_fast", input: {} }, { tool: "does_not_exist", input: {} }]);
    expect(run.parallel).toBe(false);
  });
});
