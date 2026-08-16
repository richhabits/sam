import { describe, it, expect } from "vitest";
import { CONNECTORS, connector, topLists } from "./connectors.registry.ts";

describe("CONNECTORS registry integrity", () => {
  it("every connector has a unique id", () => {
    const ids = CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every connector has required fields", () => {
    for (const c of CONNECTORS) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.env).toBeTruthy();
      expect(c.note).toBeTruthy();
      expect(c.url).toContain("http");
      expect(c.lists.length).toBeGreaterThan(0);
    }
  });

  it("every list has a unique kind within its connector", () => {
    for (const c of CONNECTORS) {
      const kinds = c.lists.map((l) => l.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it("drill targets reference a valid kind within the same connector", () => {
    for (const c of CONNECTORS) {
      const kinds = new Set(c.lists.map((l) => l.kind));
      for (const l of c.lists) {
        if (l.drill) {
          expect(kinds.has(l.drill)).toBe(true);
        }
      }
    }
  });
});

describe("connector()", () => {
  it("finds a connector by id", () => {
    const gh = connector("github");
    expect(gh).toBeTruthy();
    expect(gh!.label).toBe("GitHub");
  });

  it("returns undefined for an unknown id", () => {
    expect(connector("does_not_exist")).toBeUndefined();
  });
});

describe("topLists() — only lists that work without a param", () => {
  it("filters out lists that need a param to be useful", () => {
    const slack = connector("slack")!;
    const top = topLists(slack);
    // "channels" is top-level, "messages" needs a channel param
    expect(top.some((l) => l.kind === "channels")).toBe(true);
    expect(top.some((l) => l.kind === "messages")).toBe(false);
  });

  it("includes all lists when none have needs:true", () => {
    const notion = connector("notion")!;
    const top = topLists(notion);
    expect(top.length).toBe(notion.lists.length);
  });
});
