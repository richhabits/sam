import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _reset, count, gauge, observe, pulseSummary, snapshot } from "./pulse.ts";

// The Pulse: cheap, bounded, strictly-local self-metrics. Proves each metric kind, the percentile
// maths, the cardinality cap (no unbounded label explosion), the kill switch, and the summary.

beforeEach(() => { delete process.env.SAM_PULSE; _reset(); });
afterEach(() => { delete process.env.SAM_PULSE; _reset(); });

const find = (name: string, labels = "") => snapshot().find((m) => m.name === name && m.labels === labels);

describe("counters + gauges", () => {
  it("counters accumulate; separate label sets are separate series", () => {
    count("brain.calls", 1, { tier: "free" });
    count("brain.calls", 2, { tier: "free" });
    count("brain.calls", 1, { tier: "local" });
    expect(find("brain.calls", "tier=free")?.value).toBe(3);
    expect(find("brain.calls", "tier=local")?.value).toBe(1);
  });

  it("a gauge holds the latest value, not a sum", () => {
    gauge("mem.rss_mb", 100);
    gauge("mem.rss_mb", 140);
    expect(find("mem.rss_mb")?.value).toBe(140);
  });
});

describe("histograms — percentiles", () => {
  it("computes count, avg, p50, p95 over observations", () => {
    for (let i = 1; i <= 100; i++) observe("brain.latency_ms", i);
    const h = find("brain.latency_ms");
    expect(h?.count).toBe(100);
    expect(h?.avg).toBeCloseTo(50.5, 1);
    expect(h?.p50).toBeGreaterThanOrEqual(49);
    expect(h?.p50).toBeLessThanOrEqual(52);
    expect(h?.p95).toBeGreaterThanOrEqual(94);
  });
});

describe("cardinality guard", () => {
  it("collapses new series into an overflow bucket past the cap — never unbounded", () => {
    for (let i = 0; i < 5000; i++) count("noisy", 1, { id: `req-${i}` }); // adversarial: unique label per call
    // total distinct series stays bounded; the overflow lands in one bucket, not 5000.
    expect(snapshot().length).toBeLessThan(300);
    expect(snapshot().some((m) => m.labels.includes("__over__"))).toBe(true);
  });
});

describe("kill switch + summary", () => {
  it("SAM_PULSE=0 disables recording entirely", () => {
    process.env.SAM_PULSE = "0";
    count("brain.calls", 5, { tier: "free" });
    observe("brain.latency_ms", 10);
    expect(snapshot()).toHaveLength(0);
  });

  it("pulseSummary reports headline numbers incl. cache hit-rate", () => {
    count("brain.calls", 4, { tier: "free" });
    count("brain.failures", 1, { brain: "groq" });
    count("index.cache.hit", 8);
    count("index.cache.miss", 2);
    const s = pulseSummary();
    expect(s.brainCalls).toBe(4);
    expect(s.brainFailures).toBe(1);
    expect(s.cacheHitRate).toBe(0.8); // 8 hits / 10
  });

  it("cacheHitRate is null when nothing has been indexed (no divide-by-zero)", () => {
    expect(pulseSummary().cacheHitRate).toBeNull();
  });
});
