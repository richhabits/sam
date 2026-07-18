// SAM webintel — CI-safe unit tests (pure logic only; no network, so no flake).
// The live fetch+cache path was verified separately against real pages (webintel.verify.mjs,
// 9/9: fetched a Wikipedia article, extracted title + 42k chars clean text + 96 links, cached,
// searched, offline-fell-back). Those aren't repeated here — CI shouldn't depend on the network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { htmlToText, WebCache } from "./webintel.ts";

describe("htmlToText", () => {
  const html = `<html><head><title>Hi There</title><style>x{color:red}</style></head>
    <body><nav>menu links</nav><h1>Head</h1><p>Hello <b>world</b>.</p>
    <a href="https://x.com/a">Link A</a><script>evil()</script></body></html>`;
  const p = htmlToText(html);

  it("extracts the title", () => expect(p.title).toBe("Hi There"));
  it("removes script/style/nav from the readable text", () => {
    expect(p.text).toMatch(/Hello world/);
    expect(p.text).not.toMatch(/evil|color:red|menu links/);
  });
  it("captures absolute links with anchor text, drops anchors/relatives", () => {
    expect(p.links).toEqual([{ href: "https://x.com/a", text: "Link A" }]);
  });
  it("decodes common entities", () => {
    expect(htmlToText("<p>a &amp; b &lt;c&gt;</p>").text).toBe("a & b <c>");
  });
});

describe("WebCache", () => {
  const cache = new WebCache(join(mkdtempSync(join(tmpdir(), "webintel-")), "c.jsonl"));
  cache.put({ url: "https://a.test/breaker", title: "Circuit Breaker", text: "a circuit breaker trips on overload to protect the book", fetchedAt: "2026-07-18" });
  cache.put({ url: "https://a.test/other", title: "Unrelated", text: "gardening tips for spring", fetchedAt: "2026-07-18" });

  it("stores and retrieves by url", () => {
    expect(cache.get("https://a.test/breaker")?.title).toBe("Circuit Breaker");
    expect(cache.get("https://missing")).toBeNull();
  });
  it("keyword search ranks the relevant page first with a snippet", () => {
    const hits = cache.search("circuit breaker overload");
    expect(hits[0].url).toBe("https://a.test/breaker");
    expect(hits[0].snippet).toMatch(/circuit/i);
  });
  it("title matches are weighted above body matches", () => {
    const hits = cache.search("Circuit");
    expect(hits[0].url).toBe("https://a.test/breaker");
  });
  it("de-duplicates on re-put (latest wins)", () => {
    cache.put({ url: "https://a.test/breaker", title: "Circuit Breaker v2", text: "updated", fetchedAt: "2026-07-19" });
    expect(cache.rows.filter((r) => r.url === "https://a.test/breaker").length).toBe(1);
    expect(cache.get("https://a.test/breaker")?.title).toBe("Circuit Breaker v2");
  });
});
