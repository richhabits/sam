import { describe, expect, it } from "vitest";
import { bucketOf, cleanTitle, groupByRecency, matchesQuery, snippetFor } from "./chatTitle";

describe("cleanTitle", () => {
  it("returns short messages unchanged apart from sentence-casing", () => {
    expect(cleanTitle("triage my inbox")).toBe("Triage my inbox");
    expect(cleanTitle("Stealth")).toBe("Stealth");
  });

  it("strips leading emoji so the title starts with words", () => {
    expect(cleanTitle("👁️ looking through the camera")).toBe("Looking through the camera");
    expect(cleanTitle("🚀🔥 ship it")).toBe("Ship it");
  });

  it("keeps emoji that are not leading", () => {
    expect(cleanTitle("ship it 🚀")).toBe("Ship it 🚀");
  });

  it("lifts a slash-command into a readable prefix", () => {
    expect(cleanTitle("/research quantum error correction")).toBe("Research: quantum error correction");
    expect(cleanTitle("/notes")).toBe("Notes");
  });

  it("flattens newlines and code fences", () => {
    expect(cleanTitle("fix this\n```js\nconst a = 1\n```\nplease")).toBe("Fix this please");
    expect(cleanTitle("`npm test` is failing")).toBe("Npm test is failing");
  });

  it("truncates on a word boundary, not mid-word", () => {
    const t = cleanTitle("what should I do next with the deployment pipeline", 30);
    expect(t.endsWith("…")).toBe(true);
    // No dangling partial word before the ellipsis.
    expect(t).toBe("What should I do next with…");
    expect(t.length).toBeLessThanOrEqual(31);
  });

  it("falls back to a hard cut when a single token exceeds the budget", () => {
    const t = cleanTitle("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 10);
    expect(t).toBe("Aaaaaaaaaa…");
  });

  it("handles empty and undefined input", () => {
    expect(cleanTitle(undefined)).toBe("");
    expect(cleanTitle("   ")).toBe("");
    expect(cleanTitle("😀")).toBe("");
  });

  it("strips wrapping quotes", () => {
    expect(cleanTitle('"summarise this"')).toBe("Summarise this");
  });
});

describe("bucketOf / groupByRecency", () => {
  const now = new Date("2026-07-18T15:00:00").getTime();
  const day = 86400000;

  it("buckets by local calendar day", () => {
    expect(bucketOf(now, now)).toBe("Today");
    expect(bucketOf(new Date("2026-07-18T00:30:00").getTime(), now)).toBe("Today");
    expect(bucketOf(new Date("2026-07-17T23:59:00").getTime(), now)).toBe("Yesterday");
    expect(bucketOf(now - 3 * day, now)).toBe("Previous 7 days");
    expect(bucketOf(now - 30 * day, now)).toBe("Earlier");
  });

  it("drops empty buckets and preserves input order", () => {
    const items = [
      { at: now, id: "a" },
      { at: now - 60000, id: "b" },
      { at: now - 30 * day, id: "c" },
    ];
    const groups = groupByRecency(items, now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Earlier"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["c"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupByRecency([], now)).toEqual([]);
  });
});

describe("matchesQuery", () => {
  it("matches on title", () => {
    expect(matchesQuery("inbox", "Triage my inbox", [])).toBe(true);
  });

  it("matches on message content the title never mentions", () => {
    expect(matchesQuery("kubernetes", "Stealth", ["let's talk about Kubernetes ingress"])).toBe(true);
  });

  it("is case-insensitive and trims the query", () => {
    expect(matchesQuery("  INBOX ", "triage my inbox", [])).toBe(true);
  });

  it("matches everything on an empty query", () => {
    expect(matchesQuery("", "anything", [])).toBe(true);
  });

  it("rejects a non-match", () => {
    expect(matchesQuery("zebra", "Triage my inbox", ["nothing here"])).toBe(false);
  });
});

describe("snippetFor", () => {
  it("returns context around the hit", () => {
    const s = snippetFor("ingress", ["we should talk about kubernetes ingress controllers today"]);
    expect(s.toLowerCase()).toContain("ingress");
    expect(s).toContain("…");
  });

  it("returns empty when nothing matches", () => {
    expect(snippetFor("zebra", ["no match here"])).toBe("");
    expect(snippetFor("", ["anything"])).toBe("");
  });
});
