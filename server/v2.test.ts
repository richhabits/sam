import { describe, it, expect, vi, beforeEach } from "vitest";

// Note: `maxSteps` is internal to agent.ts, but we can infer it by watching 
// how many times the loop iterates before giving up.
describe("V2 Agentic Loop", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // This used to infer the budget by counting stubbed fetch calls, which never matched: one loop
  // step is not one fetch. runModel walks the provider ladder, retries a malformed tool call, and
  // repairs bad JSON — all extra fetches — so the count measured the ladder, not the budget, and
  // the assertion (5) never held (actual 3). Assert the budget itself; it's what the claim is.
  it("scales the step budget from 4 to 12 for complex tasks", async () => {
    const { maxSteps } = await import("./agent.ts");

    // A greeting stays cheap — no free-tier quota burned on "hello".
    expect(maxSteps("hello")).toBe(4);
    expect(maxSteps("what time is it?")).toBe(4);

    // Multi-step work gets the headroom to finish and self-correct.
    expect(maxSteps("build the app and test it thoroughly step by step")).toBe(12);
    expect(maxSteps("refactor the parser and verify the tests still pass")).toBe(12);
    expect(maxSteps("give me a comprehensive audit of the vault")).toBe(12);
  });

  it("lint_workspace and run_tests are safe:true", async () => {
    const { toolByName } = await import("./tools.ts");
    const lint = toolByName("lint_workspace");
    const test = toolByName("run_tests");
    
    expect(lint).toBeDefined();
    expect(lint!.safe).toBe(true);
    
    expect(test).toBeDefined();
    expect(test!.safe).toBe(true);
  });
});
