import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { remember, recallWith, forget, memoryStats, clearUser } from "./memory.ts";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Memory Subsystem", () => {
  let originalEnv: string | undefined;

  let originalMock: string | undefined;

  beforeEach(() => {
    // Overwrite VAULT_DIR to use a temporary directory for testing
    originalEnv = process.env.VAULT_DIR;
    process.env.VAULT_DIR = join(tmpdir(), `sam-test-vault-${Date.now()}`);
    mkdirSync(process.env.VAULT_DIR, { recursive: true });
    // Embed with the deterministic mock, never a live provider. Without this the suite
    // silently depended on the DEVELOPER'S machine: with Ollama up, `remember` blocked on a
    // real cold model load (>5s → timeout); with a cloud key in .env it would have burned
    // embedding quota to assert "doesn't crash". Both are the same bug — a unit test reaching
    // the network. mockEmbed is what SAM_BENCH_MOCK exists for (server/embeddings.ts).
    originalMock = process.env.SAM_BENCH_MOCK;
    process.env.SAM_BENCH_MOCK = "1";
  });

  afterEach(() => {
    if (originalMock === undefined) delete process.env.SAM_BENCH_MOCK;
    else process.env.SAM_BENCH_MOCK = originalMock;
    if (process.env.VAULT_DIR) {
      try {
        rmSync(process.env.VAULT_DIR, { recursive: true, force: true });
      } catch { /* best-effort test cleanup — the tmp dir may already be gone */ }
    }
    process.env.VAULT_DIR = originalEnv;
  });

  it("exposes memoryStats", () => {
    const stats = memoryStats();
    expect(stats).toHaveProperty("count");
  });

  it("stores a memory, and dedups the second identical one", async () => {
    // Now that embedding is deterministic (mock), this can assert the real contract instead
    // of merely "didn't throw": the write lands, and an identical re-write is rejected by the
    // cosine dedup rather than stored twice.
    await expect(remember("I love programming in Rust.")).resolves.toBe(true);
    await expect(remember("I love programming in Rust.")).resolves.toBe(false);
  });

  it("can recall memory", async () => {
    // Mock the query embedding vector
    const recalled = recallWith({ model: "mock", vec: Array(384).fill(0.1) });
    expect(Array.isArray(recalled)).toBe(true);
  });

  it("can forget memory", () => {
    const ok = forget("fake-id-123");
    // Since fake-id doesn't exist, it might return false, but it shouldn't crash
    expect(typeof ok).toBe("boolean");
  });

  it("clearUser wipes a user's memory and returns a count", () => {
    // Scoped wipe — returns how many rows were cleared (0 for an empty/unknown user).
    const cleared = clearUser("nobody-here");
    expect(typeof cleared).toBe("number");
  });
});
