import { describe, it, expect, beforeEach } from "vitest";
import { estTokens, recordModelCall, drainMetrics, peekMetrics, costUSD, PRICE } from "./metrics.ts";

describe("metrics", () => {
  beforeEach(() => { drainMetrics(); });

  it("estTokens ~ chars/4, stable and non-negative", () => {
    expect(estTokens("")).toBe(0);
    expect(estTokens("abcd")).toBe(1);
    expect(estTokens("a".repeat(400))).toBe(100);
  });

  it("records and drains model calls, clearing after drain", () => {
    recordModelCall({ tier: "free", provider: "mock:free", promptTokens: 100, outputTokens: 20, ms: 200 });
    recordModelCall({ tier: "local", provider: "mock:local", promptTokens: 50, outputTokens: 10, ms: 40 });
    const first = drainMetrics();
    expect(first).toHaveLength(2);
    expect(drainMetrics()).toHaveLength(0);   // drained → empty
  });

  it("local + free are ~free; premium bills real dollars", () => {
    expect(costUSD({ tier: "local", promptTokens: 10000, outputTokens: 1000 })).toBe(0);
    const premium = costUSD({ tier: "premium", promptTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(premium).toBeCloseTo(PRICE.premium.in + PRICE.premium.out, 6);
  });

  it("a cache hit bills nothing regardless of tier", () => {
    expect(costUSD({ tier: "premium", promptTokens: 5000, outputTokens: 500, cached: true })).toBe(0);
  });

  it("peekMetrics is non-destructive", () => {
    recordModelCall({ tier: "free", provider: "x", promptTokens: 1, outputTokens: 1, ms: 1 });
    expect(peekMetrics()).toHaveLength(1);
    expect(peekMetrics()).toHaveLength(1);   // still there
  });
});
