import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePreview, projectFiles, readProjectFile } from "./preview.ts";
import { createProject, projectPath } from "./managed.ts";

// "Serve a file from a path in the URL" is the oldest way to hand over a machine, so
// most of this file is about what must NOT be served.

let base: string;
const hs = { handshake: true };

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "yard-preview-"));
  process.env.SAMYARD_DIR = base;
  process.env.SAM_YARD = "1";
  await createProject("Site", { spec: "a page", ...hs });
  const dir = projectPath("site");
  writeFileSync(join(dir, "index.html"), "<h1>hello</h1>");
  writeFileSync(join(dir, "styles.css"), "h1{color:gold}");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "logo.svg"), "<svg/>");
});
afterEach(() => {
  delete process.env.SAMYARD_DIR; delete process.env.SAM_YARD;
  rmSync(base, { recursive: true, force: true });
});

describe("serving a project's own files", () => {
  it("serves the front page for the project root", () => {
    const r = resolvePreview("site", "");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.path).toMatch(/index\.html$/); expect(r.type).toMatch(/text\/html/); }
  });

  it("serves an asset with the right type", () => {
    const css = resolvePreview("site", "styles.css");
    expect(css.ok && css.type).toMatch(/text\/css/);
    const svg = resolvePreview("site", "assets/logo.svg");
    expect(svg.ok && svg.type).toBe("image/svg+xml");
  });

  it("serves a folder's index.html", () => {
    mkdirSync(join(projectPath("site"), "about"), { recursive: true });
    writeFileSync(join(projectPath("site"), "about", "index.html"), "<h1>about</h1>");
    const r = resolvePreview("site", "about");
    expect(r.ok).toBe(true);
  });

  it("refuses a folder with no index", () => {
    const r = resolvePreview("site", "assets");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});

describe("what must never be served", () => {
  it("refuses a traversal, however it is spelled", () => {
    for (const p of ["../../../etc/passwd", "..%2F..%2Fetc", "assets/../../../../etc/hosts", "/etc/passwd"]) {
      const r = resolvePreview("site", p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect([403, 404, 415]).toContain(r.status);
    }
  });

  it("refuses the project's own git directory — that is every version of every file", () => {
    for (const q of [".git/config", ".git/HEAD", "assets/../.git/config"]) {
      const r = resolvePreview("site", q);
      expect(r.ok).toBe(false);
    }
  });

  // The one string-matching always misses.
  it("refuses a symlink that points out of the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "secret.txt"), "not yours");
    try {
      symlinkSync(outside, join(projectPath("site"), "bridge"));
      const r = resolvePreview("site", "bridge/secret.txt");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it("refuses a kind of file a page has no business asking for", () => {
    writeFileSync(join(projectPath("site"), "notes.sh"), "rm -rf /");
    const r = resolvePreview("site", "notes.sh");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });

  it("refuses a project that does not exist", () => {
    const r = resolvePreview("not-a-project", "index.html");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("refuses a file that is not there, without saying anything about the machine", () => {
    const r = resolvePreview("site", "nope.html");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(404); expect(r.reason).not.toContain(base); }
  });
});

describe("listing what is in a project", () => {
  it("lists the files, and not the machinery", () => {
    const files = projectFiles("site").map((f) => f.path);
    expect(files).toContain("index.html");
    expect(files).toContain("assets/logo.svg");
    expect(files.some((f) => f === ".git" || f.startsWith(".git/"))).toBe(false);
    expect(files).toContain(".gitignore");   // a real project file, unlike the .git directory
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("does not drown in a dependency tree", () => {
    const nm = join(projectPath("site"), "node_modules", "big");
    mkdirSync(nm, { recursive: true });
    for (let i = 0; i < 40; i++) writeFileSync(join(nm, `f${i}.js`), "x");
    expect(projectFiles("site").some((f) => f.path.includes("node_modules"))).toBe(false);
  });

  it("gives nothing for a project it does not manage", () => {
    expect(projectFiles("nope")).toEqual([]);
  });

  it("reads a file's text through the same checks", () => {
    expect(readProjectFile("site", "index.html")).toBe("<h1>hello</h1>");
    expect(readProjectFile("site", "../../../etc/passwd")).toBeNull();
    expect(readProjectFile("site", ".git/config")).toBeNull();
  });
});
