import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Isolated scratch vault + deterministic offline embeddings.
const SCRATCH = "/tmp/sam-lifeindex-test";
const DOCS = join(SCRATCH, "docs");
let LI: typeof import("./lifeindex.ts");

beforeAll(async () => {
  process.env.SAM_BENCH_MOCK = "1";              // mock embeddings → offline + deterministic
  process.env.VAULT_DIR = join(SCRATCH, "vault");
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(join(DOCS, "notes.txt"), "The launch date for project Falcon is March 14. The budget is fifty thousand pounds.");
  writeFileSync(join(DOCS, "readme.md"), "# Falcon\nFalcon is our flagship product. It ships in Q1.");
  LI = await import("./lifeindex.ts");
});
afterAll(() => { LI.stopWatching(); rmSync(SCRATCH, { recursive: true, force: true }); });

describe("life index management", () => {
  it("starts empty", () => { expect(LI.listFolders()).toHaveLength(0); });

  it("adds + indexes a chosen folder and lists it", async () => {
    const { folder, report } = await LI.addFolder(DOCS);
    expect(folder.path).toBe(DOCS);
    expect(report).not.toBeNull();
    expect(report!.ingested).toBeGreaterThan(0);
    const folders = LI.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].lastIndexedAt).toBeGreaterThan(0);
    expect(LI.lifeIndexStats().folders).toBe(1);
  });

  it("does not duplicate an already-watched folder", async () => {
    await LI.addFolder(DOCS);
    expect(LI.listFolders()).toHaveLength(1);
  });

  it("answers a scoped question with source citations", async () => {
    // Mock embeddings aren't semantic, so query with exact stored text → deterministic vector match.
    // (In production, real embeddings make this work for paraphrased questions.)
    const r = await LI.askAbout(DOCS, "The launch date for project Falcon is March 14. The budget is fifty thousand pounds.");
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.sources.every((s) => s.startsWith(DOCS))).toBe(true);
    expect(r.hits[0].source).toContain("notes.txt");
  });

  it("removes a folder and forgets its chunks", () => {
    const r = LI.removeFolder(DOCS);
    expect(r.removed).toBe(true);
    expect(r.forgotten).toBeGreaterThan(0);
    expect(LI.listFolders()).toHaveLength(0);
  });

  it("onACPower resolves a boolean and never blocks", async () => {
    expect(typeof await LI.onACPower()).toBe("boolean");
  });
});

describe("index refusals (the Life Index must not swallow the disk or the keys)", () => {
  it("refuses /, the home folder and key directories", async () => {
    const { homedir } = await import("node:os");
    const h = homedir();
    for (const p of ["/", h, "~", `${h}/.ssh`, `${h}/.ssh/keys`, "~/.gnupg", `${h}/Library/Keychains`, `${h}/Library/Keychains/login.keychain-db`]) {
      expect(LI.indexRefusal(p), p).toBeTruthy();
    }
    await expect(LI.addFolder("/")).rejects.toThrow(/refusing/);
  });
  it("judges a symlink by where it lands", async () => {
    const { symlinkSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const link = join(SCRATCH, "innocent-link");
    symlinkSync(homedir(), link);
    expect(LI.indexRefusal(link)).toBeTruthy();
  });
  it("allows an ordinary folder", () => { expect(LI.indexRefusal(DOCS)).toBeNull(); });
});
