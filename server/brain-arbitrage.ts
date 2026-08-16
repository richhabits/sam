// ─────────────────────────────────────────────────────────────
//  S.A.M. · BRAIN PERFORMANCE & LATENCY ARBITRAGE ENGINE
//
//  Reference speed/throughput figures (typical published numbers, NOT a live per-request
//  benchmark — this never actually calls a provider) paired with REAL status: whether each
//  provider genuinely has a usable key right now, cross-checked against keys.ts's live pool
//  state (configured keys, healthy vs. cooling-down from real failures) rather than a hardcoded
//  "ONLINE" literal. AUDIT FIX: status used to be hardcoded "ONLINE" for every entry regardless
//  of whether a key was ever configured — a user with zero Groq/Cerebras keys would still be
//  confidently told those lanes were online.
// ─────────────────────────────────────────────────────────────

import { PROVIDER_REGISTRY } from "./providers.registry.ts";
import { keyStatus } from "./keys.ts";

export interface ProviderBenchmark {
  id: string;
  name: string;
  tier: "free" | "sub-penny" | "paid";
  typicalLatencyMs: number;
  tokensPerSecond: number;
  strengthCategory: "fast_interactive" | "deep_reasoning" | "coding_ast" | "vision_multimodal";
  status: "ONLINE" | "DEGRADED" | "NO_KEY";
}

export function getBrainPerformanceMatrix(): {
  totalConfiguredProviders: number;
  freeTierCount: number;
  fastestInteractiveProvider: string;
  bestReasoningProvider: string;
  benchmarks: ProviderBenchmark[];
} {
  // Real per-provider status: a genuinely keyless provider (noKey in the registry) is ONLINE by
  // construction; otherwise cross-check keys.ts's live pool state — healthy keys → ONLINE, keys
  // configured but all cooling down from real failures → DEGRADED, no keys configured at all →
  // NO_KEY. This is the one field on each entry that reflects reality; latencyMs/tokensPerSecond
  // below are typical published figures, not something this function ever measures.
  const pools = keyStatus();
  // Pollinations isn't in PROVIDER_REGISTRY at all — it's an image/video generation service
  // (see routes.studio.ts), not an LLM "brain", so it was never part of the single source of
  // provider identity that file's own header describes. It's genuinely keyless by design
  // elsewhere in this codebase, so absence from the registry must not read as absence of a key.
  const KNOWN_KEYLESS_OUTSIDE_REGISTRY = new Set(["pollinations"]);
  const liveStatus = (id: string): ProviderBenchmark["status"] => {
    const spec = PROVIDER_REGISTRY.find((p) => p.id === id);
    if (spec?.noKey || (!spec && KNOWN_KEYLESS_OUTSIDE_REGISTRY.has(id))) return "ONLINE";
    const pool = pools.find((p) => p.provider === id);
    if (!pool || pool.total === 0) return "NO_KEY";
    return pool.healthy > 0 ? "ONLINE" : "DEGRADED";
  };

  const benchmarks: ProviderBenchmark[] = [
    {
      id: "groq",
      name: "Groq (LPU Inference)",
      tier: "free",
      typicalLatencyMs: 180,
      tokensPerSecond: 280,
      strengthCategory: "fast_interactive",
      status: liveStatus("groq"),
    },
    {
      id: "cerebras",
      name: "Cerebras (Wafer-Scale)",
      tier: "free",
      typicalLatencyMs: 140,
      tokensPerSecond: 450,
      strengthCategory: "fast_interactive",
      status: liveStatus("cerebras"),
    },
    {
      id: "pollinations",
      name: "Pollinations Free Tier",
      tier: "free",
      typicalLatencyMs: 650,
      tokensPerSecond: 45,
      strengthCategory: "fast_interactive",
      status: liveStatus("pollinations"),
    },
    {
      id: "deepseek",
      name: "DeepSeek (V3 / R1 Reasoning)",
      tier: "sub-penny",
      typicalLatencyMs: 420,
      tokensPerSecond: 95,
      strengthCategory: "deep_reasoning",
      status: liveStatus("deepseek"),
    },
    {
      id: "anthropic",
      name: "Anthropic Claude 3.5 Sonnet",
      tier: "paid",
      typicalLatencyMs: 580,
      tokensPerSecond: 75,
      strengthCategory: "coding_ast",
      status: liveStatus("anthropic"),
    },
  ];

  const total = PROVIDER_REGISTRY.length || benchmarks.length;
  const freeCount = benchmarks.filter(b => b.tier === "free").length;

  // Pick the fastest/best-reasoning entry that's actually ONLINE right now, rather than a fixed
  // "Cerebras is fastest" claim regardless of whether Cerebras has ever had a key configured.
  const online = benchmarks.filter((b) => b.status === "ONLINE");
  const fastest = [...online].sort((a, b) => b.tokensPerSecond - a.tokensPerSecond)[0];
  const reasoning = online.find((b) => b.strengthCategory === "deep_reasoning") ?? online.find((b) => b.strengthCategory === "coding_ast");

  return {
    totalConfiguredProviders: total,
    freeTierCount: freeCount,
    fastestInteractiveProvider: fastest ? `${fastest.name} (${fastest.tokensPerSecond} tok/s, typical)` : "none online",
    bestReasoningProvider: reasoning ? reasoning.name : "none online",
    benchmarks,
  };
}

export function rankOptimalProvider(taskKind: "fast" | "reasoning" | "coding" | "vision"): {
  recommendedId: string;
  rationale: string;
  tier: "free" | "sub-penny" | "paid";
} {
  switch (taskKind) {
    case "fast":
      return {
        recommendedId: "groq",
        rationale: "Ultra-low latency (<200ms) with zero cost per token for interactive conversation.",
        tier: "free",
      };
    case "coding":
      return {
        recommendedId: "deepseek",
        rationale: "High coding benchmark scores with low cost and strong AST comprehension.",
        tier: "sub-penny",
      };
    case "vision":
      return {
        recommendedId: "gemini",
        rationale: "Superior multimodal visual understanding and OCR at generous free quota.",
        tier: "free",
      };
    case "reasoning":
    default:
      return {
        recommendedId: "deepseek",
        rationale: "Deep chain-of-thought mathematical reasoning and logic verification.",
        tier: "sub-penny",
      };
  }
}
