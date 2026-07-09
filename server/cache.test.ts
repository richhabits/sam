import { describe, it, expect, beforeEach, beforeAll } from "vitest";

// Point the cache at a throwaway dir so tests never touch the real vault.
let C: typeof import("./cache.ts");
beforeAll(async () => {
  process.env.VAULT_DIR = "/private/tmp/claude-501/-Users-romeovalentine/sam-cache-test";
  C = await import("./cache.ts");
});
beforeEach(() => C.clearCache());

const FP = () => C.fingerprint({ skillId: "content", userName: "romeo", mode: "business", lean: false, recalled: "", docs: "" });

describe("cacheable", () => {
  it("blocks live/current info and private requests", () => {
    expect(C.cacheable("what's the weather today?")).toBe(false);
    expect(C.cacheable("latest news on AI")).toBe(false);
    expect(C.cacheable("what time is it now?")).toBe(false);
    expect(C.cacheable("draft a poem — private, don't save this")).toBe(false);
  });
  it("allows stable knowledge/generation", () => {
    expect(C.cacheable("explain what a semaphore is")).toBe(true);
    expect(C.cacheable("write a haiku about the sea")).toBe(true);
  });
});

describe("exact cache", () => {
  it("stores then serves an exact repeat (0 tokens)", () => {
    const fp = FP();
    expect(C.lookup("explain what a semaphore is", fp)).toBeNull();
    C.store({ message: "explain what a semaphore is", fp, answer: "A semaphore limits concurrency.", provider: "mock:free", tier: "free" });
    const hit = C.lookup("Explain what a semaphore is?", fp);   // case/punct-insensitive
    expect(hit).not.toBeNull();
    expect(hit!.answer).toBe("A semaphore limits concurrency.");
    expect(hit!.semantic).toBe(false);
  });

  it("misses when the context fingerprint changes (invalidation)", () => {
    const fp1 = C.fingerprint({ skillId: "content", recalled: "romeo likes tea" });
    const fp2 = C.fingerprint({ skillId: "content", recalled: "romeo likes coffee now" });
    C.store({ message: "what do I like?", fp: fp1, answer: "tea", provider: "p", tier: "free" });
    expect(C.lookup("what do I like?", fp1)).not.toBeNull();
    expect(C.lookup("what do I like?", fp2)).toBeNull();   // context changed → miss
  });
});

describe("semantic cache", () => {
  it("serves a near-identical vector, rejects a distant one", () => {
    const fp = FP();
    const v = [1, 0, 0, 0];
    C.store({ message: "the original question", fp, answer: "cached", provider: "p", tier: "free", qvec: { model: "m", vec: v } });
    const near = C.lookup("a different phrasing entirely", fp, { model: "m", vec: [0.99, 0.01, 0, 0] });
    expect(near?.semantic).toBe(true);
    const far = C.lookup("yet another phrasing", fp, { model: "m", vec: [0, 1, 0, 0] });
    expect(far).toBeNull();
  });
  it("never crosses embedding models", () => {
    const fp = FP();
    C.store({ message: "q", fp, answer: "a", provider: "p", tier: "free", qvec: { model: "nomic", vec: [1, 0] } });
    expect(C.lookup("totally different text", fp, { model: "gemini-001-768", vec: [1, 0] })).toBeNull();
  });
});
