// webintel-crawl — CI-safe unit tests (pure helpers + bounded behaviour; no live crawl in CI).
// The live crawl+map (60 URLs mapped, 3 Wikipedia pages crawled, robots honoured) is in
// webintel-crawl.verify.mjs (6/6). CI shouldn't hammer the network, so we test the glue: a
// crawl of unreachable URLs must terminate cleanly with empty pages, and map of a dead URL is ok:false.
//
// fetchClean is mocked rather than actually hit: mapSite's robots.txt fetch uses a hardcoded
// 6000ms timeout regardless of the caller's opts.timeoutMs, so two real DNS lookups against an
// invalid TLD could exceed vitest's 5000ms test timeout depending on the resolver's mood —
// flaked red in CI. Mocking removes the network dependency entirely, matching this file's own
// "no live crawl in CI" premise instead of quietly violating it.
import { describe, it, expect, vi } from "vitest";
import { crawl, mapSite } from "./webintel-crawl.ts";

vi.mock("./webintel.ts", () => ({
  fetchClean: vi.fn(async () => ({ ok: false, text: "", title: "", error: "getaddrinfo ENOTFOUND (mocked)" })),
}));

describe("crawl bounds & safety", () => {
  it("terminates cleanly when the start URL is unreachable (no throw, empty pages)", async () => {
    const r = await crawl("https://nonexistent.invalid.tld/start", { maxPages: 5, maxDepth: 2, delayMs: 0, timeoutMs: 2000, respectRobots: false });
    expect(r.pages).toEqual([]);
    expect(r.visited).toContain("https://nonexistent.invalid.tld/start");
    expect(r.start).toBe("https://nonexistent.invalid.tld/start");
  });

  it("respects maxPages=0 by fetching nothing", async () => {
    const r = await crawl("https://nonexistent.invalid.tld/x", { maxPages: 0, respectRobots: false, timeoutMs: 1000 });
    expect(r.pages).toEqual([]);
    expect(r.visited).toEqual([]); // loop never runs
  });
});

describe("mapSite", () => {
  it("returns ok:false with no urls for a dead host", async () => {
    const r = await mapSite("https://nonexistent.invalid.tld/x", { timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    expect(r.urls).toEqual([]);
    expect(r.start).toBe("https://nonexistent.invalid.tld/x");
  });
});
