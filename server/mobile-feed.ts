// ─────────────────────────────────────────────────────────────
//  S.A.M. · MOBILE LIVE FEED HUB
//
//  Assembles high-speed live feed cards (Tasks, FlipIt, Studio,
//  System Alerts) into a compressed stream for iOS and Android apps.
// ─────────────────────────────────────────────────────────────

import { desk, project100xLadder } from "./flipit.ts";
import { HIGGSFIELD_CAMERA_RIGS } from "./studio-higgsfield.ts";
import { getMasterDashboard } from "./orchestrator.ts";

export interface MobileFeedCard {
  id: string;
  type: "TASK" | "MARKET" | "STUDIO" | "SYSTEM";
  title: string;
  subtitle: string;
  badge?: string;
  timestamp: number;
  deepLink: string;
  metadata: Record<string, any>;
}

export interface MobileLiveFeed {
  feedVersion: number;
  generatedAt: number;
  activeCards: MobileFeedCard[];
  unreadCount: number;
}

export function generateMobileFeed(): MobileLiveFeed {
  const dash = getMasterDashboard();
  const d = desk();
  const eq = d.now?.equity ?? 5.0;
  const ladder = project100xLadder(eq);

  const cards: MobileFeedCard[] = [
    // 1. FlipIt Market Card
    {
      id: `market_${Date.now()}`,
      type: "MARKET",
      title: `FlipIt Desk · £${eq.toFixed(2)}`,
      subtitle: `Rung ${d.now?.rung ?? 0} / 100 · Safe Bet: £${dash.flipitQuant.safePositionGbp.toFixed(2)} (Kelly Sized)`,
      badge: dash.flipitQuant.inBand ? "IN BAND" : "DRIFT ALERT",
      timestamp: Date.now(),
      deepLink: "/flipit",
      metadata: {
        equity: eq,
        rung: d.now?.rung ?? 0,
        nextTarget: ladder.rungs[0]?.targetEquity ?? (eq * 1.15),
      },
    },
    // 2. Studio 3D Motion Card
    {
      id: `studio_${Date.now()}`,
      type: "STUDIO",
      title: "Higgsfield AI Studio",
      subtitle: `${HIGGSFIELD_CAMERA_RIGS.length} 3D Camera Rigs & SoulID Character Lock Ready`,
      badge: "100X ENGINE",
      timestamp: Date.now() - 60000,
      deepLink: "/studio",
      metadata: {
        presetsAvailable: HIGGSFIELD_CAMERA_RIGS.length,
      },
    },
    // 3. System Health & Savings Card
    {
      id: `system_${Date.now()}`,
      type: "SYSTEM",
      title: "SAM Brain Status",
      subtitle: `${dash.systemHealth.status} · $${dash.costSavings.dollarsSaved.toFixed(2)} Free API Value Saved`,
      badge: `${dash.systemHealth.activeToolsCount} TOOLS`,
      timestamp: Date.now() - 120000,
      deepLink: "/settings",
      metadata: {
        freeTierPct: dash.costSavings.freeTierPct,
        cacheRatioPct: dash.cacheStats.totalHitRatioPct,
      },
    },
  ];

  return {
    feedVersion: 1,
    generatedAt: Date.now(),
    activeCards: cards,
    unreadCount: cards.length,
  };
}
