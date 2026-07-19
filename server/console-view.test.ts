import { describe, expect, it } from "vitest";
import { renderConsole } from "./console-view.ts";
import type { MetricView } from "./pulse.ts";
import type { Issue } from "./issues.ts";

// The Console is server-rendered, self-contained, strictly local. renderConsole is pure, so we test
// it directly: the right numbers, threshold colours, escaped issue text, a sparkline, and — the
// privacy line — nothing that reaches off the machine (no external URLs, scripts, or fonts).

const counter = (name: string, value: number, labels = ""): MetricView => ({ name, labels, kind: "counter", value });
const hist = (name: string, p50: number, p95: number, labels = ""): MetricView => ({ name, labels, kind: "histogram", count: 10, avg: p50, p50, p95 });
const issue = (message: string, count = 1): Issue => ({ fingerprint: "f", message, count, firstAt: "2026-07-19T10:00:00.000Z", lastAt: "2026-07-19T10:30:15.000Z", context: {}, trail: [] });

const NOW = "2026-07-19T12:00:00.000Z";

describe("renderConsole", () => {
  it("shows the headline numbers as stat tiles", () => {
    const html = renderConsole([counter("brain.calls", 42, "tier=free"), counter("brain.tokens", 12000)], [], [], NOW);
    expect(html).toContain("Brain calls");
    expect(html).toContain(">42<");
    expect(html).toContain("12k"); // tokens formatted
  });

  it("threshold colours: failures→warn, breaker trips→bad, low hit-rate→warn", () => {
    const html = renderConsole([
      counter("brain.failures", 3), counter("breaker.open", 1),
      counter("index.cache.hit", 2), counter("index.cache.miss", 8), // 20% → warn
    ], [], [], NOW);
    expect(html).toMatch(/tile warn"[\s\S]*Failures/);
    expect(html).toMatch(/tile bad"[\s\S]*Breaker trips/);
    expect(html).toMatch(/20%/);
    expect(html).toMatch(/tile warn"[\s\S]*Cache hit-rate/);
  });

  it("all-healthy renders ok tiles and an all-clear issues row", () => {
    const html = renderConsole([counter("brain.calls", 5), counter("brain.failures", 0)], [], [], NOW);
    expect(html).toMatch(/tile ok"[\s\S]*Failures/);
    expect(html).toContain("All clear");
  });

  it("ESCAPES issue text — a local view must not become an injection sink", () => {
    const html = renderConsole([], [issue("<script>alert(1)</script> boom", 4)], [], NOW);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("4×");
  });

  it("renders a sparkline path for samples, a flat baseline for too few", () => {
    expect(renderConsole([], [], [10, 40, 20, 80, 30], NOW)).toMatch(/<path d="M[\d. ]+L/);
    expect(renderConsole([], [], [], NOW)).toContain("M0 22 L100 22"); // empty → baseline, not blank
  });

  it("is strictly local — no external URLs, scripts, or fonts", () => {
    const html = renderConsole([hist("brain.latency_ms", 200, 900, "tier=free")], [issue("x")], [200, 300], NOW);
    expect(html).not.toMatch(/https?:\/\//); // nothing to fetch off-box
    expect(html).not.toContain("<script"); // no JS at all — pure server-rendered
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("nothing leaves this machine");
  });
});

describe("the Knack panel", () => {
  it("renders each learned influence attributably (pattern → value + confidence)", () => {
    const html = renderConsole([], [], [], "2026-07-19T12:00:00.000Z", {
      enabled: true,
      recent: [{ pattern: "preferred-tier", value: "local", confidence: 0.8, at: "2026-07-19T12:00:00.000Z" }],
    });
    expect(html).toContain("The Knack — learned influence");
    expect(html).toContain("preferred-tier → local");
    expect(html).toContain("0.80");
  });
  it("shows the OFF state explicitly (radical transparency) — default arg too", () => {
    expect(renderConsole([], [], [], "t", { enabled: false, recent: [] })).toContain("The Knack is off");
    expect(renderConsole([], [], [], "t")).toContain("The Knack is off");   // defaulted param, back-compatible
  });
  it("escapes a hostile pattern/value (no injection)", () => {
    const html = renderConsole([], [], [], "t", { enabled: true, recent: [{ pattern: "<script>x", value: "y", confidence: 1, at: "2026-07-19T12:00:00.000Z" }] });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;x");
  });
});
