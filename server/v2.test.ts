import { describe, it, expect, vi, beforeEach } from "vitest";

// Note: `maxSteps` is internal to agent.ts, but we can infer it by watching 
// how many times the loop iterates before giving up.
describe("V2 Agentic Loop", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("scales maxSteps up to 12 for complex tasks", async () => {
    let callCount = 0;
    const models = await import("./models.ts");
    vi.spyOn(models, "runModel").mockImplementation(async () => {
      callCount++;
      return { text: `{"tool":"get_datetime","input":{}}`, provider: "test", tier: "free" };
    });

    const { runAgent } = await import("./agent.ts");
    
    // A simple task should get 4 loop steps + 1 wrap-up step = 5 calls
    await runAgent("system", "check the date and time", "free", ["get_datetime"]);
    expect(callCount).toBe(5); // 4 loop steps + 1 wrap-up step

    callCount = 0;
    // A complex task should trigger the 12-step budget = 13 calls
    await runAgent("system", "build the app and test it thoroughly step by step", "free", ["get_datetime"]);
    expect(callCount).toBe(13); // 12 loop steps + 1 wrap-up step
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
