import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexProject, renderIndex, summarise } from "./tree.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "samyard-tree-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const write = (rel: string, content: string) => {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
};

describe("summarising a file from what is already in it", () => {
  it("reads a page's title and heading", () => {
    const s = summarise("index.html", "<html><head><title>Bookings</title></head><body><h1>Book a stud</h1></body>");
    expect(s).toContain('title "Bookings"');
    expect(s).toContain("Book a stud");
  });

  it("reads a markdown heading", () => {
    expect(summarise("README.md", "# Hectic Bullz\n\nsome text")).toContain("Hectic Bullz");
  });

  it("reads what a module exports", () => {
    const s = summarise("lib.ts", "export function bookSlot() {}\nexport const RATE = 1;\n");
    expect(s).toBe("exports bookSlot, RATE");
  });

  it("reads a package manifest properly, since it says what the project is", () => {
    const s = summarise("package.json", JSON.stringify({ name: "booking", dependencies: { react: "^19", vite: "^7" } }));
    expect(s).toContain('package "booking"');
    expect(s).toContain("react");
  });

  it("reads stylesheet selectors", () => {
    expect(summarise("app.css", ".hero { color: red }\n#nav { }")).toContain(".hero");
  });

  it("falls back to a leading comment when a module exports nothing", () => {
    expect(summarise("run.js", "// starts the dev server\nconsole.log(1)")).toBe("starts the dev server");
  });
});

describe("indexing a whole project", () => {
  it("lists every file, nested included", () => {
    write("index.html", "<title>Home</title>");
    write("src/app.ts", "export const go = 1;");
    write("docs/notes.md", "# Notes");
    const files = indexProject(dir).map((f) => f.path).sort();
    expect(files).toEqual(["docs/notes.md", "index.html", "src/app.ts"]);
  });

  it("skips dependencies and build output — indexing them would cost more than the build", () => {
    write("index.html", "<title>Home</title>");
    write("node_modules/react/index.js", "module.exports = {}");
    write("dist/bundle.js", "console.log(1)");
    expect(indexProject(dir).map((f) => f.path)).toEqual(["index.html"]);
  });

  it("still lists a file it cannot summarise, because knowing it exists is the point", () => {
    write("logo.png", "not really a png");
    const f = indexProject(dir).find((x) => x.path === "logo.png");
    expect(f).toBeTruthy();
    expect(f?.summary).toBe("");
  });

  it("stops at the ceiling rather than walking an unbounded tree", () => {
    for (let i = 0; i < 30; i++) write(`f${i}.md`, `# ${i}`);
    expect(indexProject(dir, { maxFiles: 10 })).toHaveLength(10);
  });

  it("renders one line per file", () => {
    write("index.html", "<title>Home</title>");
    write("src/app.ts", "export const go = 1;");
    const out = renderIndex(indexProject(dir));
    expect(out.split("\n")).toHaveLength(2);
    expect(out).toContain("index.html —");
    expect(out).toContain("exports go");
  });

  it("says so when there is nothing there", () => {
    expect(renderIndex([])).toContain("empty");
  });
});
