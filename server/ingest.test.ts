import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Fully OFFLINE: deterministic fake embeddings (word counts over a tiny vocab)
// so ingestion + retrieval are testable without any provider or network call.
const VOCAB = ["garden", "weather", "radio", "busy", "invoice", "supplier", "sam"];
function fakeVec(text: string): number[] {
  const t = text.toLowerCase();
  const v = VOCAB.map((w) => t.split(w).length - 1);
  v.push(1); // constant dim — never a zero vector
  return v;
}
vi.mock("./embeddings.ts", () => ({
  embed: async (texts: string[]) => ({ model: "mock", vectors: texts.map(fakeVec) }),
  embedOne: async (text: string) => ({ model: "mock", vec: fakeVec(text) }),
  cosine: (a: number[], b: number[]) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  },
}));
// Don't open the real vault's memory.db just to read the pinned model.
vi.mock("./memory.ts", () => ({ pinnedModel: () => null }));

import { chunkText, ingestFolder, searchDocs, docsStats, recentDocs, forgetDoc } from "./ingest.ts";

let vault = "";
let docsDir = "";

beforeEach(() => {
  vault = join(tmpdir(), `sam-ingest-vault-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  docsDir = join(tmpdir(), `sam-ingest-docs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(vault, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  process.env.VAULT_DIR = vault;
});

afterEach(() => {
  delete process.env.VAULT_DIR;
  try { rmSync(vault, { recursive: true, force: true }); } catch { /* best-effort test cleanup — the tmp dir may already be gone */ }
  try { rmSync(docsDir, { recursive: true, force: true }); } catch { /* best-effort test cleanup — the tmp dir may already be gone */ }
});

describe("chunkText", () => {
  it("packs paragraphs into chunks and drops tiny fragments", () => {
    const text = "First paragraph about the bulldog breeding programme and litters.\n\nSecond paragraph about invoices and a supplier we use every month for feed.";
    const chunks = chunkText(text);
    expect(chunks.length).toBe(1); // both fit in one ~1200-char chunk
    expect(chunks[0]).toContain("bulldog");
    expect(chunks[0]).toContain("supplier");
  });

  it("hard-splits a giant single paragraph", () => {
    const chunks = chunkText("x".repeat(3000));
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 1200)).toBe(true);
  });

  it("returns nothing for near-empty input", () => {
    expect(chunkText("hi")).toEqual([]);
  });
});

describe("ingestFolder", () => {
  it("indexes supported files recursively, skipping junk dirs", async () => {
    writeFileSync(join(docsDir, "breeding.md"), "# Litters\n\nThe bulldog breeding programme has three litters planned. Health tests are booked with the vet for all breeding dogs this quarter.");
    mkdirSync(join(docsDir, "money"));
    writeFileSync(join(docsDir, "money", "supplier.txt"), "Invoice from the feed supplier: monthly bulk order, payment due on the 28th. The supplier gives a discount over 200kg.");
    mkdirSync(join(docsDir, "node_modules"));
    writeFileSync(join(docsDir, "node_modules", "junk.md"), "should never be indexed because node_modules is skipped entirely by the walker.");
    writeFileSync(join(docsDir, "photo.png"), "binary-ish, unsupported extension");

    const r = await ingestFolder(docsDir);
    expect(r.ingested).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.chunks).toBeGreaterThanOrEqual(2);
    const s = docsStats();
    expect(s.files).toBe(2);
    expect(recentDocs().map((d) => d.path).some((p) => p.endsWith("breeding.md"))).toBe(true);
  });

  it("retrieves the right passage by meaning with the source cited", async () => {
    writeFileSync(join(docsDir, "breeding.md"), "The bulldog breeding programme has three litters planned for the autumn season this year.");
    writeFileSync(join(docsDir, "station.md"), "The radio station runs a busy weekend schedule with guest DJs on rotation every Friday night.");
    await ingestFolder(docsDir);

    const hits = await searchDocs("bulldog breeding", 2, 0.1);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source.endsWith("breeding.md")).toBe(true);
    expect(hits[0].text).toContain("litters");
  });

  it("is incremental — unchanged files are skipped on re-run", async () => {
    writeFileSync(join(docsDir, "a.md"), "The bulldog breeding notes live here with enough length to pass the minimum chunk size filter.");
    const first = await ingestFolder(docsDir);
    expect(first.ingested).toBe(1);
    const second = await ingestFolder(docsDir);
    expect(second.ingested).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(docsStats().files).toBe(1); // no duplicates
  });

  it("respects the per-run file cap and reports the remainder", async () => {
    for (let i = 0; i < 4; i++) writeFileSync(join(docsDir, `f${i}.md`), `Document number ${i} — long enough content about the busy radio invoice supplier world to index properly.`);
    const r = await ingestFolder(docsDir, 2);
    expect(r.ingested).toBe(2);
    expect(r.remaining).toBe(2);
    expect(r.note).toMatch(/run again/i);
  });

  it("forgets a folder's documents on request", async () => {
    writeFileSync(join(docsDir, "a.md"), "The bulldog breeding notes live here with enough length to pass the minimum chunk filter.");
    await ingestFolder(docsDir);
    expect(docsStats().files).toBe(1);
    const n = forgetDoc(docsDir);
    expect(n).toBeGreaterThan(0);
    expect(docsStats().files).toBe(0);
    expect(docsStats().chunks).toBe(0);
  });
});
