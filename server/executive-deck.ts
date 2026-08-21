// ─────────────────────────────────────────────────────────────
//  S.A.M. · EXECUTIVE DAILY BRIEF & ACTION DECK GENERATOR
//
//  Compiles multi-source intelligence (connectors, system health,
//  market opportunities, project tasks) into a high-value C-suite
//  daily action deck with one-click execution triggers.
// ─────────────────────────────────────────────────────────────

import { getMasterDashboard } from "./orchestrator.ts";
import { huntRevenueOpportunities } from "./revenue-hunter.ts";
import { getAutoProvisionStatus } from "./auto-provision.ts";

export interface ActionCard {
  id: string;
  title: string;
  category: "revenue" | "engineering" | "operations" | "security";
  priority: "critical" | "high" | "medium";
  description: string;
  suggestedAction: string;
  estimatedRoiUSD?: number;
}

export interface ExecutiveDailyDeck {
  generatedAt: number;
  executiveHeadline: string;
  systemReadinessScorePct: number;
  totalPendingActions: number;
  estimatedDailyAlphaUSD: number;
  cards: ActionCard[];
  quickMetrics: {
    onlineServices: number;
    activeKeyPools: number;
    openOpportunities: number;
  };
}

export async function generateExecutiveDailyDeck(): Promise<ExecutiveDailyDeck> {
  const dash = getMasterDashboard();
  const rev = await huntRevenueOpportunities({ synthesizeStrategy: false });
  const prov = getAutoProvisionStatus();

  const cards: ActionCard[] = [];

  // 1. Revenue Opportunities
  for (const opp of rev.items) {
    cards.push({
      id: `act-rev-${opp.id}`,
      title: opp.title,
      category: "revenue",
      priority: opp.estimatedValueUSD > 500 ? "high" : "medium",
      description: opp.summary,
      suggestedAction: opp.actionSteps[0] || "Execute opportunity workflow",
      estimatedRoiUSD: opp.estimatedValueUSD,
    });
  }

  // 2. System Readiness & Key Pools
  if (prov.configuredProvidersCount < 5) {
    cards.push({
      id: "act-sys-prov",
      title: "1-Click Auto-Provision Free Key Pools",
      category: "operations",
      priority: "high",
      description: `Only ${prov.configuredProvidersCount}/${prov.totalSupportedProviders} providers configured. Auto-provision to unlock full zero-cost rotation.`,
      suggestedAction: "Trigger POST /api/keys/auto-provision",
    });
  }

  const systemScore = Math.min(100, Math.round(
    (dash.systemHealth?.status === "HEALTHY" ? 50 : 20) +
    Math.min(30, prov.configuredProvidersCount * 5) +
    20
  ));

  return {
    generatedAt: Date.now(),
    executiveHeadline: `SAM Operating at ${systemScore}% Readiness · $${rev.totalEstimatedValueUSD.toLocaleString()} Daily Alpha Available`,
    systemReadinessScorePct: systemScore,
    totalPendingActions: cards.length,
    estimatedDailyAlphaUSD: rev.totalEstimatedValueUSD,
    cards,
    quickMetrics: {
      onlineServices: dash.systemHealth?.activeToolsCount || 235,
      activeKeyPools: prov.configuredProvidersCount,
      openOpportunities: rev.totalOpportunitiesFound,
    },
  };
}
