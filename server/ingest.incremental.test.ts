import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Incremental-index correctness. The doc index skips files by mtime+size — fast, but that
// misses index-wide DERIVATION inputs (embedder model, chunk params). This proves the fingerprint
// busting: content change re-indexes ONE file, unchanged HITS, a model change busts ALL, a deleted
// file is evicted. CORRECTNESS-FIRST: a wrong hit (stale vectors served silently) is the failure we
// refuse, so we lean to recompute.

// Controllable mocks: `model` is what the vault's pinned embedder reports. The test flips it to
// simulate the user switching embedding models — the real-world bust trigger.
const h = vi.hoisted(() => ({ model: "model-A" }));
vi.mock("./embeddings.ts", () => ({
  embed: async (texts: string[]) => ({ model: h.model, vectors: texts.map(() => Array(8).fill(0.1)) }),
  embedOne: async () => ({ model: h.model, vec: Array(8).fill(0.1) }),
  cosine: () => 1,
}));
vi.mock("./memory.ts", () => ({ pinnedModel: () => h.model }));

import { docsStats, ingestFolder } from "./ingest.ts";

let vault = "";
let docs = "";
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

beforeEach(() => {
  h.model = "model-A";
  vault = join(tmpdir(), `sam-inc-vault-${uid()}`);
  docs = join(tmpdir(), `sam-inc-docs-${uid()}`);
  mkdirSync(vault, { recursive: true });
  mkdirSync(docs, { recursive: true });
  process.env.VAULT_DIR = vault;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  delete process.env.SAM_READER;
  for (const p of [vault, docs]) { try { rmSync(p, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

const write = (name: string, body: string) => writeFileSync(join(docs, name), body);

describe("incremental doc index — fingerprint busting", () => {
  it("HIT: re-indexing unchanged content skips the file (no re-embed)", async () => {
    write("a.md", "the quick brown fox ".repeat(40));
    const first = await ingestFolder(docs);
    expect(first.ingested).toBe(1);
    const second = await ingestFolder(docs);
    expect(second.ingested).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(second.busted).toBeUndefined();
  });

  it("BUST-ONE: changed content re-indexes just that file", async () => {
    write("a.md", "original content here ".repeat(40));
    write("b.md", "second file stays put ".repeat(40));
    await ingestFolder(docs);
    write("a.md", "TOTALLY different content now ".repeat(40)); // new size → new mtime
    const r = await ingestFolder(docs);
    expect(r.ingested).toBe(1);   // only a.md
    expect(r.unchanged).toBe(1);  // b.md
  });

  it("BUST-ALL: switching the embedder model re-embeds every file", async () => {
    write("a.md", "alpha ".repeat(40));
    write("b.md", "beta ".repeat(40));
    const first = await ingestFolder(docs);
    expect(first.ingested).toBe(2);
    h.model = "model-B"; // user switched embedding model → every stored vector is now stale
    const r = await ingestFolder(docs);
    expect(r.busted).toMatch(/embedder changed/);
    expect(r.ingested).toBe(2);   // ALL re-embedded despite unchanged content
    expect(r.unchanged).toBe(0);
  });

  it("no false bust: same model + content → clean hit, not a re-embed", async () => {
    write("a.md", "steady ".repeat(40));
    await ingestFolder(docs);
    const r = await ingestFolder(docs); // same model-A, same file
    expect(r.busted).toBeUndefined();
    expect(r.unchanged).toBe(1);
  });

  it("EVICT: a deleted file is removed from the index", async () => {
    write("keep.md", "keep me ".repeat(40));
    write("gone.md", "delete me ".repeat(40));
    const first = await ingestFolder(docs);
    expect(first.ingested).toBe(2);
    expect(docsStats().files).toBe(2);
    unlinkSync(join(docs, "gone.md"));
    const r = await ingestFolder(docs);
    expect(r.evicted).toBe(1);
    expect(docsStats().files).toBe(1); // only keep.md remains
  });
});

describe("incremental doc index — the Reader is a derivation input", () => {
  it("BUST-ALL: toggling SAM_READER re-extracts every HTML file (plain text ≠ markdown)", async () => {
    const prose = "Genuine article prose that carries the real meaning of the page and clears the threshold. ".repeat(6);
    writeFileSync(join(docs, "page.html"), `<html><head><title>T</title></head><body><article><h2>Findings</h2><p>${prose}</p></article></body></html>`);
    delete process.env.SAM_READER;
    const first = await ingestFolder(docs);        // Reader OFF → plain strip
    expect(first.ingested).toBe(1);
    process.env.SAM_READER = "1";
    const second = await ingestFolder(docs);       // Reader ON → derivation changed → bust + re-extract
    expect(second.busted).toMatch(/chunking changed/);
    expect(second.ingested).toBe(1);
    expect(second.unchanged).toBe(0);              // NOT skipped despite unchanged mtime+size
  });
});
