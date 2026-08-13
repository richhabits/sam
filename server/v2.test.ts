import { describe, it, expect, vi, beforeEach } from "vitest";

// Note: `maxSteps` is internal to agent.ts, but we can infer it by watching 
// how many times the loop iterates before giving up.
describe("V2 Agentic Loop", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("scales maxSteps up to 12 for complex tasks", async () => {
    // We'll mock the model to always return a fake tool call until it runs out of budget.
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      callCount++;
      return new Response(JSON.stringify({ 
        choices: [{ message: { content: `{"tool":"get_datetime","input":{}}` } }] 
      }), { status: 200 });
    }));

    const { runAgent } = await import("./agent.ts");
    
    // A simple greeting should get 4 steps
    const resSimple = await runAgent("system", "hello", "free");
    expect(callCount).toBe(5); // 4 loop steps + 1 wrap-up step

    callCount = 0;
    // A complex task should trigger the 12-step budget
    const resComplex = await runAgent("system", "build the app and test it thoroughly step by step", "free");
    expect(callCount).toBe(13); // 12 loop steps + 1 wrap-up step

    vi.unstubAllGlobals();
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
