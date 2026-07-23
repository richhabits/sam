import { describe, it, expect } from "vitest";
import { pickLane, localStaysOnDevice } from "./models.ts";

// AUDIT FIX: the streaming path used to send Private/local-mode prompts to Groq/Gemini
// because it only excluded the "premium" tier. Local must stay on the machine, streaming or
// not — the same guarantee the non-streaming path already makes.
describe("Private mode never crosses to a cloud brain", () => {
  it("keeps the local tier on-device", () => {
    expect(localStaysOnDevice("local")).toBe(true);
  });
  it("lets free and premium reach cloud (they are not private)", () => {
    expect(localStaysOnDevice("free")).toBe(false);
    expect(localStaysOnDevice("premium")).toBe(false);
  });
});

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
