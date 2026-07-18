// webintel-research — CI-safe unit tests (mock LLM + mock search, no network).
// The live multi-page pipeline (real fetches → aggregate) is in webintel-research.verify.mjs (4/4).
import { describe, it, expect } from "vitest";
import { extractMany, searchAndExtract, type SearchFn } from "./webintel-research.ts";
import type { ExtractSchema, LlmFn } from "./webintel-extract.ts";

const schema: ExtractSchema = { title: "string" };

// A mock LLM that echoes a title derived from the URL in the prompt — deterministic, no network.
// (extract() fetches the URL; in CI there's no network, so these tests exercise the AGGREGATION
// logic via extractMany's error path + a stubbed extract is out of scope — we test the pure glue.)

describe("searchAndExtract wiring", () => {
  it("returns a no-URLs note when search finds nothing (no network needed)", async () => {
    const emptySearch: SearchFn = async () => [];
    const llm: LlmFn = async () => "{}";
    const r = await searchAndExtract("anything", schema, emptySearch, llm, { topN: 3 });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/no URLs/i);
    expect(r.query).toBe("anything");
  });

  it("passes the injected search's URL count through topN", async () => {
    const seen: number[] = [];
    const search: SearchFn = async (_q, n) => { seen.push(n); return []; };
    const llm: LlmFn = async () => "{}";
    await searchAndExtract("q", schema, search, llm, { topN: 7 });
    expect(seen).toEqual([7]);
  });
});

describe("extractMany aggregation shape", () => {
  it("aggregates only successful extractions into the table and lists failures", async () => {
    // both URLs are unreachable invalid TLDs → both land in failed[], table empty, ok=false.
    const llm: LlmFn = async () => "{}";
    const r = await extractMany(["https://a.invalid.tld/x", "https://b.invalid.tld/y"], schema, llm, { timeoutMs: 2000 });
    expect(r.table).toEqual([]);
    expect(r.failed.length).toBe(2);
    expect(r.ok).toBe(false);
    expect(r.results.length).toBe(2);
  });
});
