// ─────────────────────────────────────────────────────────────
//  S.A.M. · INTENT AUTO-DISAMBIGUATOR ("KNOWS WHAT'S WHAT")
//
//  Infers exact target actions from ambiguous/shorthand prompts
//  (e.g., "audit", "clean", "speed", "scale") based on workspace context.
// ─────────────────────────────────────────────────────────────

export interface DisambiguatedIntent {
  rawPrompt: string;
  inferredTarget: string;
  recommendedTool: string;
  inferredArgs: Record<string, any>;
  confidencePct: number;
  explanation: string;
}

export function disambiguateUserIntent(
  prompt: string,
  contextHints?: { activeFile?: string; recentAction?: string }
): DisambiguatedIntent {
  const p = String(prompt || "").toLowerCase().trim();

  // 1. Shorthand "audit" / "check" / "performance"
  if (p === "audit" || p.includes("audit brains") || p.includes("check latency") || p.includes("speed audit")) {
    return {
      rawPrompt: prompt,
      inferredTarget: "AI Provider Latency & Speed Matrix",
      recommendedTool: "brain_performance_matrix",
      inferredArgs: {},
      confidencePct: 96,
      explanation: "Audits active AI providers for live latency, token throughput, and zero-cost lanes.",
    };
  }

  // 2. Shorthand "clean" / "compact" / "space"
  if (p === "clean" || p === "compact" || p.includes("save space") || p.includes("free memory") || p.includes("clean up")) {
    return {
      rawPrompt: prompt,
      inferredTarget: "Memory & Storage Compactor",
      recommendedTool: "space_consumption_optimizer",
      inferredArgs: { mode: "compact" },
      confidencePct: 94,
      explanation: "Purges expired caches, audits V8 heap memory usage, and reclaims RAM footprint.",
    };
  }

  // 3. Shorthand "dashboard" / "status" / "what's going on"
  if (p === "status" || p === "dashboard" || p === "overview" || p.includes("system status")) {
    return {
      rawPrompt: prompt,
      inferredTarget: "Master Operations Dashboard",
      recommendedTool: "sam_master_dashboard",
      inferredArgs: {},
      confidencePct: 98,
      explanation: "Pulls aggregated server health, tool counts, memory vitals, and mobile status.",
    };
  }

  // 4. Shorthand "research" / "deep dive"
  if (p.startsWith("research") || p.startsWith("deep dive") || p.startsWith("find out about")) {
    const topic = p.replace(/^(?:research|deep dive on|deep dive into|find out about)\s*/i, "");
    return {
      rawPrompt: prompt,
      inferredTarget: `Deep Autonomous Research on "${topic || "active topic"}"`,
      recommendedTool: "deep_research_synthesizer",
      inferredArgs: { query: topic || "system architecture", depth: "deep" },
      confidencePct: 92,
      explanation: "Dispatches multi-angle inquiry with cross-source consensus verification.",
    };
  }

  // 5. Context-aware file fallback if user mentions "fix this" or "refactor"
  if ((p.includes("fix") || p.includes("refactor")) && contextHints?.activeFile) {
    return {
      rawPrompt: prompt,
      inferredTarget: `File AST refactoring on ${contextHints.activeFile}`,
      recommendedTool: "ast_replace_symbol",
      inferredArgs: { filePath: contextHints.activeFile },
      confidencePct: 88,
      explanation: `Applies AST-safe syntax refactoring to active file: ${contextHints.activeFile}`,
    };
  }

  // Default fallback
  return {
    rawPrompt: prompt,
    inferredTarget: "General Conversation & Reasoning",
    recommendedTool: "speculative_route_intent",
    inferredArgs: { prompt },
    confidencePct: 75,
    explanation: "Routes to the optimal difficulty tier brain with zero-latency hot-swap failover.",
  };
}
