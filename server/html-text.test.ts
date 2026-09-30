// CodeQL js/incomplete-multi-character-sanitization + js/double-escaping
// (tools.ts webSearch, yard/tree.ts summarise).
import { describe, expect, it } from "vitest";
import { decodeEntities, stripTags } from "./html-text.ts";
import { summarise } from "./yard/tree.ts";

describe("stripTags", () => {
  it("removes ordinary tags and keeps the text", () => {
    expect(stripTags("a <b>bold</b> move")).toBe("a bold move");
    expect(stripTags("no markup")).toBe("no markup");
  });

  it("leaves no tag behind when removal would weld a new one together", () => {
    for (const evil of ["<scr<b>ipt>alert(1)</script>", "<<script>script>x", "<scr<script>ipt>", "<scr<!-- -->ipt>"]) {
      const out = stripTags(evil);
      expect(out).not.toContain("<");
      expect(out.toLowerCase()).not.toContain("<script");
    }
  });

  it("drops an unterminated '<' instead of leaving a half tag", () => {
    expect(stripTags("hello <script src=x")).toBe("hello script src=x");
    expect(stripTags("a <<script")).toBe("a script");
    expect(stripTags("hello <script src=x")).not.toContain("<script");
  });

  it("is linear on a long run of '<'", () => {
    const t0 = performance.now();
    const out = stripTags("<".repeat(50_000));
    expect(performance.now() - t0).toBeLessThan(100);
    expect(out).toBe("");
  });
});

describe("decodeEntities", () => {
  it("decodes the entities search results use", () => {
    expect(decodeEntities("Tom &amp; Jerry &#x27;s &quot;show&quot;")).toBe(`Tom & Jerry 's "show"`);
  });

  it("decodes once: an escaped entity stays literal text", () => {
    expect(decodeEntities("&amp;quot;")).toBe("&quot;");
    expect(decodeEntities("&amp;#x27;")).toBe("&#x27;");
    expect(decodeEntities("&amp;amp;")).toBe("&amp;");
  });
});

describe("yard summarise h1", () => {
  it("strips tags inside an h1 and cannot be made to emit markup", () => {
    expect(summarise("index.html", "<h1>Hello <em>world</em></h1>")).toBe('h1 "Hello world"');
    const s = summarise("index.html", "<h1><scr<b>ipt>x</h1>");
    expect(s).not.toContain("<");
  });
});
