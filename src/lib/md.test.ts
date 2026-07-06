import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./md";

describe("renderMarkdown", () => {
  it("escapes HTML to prevent injection", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
    expect(renderMarkdown("a < b & c")).toContain("&lt;");
  });
  it("cannot break out of a URL attribute to inject an event handler (XSS)", () => {
    // The danger is a RAW quote closing src="…" and starting a new attribute. After the fix every
    // quote is encoded (&quot;), so the handler text stays trapped inside the attribute value.
    const img = renderMarkdown('![x](https://a.com"onerror="alert(1))');
    expect(img).not.toContain('"onerror');   // no raw-quote breakout
    expect(img).toContain("&quot;");           // the quote was escaped
    const link = renderMarkdown('[t](https://a.com"onmouseover="alert(1))');
    expect(link).not.toContain('"onmouseover');
    // The alt-text path must be safe too.
    expect(renderMarkdown('![x"onload="alert(1)](https://a.com)')).not.toContain('"onload');
  });
  it("renders bold, code and links", () => {
    expect(renderMarkdown("**hi**")).toContain("<strong>hi</strong>");
    expect(renderMarkdown("`x`")).toContain("<code>x</code>");
    expect(renderMarkdown("see https://a.com now")).toContain('<a href="https://a.com"');
  });
  it("renders bullet and numbered lists", () => {
    expect(renderMarkdown("- one\n- two")).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(renderMarkdown("1. a\n2. b")).toContain("<ol><li>a</li><li>b</li></ol>");
  });
  it("wraps plain lines in paragraphs", () => {
    expect(renderMarkdown("hello")).toBe("<p>hello</p>");
  });
  it("renders headings, blockquotes and dividers", () => {
    expect(renderMarkdown("## Title")).toBe("<h3>Title</h3>");
    expect(renderMarkdown("> quoted")).toBe("<blockquote>quoted</blockquote>");
    expect(renderMarkdown("---")).toBe("<hr>");
  });
});
