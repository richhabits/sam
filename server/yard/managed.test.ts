import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  slugify, uniqueSlug, createProject, checkpoint, checkpoints, restore,
  readManifest, updateManifest, listProjects, projectPath, isManagedProject,
} from "./managed.ts";

// The promise this file makes is that work is never lost: every completed step is
// already committed, and going back is a checkout. These tests are that promise.

// Nearly every test here does REAL git work (init + commits) in a temp repo. Git I/O under the
// full suite's parallel load occasionally crosses vitest's 5s default — a flake with no bug behind
// it (each test passes alone). A generous per-test ceiling removes the false red without hiding a
// genuinely slow test: a real hang still trips it, just not honest I/O contention.
vi.setConfig({ testTimeout: 20_000 });

let base: string;
const hs = { handshake: true };   // project management runs inside jobs, behind the Handshake

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "samyard-"));
  process.env.SAMYARD_DIR = base;
});
afterEach(() => {
  delete process.env.SAMYARD_DIR;
  rmSync(base, { recursive: true, force: true });
});

describe("naming a project", () => {
  it("builds a safe slug from whatever it is given", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Romeo's Café!! 2026")).toBe("romeo-s-caf-2026");
    expect(slugify("   ")).toBe("project");
  });

  it("cannot be talked into climbing out of the projects folder", () => {
    for (const nasty of ["../../etc/passwd", "..", "/etc/passwd", "~/.ssh", "a/../../b"]) {
      const s = slugify(nasty);
      expect(s).not.toContain("/");
      expect(s).not.toContain("..");
      expect(projectPath(s).startsWith(join(base, "projects"))).toBe(true);
    }
  });

  it("gives the second project of the same name its own folder", () => {
    const taken = new Set(["hello-site"]);
    expect(uniqueSlug("Hello Site", (s) => taken.has(s))).toBe("hello-site-2");
    taken.add("hello-site-2");
    expect(uniqueSlug("Hello Site", (s) => taken.has(s))).toBe("hello-site-3");
  });
});

describe("creating a project", () => {
  it("is a git repository with a first checkpoint before anything can go wrong", async () => {
    const m = await createProject("Hello Site", { spec: "one page that says hello", ...hs });
    expect(m.slug).toBe("hello-site");
    const dir = projectPath("hello-site");
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(existsSync(join(dir, "project.sam.json"))).toBe(true);
    expect(isManagedProject("hello-site")).toBe(true);

    const history = await checkpoints("hello-site", 10, hs);
    expect(history.length).toBe(1);
    expect(history[0].message).toBe("Start hello-site");
    expect(history[0].sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("lives under the yard's own root, never inside SAM", async () => {
    await createProject("somewhere", hs);
    expect(projectPath("somewhere").startsWith(base)).toBe(true);
  });

  it("ignores node_modules from the start, so a restore never wipes the dependencies", async () => {
    await createProject("deps", hs);
    expect(readFileSync(join(projectPath("deps"), ".gitignore"), "utf8")).toMatch(/node_modules/);
  });

  it("keeps two same-named projects apart instead of writing into the first", async () => {
    const a = await createProject("Twin", hs);
    const b = await createProject("Twin", hs);
    expect(a.slug).toBe("twin");
    expect(b.slug).toBe("twin-2");
    expect(readManifest("twin")!.slug).toBe("twin");
    expect(readManifest("twin-2")!.slug).toBe("twin-2");
  });
});

describe("the manifest — what survives between sessions", () => {
  it("carries the intent, not just the files", async () => {
    await createProject("Booking", { spec: "a booking page for the stud services", ...hs });
    expect(readManifest("booking")!.spec).toBe("a booking page for the stud services");
  });

  it("accumulates decisions, work and known problems", async () => {
    await createProject("Notes", hs);
    updateManifest("notes", {
      decisions: [{ at: 1, note: "plain HTML, no framework" }],
      todo: [{ done: true, note: "scaffold" }, { done: false, note: "deploy" }],
      issues: ["the contact form is not wired up"],
    });
    const m = readManifest("notes")!;
    expect(m.decisions[0].note).toBe("plain HTML, no framework");
    expect(m.todo.filter((t) => !t.done)).toHaveLength(1);
    expect(m.issues[0]).toMatch(/contact form/);
  });

  it("reloads from disk, so a second session starts where the first stopped", async () => {
    await createProject("Continuity", { spec: "carry on", ...hs });
    updateManifest("continuity", { issues: ["half-finished header"] });
    // a fresh read stands in for a new process — the file is the only shared memory
    const reopened = readManifest("continuity")!;
    expect(reopened.spec).toBe("carry on");
    expect(reopened.issues).toEqual(["half-finished header"]);
  });

  it("will not let the slug or the creation time be rewritten", async () => {
    const m = await createProject("Fixed", hs);
    const after = updateManifest("fixed", { slug: "somethingelse", createdAt: 0 } as any);
    expect(after.slug).toBe("fixed");
    expect(after.createdAt).toBe(m.createdAt);
  });

  it("refuses to update a project that is not managed", () => {
    expect(() => updateManifest("never-made", { spec: "x" })).toThrow(/not a managed project/);
  });

  it("lists projects, most recently touched first", async () => {
    await createProject("First", hs);
    await createProject("Second", hs);
    updateManifest("first", { spec: "touched last" });
    expect(listProjects().map((p) => p.slug)).toEqual(["first", "second"]);
  });
});

describe("checkpoint and restore", () => {
  it("records a checkpoint when there is something to record", async () => {
    await createProject("Work", hs);
    writeFileSync(join(projectPath("work"), "index.html"), "<h1>one</h1>");
    const cp = await checkpoint("work", "added the page", hs);
    expect(cp).not.toBeNull();
    expect(cp!.message).toBe("added the page");
    expect((await checkpoints("work", 10, hs)).length).toBe(2);
  });

  it("records NOTHING when nothing changed, rather than claiming work happened", async () => {
    await createProject("Idle", hs);
    expect(await checkpoint("idle", "nothing at all", hs)).toBeNull();
    expect((await checkpoints("idle", 10, hs)).length).toBe(1);
  });

  // The whole point of the slice.
  it("goes back: create → checkpoint → change → restore → the change is gone", async () => {
    await createProject("Undo", hs);
    const dir = projectPath("undo");

    writeFileSync(join(dir, "index.html"), "<h1>good</h1>");
    const good = (await checkpoint("undo", "the good version", hs))!;

    writeFileSync(join(dir, "index.html"), "<h1>ruined</h1>");
    writeFileSync(join(dir, "oops.txt"), "should not survive");
    await checkpoint("undo", "the bad version", hs);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("<h1>ruined</h1>");

    const back = await restore("undo", good.sha, hs);
    expect(back.sha).toBe(good.sha);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("<h1>good</h1>");
    expect(existsSync(join(dir, "oops.txt"))).toBe(false);
  });

  it("sweeps away files added since the checkpoint, even uncommitted ones", async () => {
    await createProject("Sweep", hs);
    const dir = projectPath("sweep");
    const start = (await checkpoints("sweep", 1, hs))[0];
    writeFileSync(join(dir, "stray.txt"), "left behind");
    await restore("sweep", start.sha, hs);
    expect(existsSync(join(dir, "stray.txt"))).toBe(false);
  });

  it("leaves ignored files alone, so restoring does not force a reinstall", async () => {
    await createProject("Keep", hs);
    const dir = projectPath("keep");
    const start = (await checkpoints("keep", 1, hs))[0];
    mkdirSync(join(dir, "node_modules", "left-pad"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "left-pad", "index.js"), "//");
    await restore("keep", start.sha, hs);
    expect(existsSync(join(dir, "node_modules", "left-pad", "index.js"))).toBe(true);
  });

  it("keeps the manifest across a restore", async () => {
    await createProject("Manifest", { spec: "still here", ...hs });
    const start = (await checkpoints("manifest", 1, hs))[0];
    writeFileSync(join(projectPath("manifest"), "x.txt"), "x");
    await checkpoint("manifest", "added x", hs);
    await restore("manifest", start.sha, hs);
    expect(readManifest("manifest")!.spec).toBe("still here");
  });

  it("refuses a checkpoint that this project does not have", async () => {
    await createProject("Strict", hs);
    await expect(restore("strict", "a".repeat(40), hs)).rejects.toThrow(/no checkpoint/);
  });

  it("refuses something that is not a checkpoint identifier at all", async () => {
    await createProject("Shapes", hs);
    for (const bad of ["", "HEAD", "../../x", "; rm -rf /", "zzzz"]) {
      await expect(restore("shapes", bad, hs)).rejects.toThrow(/not a checkpoint identifier|no checkpoint/);
    }
  });

  it("refuses to touch anything that is not a managed project", async () => {
    await expect(checkpoint("ghost", "x", hs)).rejects.toThrow(/not a managed project/);
    await expect(restore("ghost", "a".repeat(40), hs)).rejects.toThrow(/not a managed project/);
  });

  it("will not run at all when the yard is switched off", async () => {
    await createProject("Gated", hs);
    await expect(checkpoint("gated", "x", { handshake: false })).rejects.toThrow(/not switched on/);
  });
});
