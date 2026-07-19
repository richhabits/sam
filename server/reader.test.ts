import { describe, expect, it } from "vitest";
import { distill } from "./reader.ts";

// The Reader keeps STRUCTURE (headings/lists/links → markdown), prefers the article region, prunes
// nav-like blocks, and — the safety line — returns null when there's too little to distil so the
// caller falls back to the plain cleaner rather than serving an empty result.

const page = (body: string, title = "Doc") => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
const prose = "This is a long paragraph of genuine article content that carries the real meaning of the page and comfortably clears the minimum-content threshold so the Reader keeps it. ".repeat(2);

describe("distill → markdown", () => {
  it("keeps headings, lists and inline emphasis as markdown", () => {
    const d = distill(page(`<article><h2>Findings</h2><p>${prose}</p><ul><li>First point</li><li>Second point</li></ul><p>It was <strong>bold</strong> and <em>clear</em>.</p></article>`));
    expect(d).not.toBeNull();
    expect(d!.markdown).toContain("## Findings");
    expect(d!.markdown).toContain("- First point");
    expect(d!.markdown).toContain("- Second point");
    expect(d!.markdown).toContain("**bold**");
    expect(d!.markdown).toContain("*clear*");
  });

  it("turns links into markdown and collects them", () => {
    const d = distill(page(`<article><p>${prose} See <a href="https://example.com/x">the source</a> for more.</p></article>`));
    expect(d!.markdown).toContain("[the source](https://example.com/x)");
    expect(d!.links).toContainEqual({ href: "https://example.com/x", text: "the source" });
  });

  it("uses the article region and drops surrounding chrome", () => {
    const html = page(`<nav><a href="https://s/1">Home</a> <a href="https://s/2">About</a></nav><article><h1>Real Title</h1><p>${prose}</p></article><footer><a href="https://s/3">Privacy</a></footer>`);
    const d = distill(html);
    expect(d!.markdown).toContain("Real Title");
    expect(d!.markdown).not.toContain("Privacy"); // footer chrome stripped
  });

  it("prunes a short block that is mostly links (a menu), keeps prose with a link", () => {
    const menu = `<p><a href="https://s/a">One</a> <a href="https://s/b">Two</a> <a href="https://s/c">Three</a> <a href="https://s/d">Four</a></p>`;
    const d = distill(page(`<article>${menu}<p>${prose} and a <a href="https://s/z">single link</a> in real prose.</p></article>`));
    // the dense little link block is gone; the prose paragraph (with its one link) stays
    expect(d!.markdown).toContain("single link");
    expect(d!.markdown).not.toMatch(/One[\s\S]*Two[\s\S]*Three[\s\S]*Four/);
  });

  it("decodes entities", () => {
    const d = distill(page(`<article><p>${prose} Tom &amp; Jerry &lt;3 &quot;quotes&quot;</p></article>`));
    expect(d!.markdown).toContain('Tom & Jerry <3 "quotes"');
  });
});

describe("distill → null (fall back to the plain cleaner)", () => {
  it("returns null for an empty or trivially short page", () => {
    expect(distill("")).toBeNull();
    expect(distill("<html><body></body></html>")).toBeNull();
  });

  it("returns null for a JS-shell page with almost no server-rendered content", () => {
    expect(distill(page(`<div id="root"></div><script>renderApp()</script>`))).toBeNull();
  });
});
