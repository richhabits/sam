// ─────────────────────────────────────────────────────────────
//  S.A.M. · COST OPTIMIZER & CAPITAL PRESERVATION ENGINE
//
//  Tracks real-world token and dollar savings across SAM's
//  free-first routing, semantic cache deduplication, prompt
//  context compression, and trading capital circuit breakers.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const SAVINGS_FILE = join(VAULT_DIR, "cost_savings_ledger.json");

// Standard benchmark commercial API pricing ($ per 1M tokens) for comparison:
// Benchmarked against GPT-4o / Claude 3.5 Sonnet average: $3.00/1M input, $12.00/1M output.
const BENCHMARK_INPUT_PRICE_PER_M = 3.0;
const BENCHMARK_OUTPUT_PRICE_PER_M = 12.0;

export interface CostSavingsLedger {
  totalRequests: number;
  freeTierRequests: number;
  cachedRequests: number;
  paidRequests: number;
  tokensProcessed: {
    freeInputTokens: number;
    freeOutputTokens: number;
    cachedTokens: number;
    paidInputTokens: number;
    paidOutputTokens: number;
  };
  dollarsSavedTotal: number;
  dollarsSpentTotal: number;
  lastUpdated: number;
}

let inMemoryLedger: CostSavingsLedger = {
  totalRequests: 0,
  freeTierRequests: 0,
  cachedRequests: 0,
  paidRequests: 0,
  tokensProcessed: {
    freeInputTokens: 0,
    freeOutputTokens: 0,
    cachedTokens: 0,
    paidInputTokens: 0,
    paidOutputTokens: 0,
  },
  dollarsSavedTotal: 0,
  dollarsSpentTotal: 0,
  lastUpdated: Date.now(),
};

let loaded = false;

function loadLedger(): void {
  if (loaded) return;
  try {
    if (existsSync(SAVINGS_FILE)) {
      const data = JSON.parse(readFileSync(SAVINGS_FILE, "utf8"));
      inMemoryLedger = { ...inMemoryLedger, ...data };
    }
  } catch { /* best-effort fallback */ }
  loaded = true;
}

function saveLedger(): void {
  try {
    const dir = dirname(SAVINGS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SAVINGS_FILE, JSON.stringify(inMemoryLedger, null, 2));
  } catch { /* best-effort */ }
}

export function recordCostSavings(params: {
  provider: string;
  isFreeTier: boolean;
  isCacheHit?: boolean;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd?: number;
}): void {
  loadLedger();

  inMemoryLedger.totalRequests++;
  inMemoryLedger.lastUpdated = Date.now();

  const inputCostSaved = (params.inputTokens / 1_000_000) * BENCHMARK_INPUT_PRICE_PER_M;
  const outputCostSaved = (params.outputTokens / 1_000_000) * BENCHMARK_OUTPUT_PRICE_PER_M;
  const standardValue = inputCostSaved + outputCostSaved;

  if (params.isCacheHit) {
    inMemoryLedger.cachedRequests++;
    inMemoryLedger.tokensProcessed.cachedTokens += (params.inputTokens + params.outputTokens);
    inMemoryLedger.dollarsSavedTotal += standardValue;
  } else if (params.isFreeTier) {
    inMemoryLedger.freeTierRequests++;
    inMemoryLedger.tokensProcessed.freeInputTokens += params.inputTokens;
    inMemoryLedger.tokensProcessed.freeOutputTokens += params.outputTokens;
    inMemoryLedger.dollarsSavedTotal += standardValue;
  } else {
    inMemoryLedger.paidRequests++;
    inMemoryLedger.tokensProcessed.paidInputTokens += params.inputTokens;
    inMemoryLedger.tokensProcessed.paidOutputTokens += params.outputTokens;
    const actual = params.actualCostUsd || 0;
    inMemoryLedger.dollarsSpentTotal += actual;
    if (standardValue > actual) {
      inMemoryLedger.dollarsSavedTotal += (standardValue - actual);
    }
  }

  saveLedger();
}

export function getSavingsSummary(): {
  ledger: CostSavingsLedger;
  freeEfficiencyPercentage: number;
  cacheEfficiencyPercentage: number;
  estimatedGbpSaved: number;
} {
  loadLedger();

  const total = Math.max(1, inMemoryLedger.totalRequests);
  const freePct = (inMemoryLedger.freeTierRequests / total) * 100;
  const cachePct = (inMemoryLedger.cachedRequests / total) * 100;
  const gbpSaved = inMemoryLedger.dollarsSavedTotal * 0.78; // Approx USD->GBP

  return {
    ledger: { ...inMemoryLedger },
    freeEfficiencyPercentage: Number(freePct.toFixed(1)),
    cacheEfficiencyPercentage: Number(cachePct.toFixed(1)),
    estimatedGbpSaved: Number(gbpSaved.toFixed(2)),
  };
}

export function resetSavingsLedger(): void {
  inMemoryLedger = {
    totalRequests: 0,
    freeTierRequests: 0,
    cachedRequests: 0,
    paidRequests: 0,
    tokensProcessed: {
      freeInputTokens: 0,
      freeOutputTokens: 0,
      cachedTokens: 0,
      paidInputTokens: 0,
      paidOutputTokens: 0,
    },
    dollarsSavedTotal: 0,
    dollarsSpentTotal: 0,
    lastUpdated: Date.now(),
  };
  saveLedger();
}

// ── PROMPT CONTEXT COMPRESSION ──

export interface CompressionResult {
  originalLength: number;
  compressedLength: number;
  estimatedOriginalTokens: number;
  estimatedCompressedTokens: number;
  tokensSaved: number;
  reductionPercentage: number;
  compressedText: string;
}

export function compressPromptForCost(text: string, options: { maxLines?: number } = {}): CompressionResult {
  const original = String(text || "");
  if (!original.trim()) {
    return {
      originalLength: 0,
      compressedLength: 0,
      estimatedOriginalTokens: 0,
      estimatedCompressedTokens: 0,
      tokensSaved: 0,
      reductionPercentage: 0,
      compressedText: "",
    };
  }

  const origTokens = Math.ceil(original.length / 4);

  // 1. Remove duplicate lines & consecutive empty lines
  const lines = original.split("\n");
  const seenLines = new Set<string>();
  const cleanedLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== "") {
        cleanedLines.push("");
      }
      continue;
    }

    // Deduplicate repeated verbose log lines
    if (trimmed.length > 25 && seenLines.has(trimmed)) {
      continue;
    }
    if (trimmed.length > 25) seenLines.add(trimmed);

    // Strip excessive horizontal whitespace
    const condensed = rawLine.replace(/[ \t]{2,}/g, " ");
    cleanedLines.push(condensed);
  }

  let finalLines = cleanedLines;
  if (options.maxLines && finalLines.length > options.maxLines) {
    finalLines = finalLines.slice(-options.maxLines);
  }

  const compressed = finalLines.join("\n").trim();
  const compTokens = Math.ceil(compressed.length / 4);
  const tokensSaved = Math.max(0, origTokens - compTokens);
  const reduction = origTokens > 0 ? (tokensSaved / origTokens) * 100 : 0;

  return {
    originalLength: original.length,
    compressedLength: compressed.length,
    estimatedOriginalTokens: origTokens,
    estimatedCompressedTokens: compTokens,
    tokensSaved,
    reductionPercentage: Number(reduction.toFixed(1)),
    compressedText: compressed,
  };
}

// ── CAPITAL PRESERVATION CIRCUIT BREAKER ──

export interface CapitalProtectionAudit {
  equity: number;
  highWaterMark: number;
  currentDrawdown: number;
  maxDrawdownLimit: number;
  status: "SAFE" | "CAUTION" | "CIRCUIT_BREAKER_TRIGGERED";
  recommendedMaxBetFraction: number; // Kelly fraction
  riskWarning?: string;
}

export function auditCapitalProtection(params: {
  equity: number;
  highWaterMark: number;
  maxDrawdownLimit?: number; // e.g. 0.15 = 15%
  winRate?: number;          // e.g. 0.55
  profitFactor?: number;     // e.g. 1.8
}): CapitalProtectionAudit {
  const eq = Math.max(0, Number(params.equity) || 0);
  const hwm = Math.max(eq, Number(params.highWaterMark) || eq);
  const maxLimit = params.maxDrawdownLimit ?? 0.15; // 15% default max drawdown stop

  const dd = hwm > 0 ? Math.max(0, (hwm - eq) / hwm) : 0;

  // Kelly Fraction calculation: f* = (p * b - q) / b
  const p = params.winRate ?? 0.55;
  const q = 1 - p;
  const b = params.profitFactor ?? 1.5;
  const fullKelly = Math.max(0, (p * b - q) / b);
  const halfKelly = fullKelly * 0.5;

  let status: "SAFE" | "CAUTION" | "CIRCUIT_BREAKER_TRIGGERED" = "SAFE";
  let warning: string | undefined;

  if (dd >= maxLimit) {
    status = "CIRCUIT_BREAKER_TRIGGERED";
    warning = `EMERGENCY STOP: Drawdown (${(dd * 100).toFixed(1)}%) has breached the maximum limit (${(maxLimit * 100).toFixed(1)}%). Halting new positions to preserve capital.`;
  } else if (dd >= maxLimit * 0.6) {
    status = "CAUTION";
    warning = `Warning: Drawdown is at ${(dd * 100).toFixed(1)}% (approaching ${(maxLimit * 100).toFixed(1)}% limit). Reduce position sizing to quarter-Kelly.`;
  }

  return {
    equity: eq,
    highWaterMark: hwm,
    currentDrawdown: Number(dd.toFixed(4)),
    maxDrawdownLimit: maxLimit,
    status,
    recommendedMaxBetFraction: Number(halfKelly.toFixed(3)),
    riskWarning: warning,
  };
}
