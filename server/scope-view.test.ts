import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _reset, count, mark, observe } from "./pulse.ts";
import { renderScope, scopeData } from "./scope-view.ts";

// The Scope: live JSON + a self-contained polling page, strictly local. scopeData reads the Pulse;
// we seed it and check the compact shape. renderScope must poll ~1.5s, fetch only same-origin, and
// render the activity feed without an injection sink.

beforeEach(() => _reset());
afterEach(() => _reset());

describe("scopeData", () => {
  it("summarises the live Pulse into compact numbers", () => {
    count("brain.calls", 3, { tier: "free" });
    count("brain.failures", 1);
    count("brain.tokens", 4200, { tier: "free" });
    count("brain.cost_micro", 1500); // $0.0015
    count("index.cache.hit", 9);
    count("index.cache.miss", 1);
    observe("brain.latency_ms", 200, { tier: "free" });
    observe("brain.latency_ms", 400, { tier: "free" });
    mark("brain", "free · groq");
    const d = scopeData();
    expect(d.brainCalls).toBe(3);
    expect(d.failures).toBe(1);
    expect(d.tokens).toBe(4200);
    expect(d.costUsd).toBeCloseTo(0.0015, 4);
    expect(d.hitRate).toBe(0.9);
    expect(d.p50).toBeGreaterThan(0);
    expect(d.rssMb).toBeGreaterThan(0);
    expect(d.activity[0]).toMatchObject({ kind: "brain", label: "free · groq" });
  });

  it("empty registry gives zeros and a null hit-rate — no divide-by-zero", () => {
    const d = scopeData();
    expect(d.brainCalls).toBe(0);
    expect(d.hitRate).toBeNull();
    expect(d.activity).toEqual([]);
  });
});

describe("renderScope", () => {
  it("is a live page: polls every 1.5s and fetches only same-origin /api/scope", () => {
    const html = renderScope();
    expect(html).toContain("setInterval(poll, 1500)");
    expect(html).toContain('fetch("/api/scope"');
    expect(html).not.toMatch(/https?:\/\//); // no off-box fetch
    expect(html).toContain("<!doctype html>");
  });

  it("attaches the Handshake token when the renderer has one", () => {
    expect(renderScope()).toContain("window.samDesktop && window.samDesktop.controlToken");
    expect(renderScope()).toContain('H["X-SAM-Token"]');
  });

  it("renders activity via textContent, never innerHTML — the feed can't inject markup", () => {
    const html = renderScope();
    expect(html).toContain("l.textContent = a.label");
    // the only innerHTML use is clearing the feed to empty — never assigning activity into it.
    expect(html).not.toMatch(/innerHTML\s*=\s*[^"]*a\.label/);
  });
});

describe("scopeData — the Knack fields", () => {
  it("includes the enabled flag, applied count, and recent influences", () => {
    count("knack.applied", 2);
    const d = scopeData();
    expect(d).toHaveProperty("knackEnabled");
    expect(d).toHaveProperty("knack");
    expect(d.knackApplied).toBe(2);
    expect(Array.isArray(d.knack)).toBe(true);
  });
});
