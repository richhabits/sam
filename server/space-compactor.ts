// ─────────────────────────────────────────────────────────────
//  S.A.M. · AUTONOMOUS STORAGE & MEMORY COMPACTOR
//
//  Audits memory heap consumption, clears expired caches, and
//  reclaims RAM/disk space keeping SAM's footprint ultra-lean.
// ─────────────────────────────────────────────────────────────

import { getMultiTierCacheStats, toolCacheClear } from "./cache.ts";

export interface SpaceAuditReport {
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  l1CacheEntries: number;
  status: "OPTIMAL" | "COMPACT_RECOMMENDED";
  savingsRecommendation: string;
}

export interface CompactionResult {
  status: "COMPACTED";
  freedCacheEntries: number;
  currentHeapUsedMb: number;
  durationMs: number;
}

export function auditSpaceConsumption(): SpaceAuditReport {
  const mem = process.memoryUsage();
  const heapUsedMb = Number((mem.heapUsed / (1024 * 1024)).toFixed(2));
  const heapTotalMb = Number((mem.heapTotal / (1024 * 1024)).toFixed(2));
  const rssMb = Number((mem.rss / (1024 * 1024)).toFixed(2));

  const stats = getMultiTierCacheStats();
  const l1Entries = stats.l1.size;

  const needsCompact = heapUsedMb > 250 || l1Entries > 500;

  return {
    heapUsedMb,
    heapTotalMb,
    rssMb,
    l1CacheEntries: l1Entries,
    status: needsCompact ? "COMPACT_RECOMMENDED" : "OPTIMAL",
    savingsRecommendation: needsCompact
      ? "Execute compaction to purge expired L1 cache items and trigger V8 heap sweep."
      : "Memory footprint is within optimal operating bounds (<250MB).",
  };
}

export function compactSpaceAndMemory(): CompactionResult {
  const t0 = Date.now();
  const beforeStats = getMultiTierCacheStats();
  const beforeCount = beforeStats.l1.size;

  toolCacheClear("prewarm");

  if (typeof global.gc === "function") {
    global.gc();
  }

  const afterMem = process.memoryUsage();
  const currentHeapMb = Number((afterMem.heapUsed / (1024 * 1024)).toFixed(2));
  const afterStats = getMultiTierCacheStats();
  const freed = Math.max(0, beforeCount - afterStats.l1.size);

  return {
    status: "COMPACTED",
    freedCacheEntries: freed,
    currentHeapUsedMb: currentHeapMb,
    durationMs: Math.max(1, Date.now() - t0),
  };
}
