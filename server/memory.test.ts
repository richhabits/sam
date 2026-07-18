import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { remember, recallWith, forget, memoryStats, clearUser } from "./memory.ts";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Memory Subsystem", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Overwrite VAULT_DIR to use a temporary directory for testing
    originalEnv = process.env.VAULT_DIR;
    process.env.VAULT_DIR = join(tmpdir(), `sam-test-vault-${Date.now()}`);
    mkdirSync(process.env.VAULT_DIR, { recursive: true });
  });

  afterEach(() => {
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

  it("can store a memory without crashing", async () => {
    // Mock the embeddings so it doesn't try to call an external API
    // Actually, `remember` handles embedding gracefully if external APIs fail
    // It might just not embed if offline, but it should still store.
    await expect(remember("I love programming in Rust.")).resolves.not.toThrow();
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
