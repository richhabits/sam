import { describe, it, expect } from "vitest";
import { selectContext, admissible, score, keywords, type ProjectFile } from "./context.ts";

const f = (path: string, content: string): ProjectFile => ({ path, content, bytes: Buffer.byteLength(content) });

const PROJECT: ProjectFile[] = [
  f("index.html", "<h1>Hello</h1><p>welcome</p>"),
  f("styles.css", "h1 { color: red; }"),
  f("about.html", "<h1>About us</h1>"),
  f("README.md", "# Hello Site\n\nA page."),
  f("scripts/app.js", "console.log('booking form');"),
];

describe("what the request is about", () => {
  it("ignores words that carry no signal", () => {
    expect(keywords("please can you change the heading to Hectic")).toEqual(["heading", "hectic"]);
  });

  it("ranks a file named outright above everything else", () => {
    const named = score(f("styles.css", "x"), "update styles.css to use gold");
    const other = score(f("index.html", "x"), "update styles.css to use gold");
    expect(named).toBeGreaterThan(other);
  });

  it("nudges the page a web project starts from", () => {
    expect(score(f("index.html", "x"), "make the site darker")).toBeGreaterThan(score(f("other.html", "x"), "make the site darker"));
  });

  it("holds documentation back, since an edit rarely means the README", () => {
    // both mention "hello"; the README should still lose
    expect(score(f("README.md", "hello"), "change the hello heading"))
      .toBeLessThan(score(f("index.html", "hello"), "change the hello heading"));
  });

  it("still lets the README win when the request names it", () => {
    expect(score(f("README.md", "x"), "update the README with install steps")).toBeGreaterThan(0);
  });
});

describe("choosing what an edit sees", () => {
  it("offers the files the request implicates, best first", () => {
    const { offered } = selectContext(PROJECT, "change the heading on the page");
    expect(offered[0].path).toBe("index.html");
    expect(offered.map((o) => o.path)).not.toContain("README.md");
  });

  it("brings in a file the request names even when it is not the obvious one", () => {
    const { offered } = selectContext(PROJECT, "make the booking form validate");
    expect(offered.map((o) => o.path)).toContain("scripts/app.js");
  });

  // The trap this whole module exists for.
  it("NEVER cuts a file short — it leaves it out and says so", () => {
    const huge = f("huge.js", "x".repeat(50_000));
    const { offered, tooBig } = selectContext([...PROJECT, huge], "fix huge.js", { maxOne: 24_000 });
    expect(tooBig).toContain("huge.js");
    expect(offered.map((o) => o.path)).not.toContain("huge.js");
    // and nothing that IS offered has been shortened
    for (const o of offered) expect(o.content.length).toBe(o.bytes);
  });

  it("keeps within its budget by dropping whole files, not parts of them", () => {
    const big = [f("a.js", "a".repeat(5000)), f("b.js", "b".repeat(5000)), f("c.js", "c".repeat(5000))];
    // names all three, so all three are relevant and only the BUDGET decides
    const { offered, leftOut } = selectContext(big, "update a.js b.js and c.js", { maxBytes: 11_000 });
    expect(offered.length).toBe(2);
    expect(leftOut.length).toBe(1);
    for (const o of offered) expect(o.content.length).toBe(5000);
  });

  it("respects the file count cap", () => {
    // every file mentions the word, so all 30 are relevant and only the cap decides
    const many = Array.from({ length: 30 }, (_, i) => f(`f${i}.js`, "booking"));
    expect(selectContext(many, "update the booking logic", { maxFiles: 4 }).offered.length).toBe(4);
  });

  it("shows only what the request implicates, not everything that happens to fit", () => {
    // all five files fit easily; only the relevant one should be offered
    const { offered, leftOut } = selectContext(PROJECT, "change the heading on the page");
    expect(offered.map((o) => o.path)).toEqual(["index.html"]);
    expect(leftOut).toContain("README.md");
  });

  it("still gives a vague request somewhere to start rather than nothing", () => {
    const { offered } = selectContext(PROJECT, "tidy it up");
    expect(offered.length).toBe(1);
  });

  it("offers nothing when there is nothing editable", () => {
    expect(selectContext([], "anything").offered).toEqual([]);
  });
});

describe("what an edit may write back", () => {
  const offered = [f("index.html", "<h1>Hello</h1>")];
  const existing = [...offered, f("README.md", "# Hello Site")];

  it("accepts a change to a file it was shown", () => {
    const { write } = admissible([{ path: "index.html", content: "<h1>Hectic</h1>" }], offered, existing);
    expect(write).toEqual([{ path: "index.html", content: "<h1>Hectic</h1>" }]);
  });

  it("accepts a genuinely new file, because that is how a project grows", () => {
    const { write } = admissible([{ path: "styles.css", content: "h1{}" }], offered, existing);
    expect(write.map((w) => w.path)).toEqual(["styles.css"]);
  });

  // The unprompted tidying from the live drive.
  it("refuses a file that exists but this request never implicated", () => {
    const { write, refused } = admissible([{ path: "README.md", content: "# Rewritten" }], offered, existing);
    expect(write).toEqual([]);
    expect(refused[0].why).toMatch(/did not implicate it/);
  });

  it("refuses a file returned byte-for-byte unchanged", () => {
    const { write, refused } = admissible([{ path: "index.html", content: "<h1>Hello</h1>" }], offered, existing);
    expect(write).toEqual([]);
    expect(refused[0].why).toBe("unchanged");
  });

  it("refuses SAM's own record of the project", () => {
    const { write, refused } = admissible(
      [{ path: "project.sam.json", content: "{}" }], offered, existing, new Set(["project.sam.json"]),
    );
    expect(write).toEqual([]);
    expect(refused[0].why).toMatch(/not editable this way/);
  });

  it("refuses a kind of file the yard does not edit", () => {
    const { write, refused } = admissible([{ path: "run.sh", content: "rm -rf /" }], offered, existing);
    expect(write).toEqual([]);
    expect(refused[0].why).toMatch(/not a kind of file/);
  });

  it("applies the good part of a proposal and refuses the rest", () => {
    const { write, refused } = admissible([
      { path: "index.html", content: "<h1>Hectic</h1>" },
      { path: "README.md", content: "# Rewritten" },
    ], offered, existing);
    expect(write.map((w) => w.path)).toEqual(["index.html"]);
    expect(refused.map((r) => r.path)).toEqual(["README.md"]);
  });
});

describe("documentation is only in scope when it is asked for", () => {
  // A README repeats the project's own words, so it scores well on almost any request
  // about that project — and gets rewritten while a heading is being changed. It took a
  // rule, not a score, to stop it.
  const WITH_DOCS: ProjectFile[] = [
    f("index.html", "<h1>one-page hello site</h1>"),
    f("README.md", "# one-page hello site\n\none-page hello site\n\nBuilt by SAM."),
  ];

  it("keeps the README out of an ordinary edit, even when it matches every word", () => {
    const { offered, leftOut } = selectContext(WITH_DOCS, "change the heading on the one-page hello site to Hectic Bullz");
    expect(offered.map((o) => o.path)).toEqual(["index.html"]);
    expect(leftOut).toContain("README.md");
  });

  it("includes it the moment the request asks for it", () => {
    const { offered } = selectContext(WITH_DOCS, "update the README with install steps");
    expect(offered.map((o) => o.path)).toContain("README.md");
  });

  it("recognises the usual documentation names", async () => {
    const { isDocumentation } = await import("./context.ts");
    for (const p of ["README.md", "readme.txt", "docs/CHANGELOG.md", "LICENSE", "CONTRIBUTING.md"]) {
      expect(isDocumentation(p)).toBe(true);
    }
    expect(isDocumentation("index.html")).toBe(false);
    expect(isDocumentation("src/readme-parser.ts")).toBe(false);
  });
});
