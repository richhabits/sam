import { describe, it, expect } from "vitest";
import { parseRemote, originFromConfig, chooseRepo, type Clone } from "./repos.ts";

// These tests exist because of a real failure: a git tool was handed a folder from the
// wrong operating system, then the literal string "undefined", and reported neither.

const CLONES: Clone[] = [
  { path: "/Users/x/sam", owner: "richhabits", name: "sam", remote: "https://github.com/richhabits/sam.git" },
  { path: "/Users/x/Downloads/forged-landscapes", owner: "richhabits", name: "forgedlandscapes", remote: "https://github.com/richhabits/forgedlandscapes.git" },
  { path: "/Users/x/flip-it", owner: null, name: null, remote: null },
];
const REMOTE_ONLY = ["sam", "forgedlandscapes", "mainline", "piing"];
const yes = () => true;
const no = () => false;

describe("reading a working copy's origin", () => {
  it("pulls the url out of a git config", () => {
    const cfg = `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/richhabits/sam.git\n\tfetch = +refs/heads/*\n[branch "main"]\n`;
    expect(originFromConfig(cfg)).toBe("https://github.com/richhabits/sam.git");
  });
  it("returns nothing when there is no origin", () => {
    expect(originFromConfig(`[core]\n\tbare = false\n`)).toBeNull();
    expect(originFromConfig("")).toBeNull();
  });
});

describe("parsing a remote", () => {
  it("understands the https form, with and without .git", () => {
    expect(parseRemote("https://github.com/richhabits/sam.git")).toEqual({ owner: "richhabits", name: "sam" });
    expect(parseRemote("https://github.com/richhabits/sam")).toEqual({ owner: "richhabits", name: "sam" });
  });
  it("understands the ssh form", () => {
    expect(parseRemote("git@github.com:richhabits/mainline.git")).toEqual({ owner: "richhabits", name: "mainline" });
  });
  it("declines to guess at nonsense", () => {
    expect(parseRemote("")).toBeNull();
    expect(parseRemote(null)).toBeNull();
    expect(parseRemote("not a url")).toBeNull();
  });
});

describe("choosing a repo", () => {
  it("resolves a bare name to its folder", () => {
    expect(chooseRepo("sam", CLONES, REMOTE_ONLY, yes)).toEqual({ ok: true, path: "/Users/x/sam" });
  });

  it("resolves a name that differs only by punctuation", () => {
    // the folder is forged-landscapes, the repo is forgedlandscapes
    expect(chooseRepo("forged-landscapes", CLONES, REMOTE_ONLY, yes)).toEqual({ ok: true, path: "/Users/x/Downloads/forged-landscapes" });
  });

  it("resolves a working copy that has no remote at all, by folder name", () => {
    expect(chooseRepo("flip-it", CLONES, REMOTE_ONLY, yes)).toEqual({ ok: true, path: "/Users/x/flip-it" });
  });

  it("is not case sensitive", () => {
    expect(chooseRepo("SAM", CLONES, REMOTE_ONLY, yes)).toEqual({ ok: true, path: "/Users/x/sam" });
  });

  // ── the branches that actually broke ──────────────────────────────────────

  it("refuses an empty folder and says what it does know", () => {
    const r = chooseRepo("", CLONES, REMOTE_ONLY, yes);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toContain("no folder was given"); expect(r.reason).toContain("sam"); }
  });

  it("refuses the literal string a model leaves behind when it fills in nothing", () => {
    for (const bad of ["undefined", "null", "   "]) {
      const r = chooseRepo(bad, CLONES, REMOTE_ONLY, yes);
      expect(r.ok).toBe(false);
    }
  });

  it("refuses a non-string input rather than stringifying it", () => {
    expect(chooseRepo(undefined, CLONES, REMOTE_ONLY, yes).ok).toBe(false);
    expect(chooseRepo(null, CLONES, REMOTE_ONLY, yes).ok).toBe(false);
    expect(chooseRepo(42, CLONES, REMOTE_ONLY, yes).ok).toBe(false);
  });

  it("refuses a path from the wrong machine instead of running git against it", () => {
    const r = chooseRepo("/home/romeo/sam", CLONES, REMOTE_ONLY, no);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("isn't a git working copy");
  });

  it("distinguishes 'yours but not cloned here' from 'no such repo'", () => {
    const notCloned = chooseRepo("mainline", CLONES, REMOTE_ONLY, yes);
    expect(notCloned.ok).toBe(false);
    if (!notCloned.ok) expect(notCloned.reason).toContain("isn't cloned on this machine");

    const unknown = chooseRepo("nonsense-repo", CLONES, REMOTE_ONLY, yes);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toContain('no repo called "nonsense-repo"');
  });

  it("accepts a real path that does exist", () => {
    expect(chooseRepo("/Users/x/anything", CLONES, REMOTE_ONLY, yes)).toEqual({ ok: true, path: "/Users/x/anything" });
  });

  it("says something useful even when nothing is indexed", () => {
    const r = chooseRepo("", [], [], yes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("none found on this machine");
  });
});

describe("the same name in two places", () => {
  // Once external drives are searched this stops being hypothetical: a working copy on
  // the internal disk and another on a backup drive share a name. Picking one quietly is
  // how the wrong copy gets edited — and the wrong one may be what another tool is using.
  const TWO: Clone[] = [
    { path: "/Users/x/sam", owner: "richhabits", name: "sam", remote: "https://github.com/richhabits/sam.git" },
    { path: "/Volumes/ROMEO HQ/SAM", owner: "richhabits", name: "sam", remote: "https://github.com/richhabits/sam.git" },
  ];

  it("refuses rather than guessing, and names both", () => {
    const r = chooseRepo("sam", TWO, [], yes);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/ambiguous/);
      expect(r.reason).toContain("/Users/x/sam");
      expect(r.reason).toContain("/Volumes/ROMEO HQ/SAM");
    }
  });

  it("still resolves when the full path is given", () => {
    expect(chooseRepo("/Volumes/ROMEO HQ/SAM", TWO, [], yes)).toEqual({ ok: true, path: "/Volumes/ROMEO HQ/SAM" });
  });

  it("resolves a name that is only in one place", () => {
    expect(chooseRepo("sam", [TWO[0]], [], yes)).toEqual({ ok: true, path: "/Users/x/sam" });
  });
});
