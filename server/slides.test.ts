import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import {
  MAX_SLIDES, MIN_SLIDES, buildDeck, deckFilename, fallbackSections,
  outlineMarkdown, parseSections, renderDeck, saveDeck, sectionCount,
} from "./slides.ts";

// slides.ts is deliberately model-free, so every one of these runs offline and costs nothing.
// The claims worth testing are the ones a user would be burned by: the deck has the shape a deck
// needs, the HTML really is self-contained (asserted, not trusted), a hostile topic can't write
// outside the vault, and nothing here falls over on empty or absurd input.
// test-setup.ts already points VAULT_DIR at a throwaway dir, so saveDeck writes there.

const sections = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ title: `Section ${i + 1}`, bullets: [`point ${i + 1}a`, `point ${i + 1}b`] }));

describe("deck structure", () => {
  it("opens with a title card, then an agenda, and lands on a closing", () => {
    const d = buildDeck({ topic: "Q3 roadmap", sections: sections(4) });
    expect(d.slides.map((s) => s.kind)).toEqual(["title", "agenda", "content", "content", "content", "closing"]);
    expect(d.slides[0].title).toBe("Q3 roadmap");
    expect(d.slides[d.slides.length - 1].title).toBe("Section 4");
  });

  it("asking for N slides gets N slides — the count is a promise, not a suggestion", () => {
    for (const n of [4, 8, 12, 30]) {
      expect(buildDeck({ topic: "t", sections: sections(sectionCount(n)) }).slides).toHaveLength(n);
    }
  });

  it("the agenda lists exactly the content slides — in order", () => {
    const d = buildDeck({ topic: "Pricing", sections: sections(3) });
    const content = d.slides.filter((s) => s.kind === "content").map((s) => s.title);
    expect(d.slides[1].bullets).toEqual(content);
  });

  it("the model's own final section IS the close — no synthetic slide stacked after it", () => {
    const d = buildDeck({ topic: "Series A", sections: [...sections(2), { title: "The ask", bullets: ["£2m"] }] });
    expect(d.slides.map((s) => s.kind).filter((k) => k === "closing")).toHaveLength(1);
    expect(d.slides[d.slides.length - 1].title).toBe("The ask");
    expect(d.slides[d.slides.length - 1].bullets).toEqual(["£2m"]);
    expect(d.slides[1].bullets).not.toContain("The ask");   // the close isn't an agenda item
  });

  it("a lone section keeps its slot and gets a stock close rather than becoming one", () => {
    const d = buildDeck({ topic: "One thing", sections: [{ title: "The thing", bullets: ["a"] }] });
    expect(d.slides.map((s) => s.kind)).toEqual(["title", "agenda", "content", "closing"]);
    expect(d.slides[3].title).toBe("Next steps");
  });

  it("an audience becomes the title card's eyebrow", () => {
    const d = buildDeck({ topic: "Retention", sections: sections(2), audience: "the board" });
    expect(d.audience).toBe("the board");
    expect(d.slides[0].subtitle).toBe("For the board");
    expect(renderDeck(d)).toContain("For the board");
  });

  it("sectionCount clamps to a presentable range and defaults sensibly", () => {
    expect(sectionCount(10)).toBe(8);
    expect(sectionCount(1)).toBe(MIN_SLIDES - 2);       // too few → floor
    expect(sectionCount(500)).toBe(MAX_SLIDES - 2);     // too many → ceiling
    expect(sectionCount(undefined)).toBe(6);            // default 8 total
    expect(sectionCount(Number.NaN)).toBe(6);           // junk → default, not NaN slides
  });

  it("the offline skeleton is a real deck, not an error page", () => {
    const s = fallbackSections("warehouse automation", 6);
    expect(s).toHaveLength(6);
    expect(s[0].bullets[0]).toContain("warehouse automation");
    expect(s[s.length - 1].title).toBe("Next steps");
    expect(s.every((x) => x.bullets.length > 0)).toBe(true);
  });
});

describe("parseSections — forgiving, because models are not", () => {
  it("reads the format actually asked for (## heading + - bullets)", () => {
    const out = parseSections("## The problem\n- costs 4 hours a week\n- nobody owns it\n\n## Why now\n- the contract ends in May");
    expect(out).toEqual([
      { title: "The problem", bullets: ["costs 4 hours a week", "nobody owns it"] },
      { title: "Why now", bullets: ["the contract ends in May"] },
    ]);
  });

  it("also reads bold headings, trailing-colon headings, and • bullets", () => {
    const out = parseSections("**Traction**\n• 4k users\nRisks:\n* churn");
    expect(out.map((s) => s.title)).toEqual(["Traction", "Risks"]);
    expect(out[0].bullets).toEqual(["4k users"]);
    expect(out[1].bullets).toEqual(["churn"]);
  });

  it("falls back to treating a bare numbered list as the sections", () => {
    expect(parseSections("1. Problem\n2. Solution\n3. Ask").map((s) => s.title)).toEqual(["Problem", "Solution", "Ask"]);
  });

  it("returns nothing for prose or an empty answer, so the caller can use the skeleton", () => {
    expect(parseSections("")).toEqual([]);
    expect(parseSections("Sure! Here is a nice deck for you to use today")).toEqual([]);
  });
});

describe("the rendered file is self-contained", () => {
  const html = renderDeck(buildDeck({ topic: "Offline decks", sections: sections(4), audience: "everyone" }));

  it("fetches NOTHING off the machine — no CDN, no fonts, no images, no analytics", () => {
    expect(html).not.toMatch(/https?:\/\//);     // the whole point: it works on a plane
    expect(html).not.toMatch(/<link\b/i);        // no external stylesheet
    expect(html).not.toMatch(/<img\b/i);         // no remote (or local sibling) asset
    expect(html).not.toMatch(/src\s*=/i);        // no script/iframe source of any kind
    expect(html).not.toMatch(/@import|url\(/i);  // no CSS pulling anything in
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket/);
  });

  it("carries its own CSS and nav JS inline", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    expect(html).toContain("ArrowRight");
  });

  it("styles both themes and has a print path", () => {
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("@media print");
    expect(html).toContain("page-break-after:always");
  });

  it("renders every slide, numbered, with the agenda as an ordered list", () => {
    const deck = buildDeck({ topic: "Offline decks", sections: sections(4) });
    const out = renderDeck(deck);
    expect((out.match(/<section class="slide/g) || [])).toHaveLength(deck.slides.length);
    expect(out).toContain(`1 / ${deck.slides.length}`);
    expect(out).toContain("<ol>");
  });

  it("ESCAPES everything from the user — a deck is not an injection sink", () => {
    const out = renderDeck(buildDeck({ topic: `<script>alert(1)</script>`, sections: [{ title: `"><img onerror=x>`, bullets: [`a & b <b>`] }] }));
    expect(out).not.toContain("<script>alert(1)");
    expect(out).toContain("&lt;script&gt;alert(1)");
    expect(out).toContain("&amp;");
    expect(out).not.toMatch(/<img\b/i);
  });
});

describe("filenames cannot escape the vault", () => {
  const at = new Date("2026-08-01T09:00:00.000Z");

  it("a traversal topic becomes an inert slug", () => {
    const f = deckFilename("../../etc/x", at);
    expect(f).toBe("2026-08-01-etc-x.html");
    expect(f).not.toContain("..");
    expect(f).not.toContain("/");
    expect(f).not.toContain("\\");
  });

  it("absolute paths, backslashes and NUL survive as nothing but dashes", () => {
    for (const nasty of ["/etc/passwd", "C:\\Windows\\system32", "a\u0000b", "....//....//x"]) {
      const f = deckFilename(nasty, at);
      expect(f).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]*\.html$/);
    }
  });

  it("an empty or symbol-only topic still yields a usable name", () => {
    expect(deckFilename("", at)).toBe("2026-08-01-deck.html");
    expect(deckFilename("!!! ??? ***", at)).toBe("2026-08-01-deck.html");
  });

  it("a 10,000-character topic does not produce a 10,000-character filename", () => {
    expect(deckFilename("x".repeat(10_000), at).length).toBeLessThan(80);
  });

  it("saveDeck writes inside the vault's decks folder and the file is the rendered deck", () => {
    const deck = buildDeck({ topic: "../../etc/passwd", sections: sections(2), now: at });
    const file = saveDeck(deck);
    const vault = resolve(process.env.VAULT_DIR as string);
    expect(resolve(file).startsWith(vault + sep)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(renderDeck(deck));
  });

  it("never overwrites an earlier deck on the same topic and day", () => {
    const deck = buildDeck({ topic: "same day twice", sections: sections(2), now: at });
    const a = saveDeck(deck);
    const b = saveDeck(deck);
    expect(b).not.toBe(a);
    expect(b).toContain("-2.html");
  });
});

describe("empty and oversized input", () => {
  it("refuses a deck with no topic rather than making one up", () => {
    expect(() => buildDeck({ topic: "", sections: sections(2) })).toThrow(/topic/);
    expect(() => buildDeck({ topic: "   \n  ", sections: sections(2) })).toThrow(/topic/);
  });

  it("no sections at all still produces a presentable deck (the skeleton)", () => {
    const d = buildDeck({ topic: "Anything", sections: [] });
    expect(d.slides.length).toBeGreaterThanOrEqual(MIN_SLIDES);
    expect(d.slides[0].kind).toBe("title");
    expect(d.slides[d.slides.length - 1].kind).toBe("closing");
  });

  it("truncates a runaway topic, title and bullet instead of rendering a wall of text", () => {
    const d = buildDeck({
      topic: "T".repeat(5000),
      sections: [{ title: "H".repeat(5000), bullets: ["B".repeat(5000)] }],
    });
    expect(d.title.length).toBeLessThanOrEqual(120);
    expect(d.slides[2].title.length).toBeLessThanOrEqual(90);
    expect(d.slides[2].bullets[0].length).toBeLessThanOrEqual(180);
    expect(d.title.endsWith("…")).toBe(true);
  });

  it("caps bullets per slide and sections per deck — a slide is a billboard, not a document", () => {
    const d = buildDeck({
      topic: "Too much",
      sections: Array.from({ length: 200 }, (_, i) => ({ title: `S${i}`, bullets: Array.from({ length: 40 }, (_, j) => `b${j}`) })),
    });
    expect(d.slides.length).toBeLessThanOrEqual(MAX_SLIDES);
    expect(Math.max(...d.slides.map((s) => s.bullets.length))).toBeLessThanOrEqual(Math.max(6, MAX_SLIDES - 2));
    expect(d.slides.filter((s) => s.kind === "content").every((s) => s.bullets.length <= 6)).toBe(true);
  });

  it("flattens newlines and markdown out of bullets so the layout can't be broken by input", () => {
    const d = buildDeck({ topic: "Clean", sections: [{ title: "**Bold**", bullets: ["one\ntwo   three"] }] });
    expect(d.slides[2].title).toBe("Bold");
    expect(d.slides[2].bullets[0]).toBe("one two three");
  });
});

describe("the chat outline", () => {
  it("shows every slide and its bullets, plus where the file went", () => {
    const d = buildDeck({ topic: "Warehouse", sections: sections(3), audience: "ops" });
    const md = outlineMarkdown(d, "/tmp/x/deck.html");
    expect(md).toContain("/tmp/x/deck.html");
    expect(md).toContain("for ops");
    expect(md).toContain(`${d.slides.length} slides`);
    for (const s of d.slides) expect(md).toContain(s.title);
    expect(md).toContain("- point 1a");
    expect(md).toContain("title card");
  });
});
