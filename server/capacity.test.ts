import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./keys.ts", () => ({ keyStatus: vi.fn() }));
import { keyStatus } from "./keys.ts";
import { capacityReport, capacityNudge } from "./capacity.ts";

const set = (arr: any[]) => (keyStatus as any).mockReturnValue(arr);
const s = (provider: string, total: number, healthy = total, cooling = 0) => ({ provider, total, healthy, cooling, uses: 0 });

describe("capacity", () => {
  beforeEach(() => (keyStatus as any).mockReset());

  it("NONE with no free keys — nudges the fastest provider first (Cerebras)", () => {
    set([]);
    const r = capacityReport();
    expect(r.level).toBe("none");
    expect(r.nextToAdd?.id).toBe("cerebras");
    expect(capacityNudge()).toContain("Cerebras");
  });

  it("AMPLE with 2+ providers healthy — no nudge (never nags when fine)", () => {
    set([s("cerebras", 1), s("groq", 1)]);
    expect(capacityReport().level).toBe("ample");
    expect(capacityNudge()).toBeNull();
  });

  it("LOW when every key is cooling/rate-limited — nudges", () => {
    set([s("cerebras", 1, 0, 1)]);
    expect(capacityReport().level).toBe("low");
    expect(capacityNudge()).toMatch(/maxed out|cooling/i);
  });

  it("OK with a single working provider — no nudge", () => {
    set([s("cerebras", 1)]);
    expect(capacityReport().level).toBe("ok");
    expect(capacityNudge()).toBeNull();
  });

  it("nextToAdd skips already-configured providers", () => {
    set([s("cerebras", 1), s("groq", 1)]);
    expect(capacityReport().nextToAdd?.id).toBe("nvidia");
  });

  it("ignores premium (anthropic/openai) — only counts free tiers", () => {
    set([s("openai", 5), s("anthropic", 5)]);   // paid keys don't count as free capacity
    expect(capacityReport().level).toBe("none");
  });
});
