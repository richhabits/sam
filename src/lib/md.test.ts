import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./md";

describe("renderMarkdown", () => {
  it("escapes HTML to prevent injection", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
    expect(renderMarkdown("a < b & c")).toContain("&lt;");
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
