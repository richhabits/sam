// executeToolBatch's within-batch cache for `cacheable` tools — added alongside the git-grep
// search speedup as the other half of the "make SAM's tool loop fast" work. Scoped deliberately
// narrow: only dedupes identical calls inside ONE parallel batch, never across steps of the
// loop, because every call in a batch runs at the same instant — there's no write-then-read
// ordering a stale cache entry could violate the way there would be across an entire multi-step
// run (SAM's own write tools change files mid-run; caching git_diff/git_status across steps
// would risk showing stale state right after SAM edits something itself).
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Record<string, number> = {};
function makeTool(name: string, cacheable: boolean) {
  return {
    name,
    safe: true,
    cacheable,
    description: "",
    params: "",
    activity: () => "",
    run: async (input: any) => {
      calls[name] = (calls[name] || 0) + 1;
      return `result:${name}:${JSON.stringify(input)}`;
    },
  };
}

const registry: Record<string, any> = {
  cached_tool: makeTool("cached_tool", true),
  uncached_tool: makeTool("uncached_tool", false),
};

vi.mock("./tools.ts", () => ({
  TOOLS: [],
  toolByName: (name: string) => registry[name],
  toolCatalogue: () => "",
}));

import { executeToolBatch } from "./agent.ts";

beforeEach(() => {
  calls.cached_tool = 0;
  calls.uncached_tool = 0;
});

describe("executeToolBatch — within-batch dedup for cacheable tools", () => {
  it("runs a cacheable tool once for two identical calls in the same batch", async () => {
    const run = await executeToolBatch([
      { tool: "cached_tool", input: { path: "x.ts" } },
      { tool: "cached_tool", input: { path: "x.ts" } },
    ]);
    expect(run.parallel).toBe(true);
    expect(calls.cached_tool).toBe(1);
    expect(run.results![0].result).toContain("result:cached_tool");
    expect(run.results![1].result).toBe(run.results![0].result);
  });

  it("still runs a cacheable tool twice when the input actually differs", async () => {
    await executeToolBatch([
      { tool: "cached_tool", input: { path: "x.ts" } },
      { tool: "cached_tool", input: { path: "y.ts" } },
    ]);
    expect(calls.cached_tool).toBe(2);
  });

  it("never dedupes a non-cacheable tool, even with identical input", async () => {
    await executeToolBatch([
      { tool: "uncached_tool", input: { q: 1 } },
      { tool: "uncached_tool", input: { q: 1 } },
    ]);
    expect(calls.uncached_tool).toBe(2);
  });
});
