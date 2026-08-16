import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  toolCacheSet,
  toolCacheGet,
  toolCacheClear,
  getMultiTierCacheStats,
} from "./cache.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-cache-tier-test-"));
  process.env.VAULT_DIR = dir;
  toolCacheClear();
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("Multi-Tier Tool & Data Cache", () => {
  it("stores and retrieves cached tool values by namespace", () => {
    toolCacheSet("tools", "read:test.ts", { content: "hello world" }, 10_000);

    const hit = toolCacheGet<{ content: string }>("tools", "read:test.ts");
    expect(hit).toEqual({ content: "hello world" });

    const miss = toolCacheGet("tools", "read:missing.ts");
    expect(miss).toBeNull();
  });

  it("isolates keys between namespaces", () => {
    toolCacheSet("ns1", "key1", "val1", 10_000);
    toolCacheSet("ns2", "key1", "val2", 10_000);

    expect(toolCacheGet("ns1", "key1")).toBe("val1");
    expect(toolCacheGet("ns2", "key1")).toBe("val2");
  });

  it("evicts expired entries after TTL", async () => {
    toolCacheSet("temp", "fast_expire", "val", 10); // 10ms TTL
    await new Promise((r) => setTimeout(r, 25));

    expect(toolCacheGet("temp", "fast_expire")).toBeNull();
  });

  it("tracks hit and miss statistics", () => {
    toolCacheSet("stats", "item1", 123, 10_000);

    toolCacheGet("stats", "item1"); // hit
    toolCacheGet("stats", "item1"); // hit
    toolCacheGet("stats", "missing"); // miss

    const stats = getMultiTierCacheStats();
    expect(stats.l1.hits).toBe(2);
    expect(stats.l1.misses).toBe(1);
    expect(stats.l1.hitRate).toBe("66.7%");
  });

  it("clears by namespace selectively", () => {
    toolCacheSet("nsA", "k", "vA");
    toolCacheSet("nsB", "k", "vB");

    toolCacheClear("nsA");
    expect(toolCacheGet("nsA", "k")).toBeNull();
    expect(toolCacheGet("nsB", "k")).toBe("vB");
  });
});
