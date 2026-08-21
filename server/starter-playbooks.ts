// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — STARTER PLAYBOOKS LIBRARY
//
//  5 production-grade master playbooks ready for 1-click execution:
//  1. fullstack-saas-core (Vite + React + Express + SQLite + Stripe)
//  2. prediction-market-bot (Polymarket + Kalshi + Kelly Risk Shield)
//  3. executive-deep-research (Web intel + source consensus scoring)
//  4. studio-video-pipeline (3D camera vectors + storyboard + audio)
//  5. zero-cost-ai-proxy (Local micro-solver + 50-provider rotation)
// ─────────────────────────────────────────────────────────────

import { type Playbook, savePlaybook, listPlaybooks, getPlaybook } from "./yard/playbooks.ts";

export interface StarterPlaybookDef {
  id: string;
  name: string;
  category: "engineering" | "trading" | "research" | "creative" | "infra";
  description: string;
  template: string;
  defaultValues: Record<string, string>;
}

export const STARTER_PLAYBOOKS: StarterPlaybookDef[] = [
  {
    id: "fullstack-saas-core",
    name: "Full-Stack SaaS Scaffold (Vite + React + Express + Stripe)",
    category: "engineering",
    description: "Generates a complete production-grade SaaS architecture with SQLite WAL database, Stripe checkout webhooks, passkey auth, and glassmorphism UI.",
    template: `Build a complete production full-stack SaaS application named "{{appName}}".
Target domain: {{appDomain}}.
Core features to build:
1. Express backend with SQLite WAL mode database migrations for users, subscriptions, and transactions.
2. Real Stripe checkout session creation (/api/checkout) and HMAC-SHA256 webhook listener (/api/webhook).
3. Vite + React frontend with dark-mode glassmorphism UI, real-time analytics dashboard, and subscription management.
4. Comprehensive test suite with Vitest verifying routes, security gates, and database integrity.
Deliver working code with zero mocks, strict type safety, and zero external runtime bloat.`,
    defaultValues: {
      appName: "AlphaLaunch",
      appDomain: "Autonomous B2B Workflow Automation",
    },
  },
  {
    id: "prediction-market-bot",
    name: "Prediction Market Quantitative Arbitrage Bot",
    category: "trading",
    description: "Sets up high-frequency prediction market arbitrage scanner between Polymarket and Kalshi with Kelly Criterion leverage constraints.",
    template: `Scaffold and configure an algorithmic prediction market trading engine for asset pair "{{marketPair}}".
Allocated capital: £{{allocatedCapitalGbp}}.
Required modules:
1. Real-time WebSocket order book ticker ingestion with REST fallback.
2. Half-Kelly risk shield calculating optimal sizing and 20%+ drawdown circuit breakers.
3. Polymarket CLOB cryptographic signature adapter for direct order routing.
4. Monte Carlo 100,000-path projection calculating VaR, CVaR, Sharpe ratio, and ruin risk.
5. Unit tests validating that paper mode produces explicit PAPER_SIMULATED status and live mode verifies API keys.`,
    defaultValues: {
      marketPair: "BTC/USD",
      allocatedCapitalGbp: "2500",
    },
  },
  {
    id: "executive-deep-research",
    name: "Executive Deep Research & Market Dossier Engine",
    category: "research",
    description: "Deploys an autonomous multi-source web intelligence gatherer that compiles cited executive research reports with fact-checked URLs.",
    template: `Perform comprehensive, multi-pass deep research on the target topic: "{{researchTopic}}".
Focus angle: {{focusAngle}}.
Deliverables:
1. Key findings distilled into quantifiable facts.
2. Source consensus agreement matrix cross-referencing at least 3 distinct domains.
3. Risk factors and counter-evidence analysis.
4. Operational 1-click execution roadmap for immediate implementation.`,
    defaultValues: {
      researchTopic: "Autonomous AI Agent Swarms in Enterprise Supply Chains 2026",
      focusAngle: "Cost reduction, ROI, and commercial deployment hurdles",
    },
  },
  {
    id: "studio-video-pipeline",
    name: "Cinematic 3D Video Studio & Storyboard Pipeline",
    category: "creative",
    description: "Directs cinematic multi-scene storyboard sequences with 3D camera vector rigs, lighting palettes, lens optics, and audio cue timing.",
    template: `Direct and compile a cinematic video storyboard for narrative: "{{narrativeStoryline}}".
Scene count: {{sceneCount}} scenes in {{aspectRatio}} format.
Requirements:
1. Generate multi-scene plan with 3D camera vector rigs (dolly zoom, orbital pan, crane tilt).
2. Assign lighting schemes (Cyberpunk Neon, Golden Hour, Volumetric Noir) and lens optics (35mm Anamorphic, 50mm Prime f/1.2).
3. Compute SMPTE frame timestamps (24fps) and generate non-overlapping audio timeline cues with 32-bin waveforms.`,
    defaultValues: {
      narrativeStoryline: "Cyberpunk rogue AI escaping a localized mainframe into global hardware mesh",
      sceneCount: "4",
      aspectRatio: "16:9",
    },
  },
  {
    id: "zero-cost-ai-proxy",
    name: "Zero-Token AI Cost Arbitrage & Fast Solver Mesh",
    category: "infra",
    description: "Sets up an intelligent LLM proxy that intercepts math/JSON queries for 0-token local solving and rotates across 50 free model providers.",
    template: `Configure a high-efficiency AI gateway proxy for project "{{projectName}}".
Target monthly token savings target: \${{targetSavingsUsd}}.
Architecture:
1. Local micro-solver fast path intercepting deterministic math, unit conversions, and JSON parsing before hitting LLMs.
2. 50-provider round-robin key pooling across Groq, Cerebras, SambaNova, Gemini, Mistral, SiliconFlow, and Fireworks.
3. Real-time cost savings ledger recording token volume, benchmark pricing, and net dollars saved to JSON vault.
4. Auto-demote degraded providers on 429/5xx status to ensure sub-50ms response latency.`,
    defaultValues: {
      projectName: "Internal Team Microservices Gateway",
      targetSavingsUsd: "500",
    },
  },
];

/**
 * Seeds starter playbooks into the Yard playbooks directory if they don't already exist.
 */
export function seedStarterPlaybooks(): Playbook[] {
  const existing = listPlaybooks();
  const existingIds = new Set(existing.map((p) => p.id));
  const seeded: Playbook[] = [];

  for (const def of STARTER_PLAYBOOKS) {
    if (!existingIds.has(def.id)) {
      const pb = savePlaybook({
        id: def.id,
        name: def.name,
        template: def.template,
        lastValues: def.defaultValues,
      });
      seeded.push(pb);
    }
  }

  return seeded;
}

/**
 * Returns a starter playbook definition by ID or null.
 */
export function getStarterPlaybookDef(id: string): StarterPlaybookDef | null {
  return STARTER_PLAYBOOKS.find((p) => p.id === id) || null;
}
