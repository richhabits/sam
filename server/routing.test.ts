import { describe, expect, it } from "vitest";
import { routingReady, selectSkillId, selectTools } from "./routing.ts";

// routing.ts picks the RELEVANT tools per message instead of stuffing all ~185 (a ~5k-token
// bomb on a small free model). The semantic branch needs an embedding index built at boot; the
// SAFETY branch — what happens with NO index (fresh boot, model mismatch, offline) — is the one
// that must never regress, and it needs no network. These tests pin exactly that. Building the
// real index would clobber vault/routing_cache.json (doctrine: probes don't mutate state), so we
// stay on the query=null path throughout.

const CORE = ["web_search", "web_fetch", "run_command", "get_datetime", "read_file", "list_dir"];

describe("semantic routing — the no-index fallback (safety path)", () => {
  it("is not marked ready before any index is built", () => {
    expect(routingReady()).toBe(false);
  });

  it("always offers the CORE tools, even with no query and no index", () => {
    const tools = selectTools(null, 8, "");
    for (const c of CORE) expect(tools, c).toContain(c);
  });

  it("with no index, returns CORE + a BOUNDED keyword subset — never all ~185 tools", () => {
    const tools = selectTools(null, 8, "take a screenshot of the screen");
    expect(tools).toContain("read_file");           // CORE always present
    // The keyword branch caps its matches (slice 12) + CORE, so the set stays small — this is the
    // whole point of routing: don't hand a 3B model every tool. Assert it's nowhere near the full set.
    expect(tools.length).toBeLessThan(25);
    expect(new Set(tools).size).toBe(tools.length);   // no duplicates
  });

  it("de-dupes: a CORE tool that also keyword-matches appears once", () => {
    const tools = selectTools(null, 8, "read a file and search the web");
    expect(tools.filter((t) => t === "read_file")).toHaveLength(1);
    expect(tools.filter((t) => t === "web_search")).toHaveLength(1);
  });

  it("empty query text yields exactly the CORE set (nothing to keyword-match)", () => {
    expect(new Set(selectTools(null, 8, ""))).toEqual(new Set(CORE));
  });

  it("a query whose model doesn't match the (empty) index falls back, not into the semantic branch", () => {
    // model is "" until an index is built, so any q.model mismatches → keyword/CORE path.
    const tools = selectTools({ model: "some-embedder", vec: [0.1, 0.2, 0.3] }, 8, "screenshot");
    for (const c of CORE) expect(tools).toContain(c);
  });

  it("selectSkillId returns null when there's no usable index or query", () => {
    expect(selectSkillId(null)).toBeNull();
    expect(selectSkillId({ model: "some-embedder", vec: [0.1, 0.2] })).toBeNull();
  });
});
