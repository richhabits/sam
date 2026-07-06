import { describe, it, expect } from "vitest";
import { pickLane } from "./models.ts";

describe("pickLane — task-aware model routing", () => {
  it("quick chat → fast", () => {
    expect(pickLane("hey what's up")).toBe("fast");
    expect(pickLane("remind me to call mum")).toBe("fast");
  });

  it("code/debug → code", () => {
    expect(pickLane("debug this stack trace")).toBe("code");
    expect(pickLane("```js\nconst x = 1\n```  why does this break")).toBe("code");
    expect(pickLane("refactor my typescript function")).toBe("code");
  });

  it("reasoning/analysis → deep", () => {
    expect(pickLane("analyse the pros and cons of these two suppliers")).toBe("deep");
    expect(pickLane("compare the strategy here and explain why one wins")).toBe("deep");
  });

  it("long prompt → deep even without keywords", () => {
    expect(pickLane("x ".repeat(200))).toBe("deep");
  });

  it("handles empty/garbage safely", () => {
    expect(pickLane("")).toBe("fast");
    expect(pickLane(undefined as any)).toBe("fast");
  });
});
