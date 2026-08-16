import { describe, it, expect } from "vitest";
import { trySolveLocally } from "./local-micro-solver.ts";
import { localMicroSolverTool } from "./tools.ts";

describe("Local Zero-Token Micro Solver", () => {
  it("solves arithmetic expressions locally in 0 tokens", () => {
    const res1 = trySolveLocally("15 * 4 + 20 / 2");
    expect(res1.solvedLocally).toBe(true);
    expect(res1.type).toBe("math");
    expect(res1.answer).toContain("70");
    expect(res1.tokensUsed).toBe(0);
    expect(res1.costUsd).toBe(0);

    const res2 = trySolveLocally("calculate 2^10");
    expect(res2.solvedLocally).toBe(true);
    expect(res2.answer).toContain("1024");
  });

  it("handles timestamps and date queries locally", () => {
    const res = trySolveLocally("what time is it");
    expect(res.solvedLocally).toBe(true);
    expect(res.type).toBe("timestamp");
    expect(res.answer).toContain("Current Time:");
  });

  it("converts byte units accurately", () => {
    const res = trySolveLocally("1024 mb in gb");
    expect(res.solvedLocally).toBe(true);
    expect(res.type).toBe("unit_conversion");
    expect(res.answer).toContain("1 GB");
  });

  it("falls back cleanly on complex natural language queries", () => {
    const res = trySolveLocally("write an essay about artificial intelligence");
    expect(res.solvedLocally).toBe(false);
    expect(res.type).toBe("unsupported");
  });

  it("localMicroSolverTool formats output cleanly", async () => {
    const out = await localMicroSolverTool({ query: "100 * 5" });
    expect(out).toContain("Local Zero-Token Solution");
    expect(out).toContain("500");
  });
});
