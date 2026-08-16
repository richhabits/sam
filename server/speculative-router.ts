// ─────────────────────────────────────────────────────────────
//  S.A.M. · SPECULATIVE DIFFICULTY CASCADE ROUTER
//
//  Classifies incoming prompts into 3 complexity tiers and
//  routes them to the fastest free LPU (Cerebras/Groq @ 450 tok/s)
//  while reserving heavy reasoning models for multi-step tasks.
// ─────────────────────────────────────────────────────────────

export type ComplexityTier = "TIER_0_INSTANT" | "TIER_1_CODE_DATA" | "TIER_2_DEEP_REASON";

export interface SpeculativeRoutePlan {
  prompt: string;
  tier: ComplexityTier;
  targetLatencyMs: number;
  primaryProvider: string;
  primaryModel: string;
  failoverChain: string[];
  isZeroCostLane: boolean;
  rationale: string;
}

export function classifyPromptTier(prompt: string): ComplexityTier {
  const p = String(prompt || "").toLowerCase().trim();
  if (!p) return "TIER_0_INSTANT";

  // Tier 2 triggers: multi-step swarms, mathematical proofs, architectural refactorings
  if (
    p.includes("swarm") ||
    p.includes("pipeline") ||
    p.includes("architect") ||
    p.includes("formal proof") ||
    p.includes("theorem") ||
    p.includes("multi-repo") ||
    p.includes("decompose") ||
    p.includes("exhaustive")
  ) {
    return "TIER_2_DEEP_REASON";
  }

  // Tier 1 triggers: coding, diffs, ast, tables, data profiling, debugging
  if (
    p.includes("function") ||
    p.includes("class") ||
    p.includes("typescript") ||
    p.includes("javascript") ||
    p.includes("csv") ||
    p.includes("table") ||
    p.includes("refactor") ||
    p.includes("fix bug") ||
    p.includes("unit test") ||
    p.includes("ast")
  ) {
    return "TIER_1_CODE_DATA";
  }

  // Tier 0 default: general conversation, glance cards, weather, status, summaries
  return "TIER_0_INSTANT";
}

export function resolveOptimalRoute(prompt: string): SpeculativeRoutePlan {
  const tier = classifyPromptTier(prompt);

  switch (tier) {
    case "TIER_0_INSTANT":
      return {
        prompt,
        tier,
        targetLatencyMs: 160,
        primaryProvider: "cerebras",
        primaryModel: "llama-3.1-70b-fast",
        failoverChain: ["groq", "sambanova", "together", "ollama"],
        isZeroCostLane: true,
        rationale: "Routed to ultra-low-latency wafer-scale LPU (450+ tok/s) at zero token cost.",
      };

    case "TIER_1_CODE_DATA":
      return {
        prompt,
        tier,
        targetLatencyMs: 380,
        primaryProvider: "deepseek",
        primaryModel: "deepseek-coder-v3",
        failoverChain: ["groq", "together", "openrouter"],
        isZeroCostLane: true,
        rationale: "Routed to specialized code & syntax analysis model with AST understanding.",
      };

    case "TIER_2_DEEP_REASON":
    default:
      return {
        prompt,
        tier,
        targetLatencyMs: 850,
        primaryProvider: "deepseek-r1",
        primaryModel: "deepseek-reasoner",
        failoverChain: ["anthropic", "gemini", "openrouter"],
        isZeroCostLane: false,
        rationale: "Escalated to deep chain-of-thought multi-step reasoning brain.",
      };
  }
}
