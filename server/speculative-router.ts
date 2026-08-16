// ─────────────────────────────────────────────────────────────
//  S.A.M. · SPECULATIVE DIFFICULTY CASCADE ROUTER
//
//  Classifies incoming prompts into 3 complexity tiers and reports which provider WOULD handle
//  them — purely informational (speculative_route_intent's output never feeds into models.ts's
//  actual provider selection, which already does its own real key/cooldown checking).
//
//  AUDIT FIX: resolveOptimalRoute() used to hardcode primaryProvider/isZeroCostLane for every
//  tier regardless of whether that provider had ever had a key configured — the same class of
//  bug fixed in brain-arbitrage.ts earlier this session (a hardcoded "ONLINE" for every entry).
//  Now walks the failover chain for the first provider that genuinely has a usable key, and is
//  honest in the rationale when nothing in the chain is actually configured.
// ─────────────────────────────────────────────────────────────

import { PROVIDER_REGISTRY } from "./providers.registry.ts";
import { keyStatus } from "./keys.ts";

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

// True only when we can positively confirm a real, usable key — never guessed. Absence from
// both the registry and pools (e.g. "ollama", a local-only runner with no cloud key at all) is
// left as unverified rather than asserted either way; see resolveOptimalRoute below.
// Takes the already-fetched pool list rather than calling keyStatus() itself — this runs once
// per candidate in the failover chain, and keyStatus() building a fresh array each time is
// needless repeated work for data that doesn't change mid-call.
function hasConfirmedKey(id: string, pools: ReturnType<typeof keyStatus>): boolean {
  const spec = PROVIDER_REGISTRY.find((p) => p.id === id);
  if (spec?.noKey) return true;
  const pool = pools.find((p) => p.provider === id);
  return !!pool && pool.healthy > 0;
}

function planFor(
  prompt: string,
  tier: ComplexityTier,
  targetLatencyMs: number,
  primaryProvider: string,
  primaryModel: string,
  failoverChain: string[],
  isZeroCostLane: boolean,
  baseRationale: string,
): SpeculativeRoutePlan {
  const pools = keyStatus();
  const candidates = [primaryProvider, ...failoverChain];
  const confirmed = candidates.find((id) => hasConfirmedKey(id, pools));
  const rationale = confirmed
    ? (confirmed === primaryProvider ? baseRationale : `${baseRationale} (${primaryProvider} has no confirmed key right now — promoted ${confirmed} from the failover chain, which does.)`)
    : `${baseRationale} (best-effort plan — none of these providers have a confirmed configured key right now; actual availability at request time is what models.ts's real routing checks, not this.)`;

  return {
    prompt,
    tier,
    targetLatencyMs,
    primaryProvider: confirmed || primaryProvider,
    primaryModel: confirmed && confirmed !== primaryProvider ? confirmed : primaryModel,
    failoverChain,
    isZeroCostLane: confirmed ? isZeroCostLane : false,
    rationale,
  };
}

export function resolveOptimalRoute(prompt: string): SpeculativeRoutePlan {
  const tier = classifyPromptTier(prompt);

  switch (tier) {
    case "TIER_0_INSTANT":
      return planFor(prompt, tier, 160, "cerebras", "llama-3.1-70b-fast", ["groq", "sambanova", "together", "ollama"], true,
        "Ultra-low-latency wafer-scale LPU (450+ tok/s, typical) at zero token cost.");

    case "TIER_1_CODE_DATA":
      return planFor(prompt, tier, 380, "deepseek", "deepseek-coder-v3", ["groq", "together", "openrouter"], true,
        "Specialized code & syntax analysis model with AST understanding.");

    case "TIER_2_DEEP_REASON":
    default:
      return planFor(prompt, tier, 850, "deepseek", "deepseek-reasoner", ["anthropic", "gemini", "openrouter"], false,
        "Deep chain-of-thought multi-step reasoning brain.");
  }
}
