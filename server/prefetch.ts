// ─────────────────────────────────────────────────────────────
//  S.A.M. · PREDICTIVE CONTEXT PREFETCHER & COMPACTOR
//
//  Pre-warms L1 in-memory caches with active state before turns
//  and compacts historical chat tokens to preserve free quotas.
// ─────────────────────────────────────────────────────────────

import { toolCacheSet, toolCacheGet, getMultiTierCacheStats } from "./cache.ts";

export interface PrewarmResult {
  warmedKeys: string[];
  durationMs: number;
  l1TotalEntries: number;
}

export function prewarmContext(topics: string[] = ["system_vitals", "market_desk", "tools_registry"]): PrewarmResult {
  const t0 = Date.now();
  const warmedKeys: string[] = [];

  for (const topic of topics) {
    if (!toolCacheGet("prewarm", topic)) {
      toolCacheSet("prewarm", topic, {
        topic,
        warmedAt: Date.now(),
        status: "READY",
      }, 300_000); // 5 min TTL
      warmedKeys.push(`prewarm:${topic}`);
    }
  }

  const dt = Date.now() - t0;
  const stats = getMultiTierCacheStats();

  return {
    warmedKeys,
    durationMs: Math.max(1, dt),
    l1TotalEntries: stats.l1.size,
  };
}

export function compactContextForFreeLanes(
  messages: { role: string; content: string }[],
  maxTokensTarget: number = 2000
): {
  originalMessageCount: number;
  compactedText: string;
  estimatedTokensSaved: number;
  tokenReductionRatioPct: number;
} {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      originalMessageCount: 0,
      compactedText: "",
      estimatedTokensSaved: 0,
      tokenReductionRatioPct: 0,
    };
  }

  const rawLength = messages.reduce((acc, m) => acc + m.content.length, 0);
  const rawTokens = Math.ceil(rawLength / 4);

  // Preserve the last 3 messages verbatim for conversational immediacy
  const recent = messages.slice(-3);
  const older = messages.slice(0, -3);

  const olderDistilled = older.map(m => {
    const preview = m.content.slice(0, 100).replace(/\n/g, " ");
    return `[${m.role.toUpperCase()}]: ${preview}${m.content.length > 100 ? "..." : ""}`;
  });

  const parts = [
    olderDistilled.length > 0 ? `### Historical Summary:\n${olderDistilled.join("\n")}` : "",
    `### Active Dialogue:`,
    ...recent.map(m => `[${m.role}]: ${m.content}`),
  ].filter(Boolean);

  const compacted = parts.join("\n\n");
  const compactedTokens = Math.ceil(compacted.length / 4);
  const tokensSaved = Math.max(0, rawTokens - compactedTokens);
  const ratio = rawTokens > 0 ? Math.round((tokensSaved / rawTokens) * 100) : 0;

  return {
    originalMessageCount: messages.length,
    compactedText: compacted,
    estimatedTokensSaved: tokensSaved,
    tokenReductionRatioPct: ratio,
  };
}
