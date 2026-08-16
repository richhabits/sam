// ─────────────────────────────────────────────────────────────
//  S.A.M. · MASTER SYSTEM ORCHESTRATOR
//
//  Single telemetry hub aggregating live state across all
//  subsystems: Swarm Pipelines, Self-Healing Doctor, L1/L2 Caches,
//  FlipIt 100x Desk, Higgsfield Studio, Cost Optimizer & Mobile.
// ─────────────────────────────────────────────────────────────

import { autoHealDoctor } from "./doctor.ts";
import { getMultiTierCacheStats } from "./cache.ts";
import { getSavingsSummary } from "./cost-optimizer.ts";
import { desk, project100xLadder } from "./flipit.ts";
import { HIGGSFIELD_CAMERA_RIGS, HIGGSFIELD_LENSES } from "./studio-higgsfield.ts";
import { getMobileBridgeStatus } from "./mobile-bridge.ts";
import { TOOLS } from "./tools.ts";

export interface MasterDashboard {
  timestamp: number;
  systemHealth: {
    status: "HEALTHY" | "DEGRADED" | "CRITICAL";
    doctorSummary: string;
    activeToolsCount: number;
  };
  cacheStats: {
    l1Entries: number;
    l2Entries: number;
    totalHitRatioPct: number;
  };
  costSavings: {
    totalRequests: number;
    freeTierPct: number;
    dollarsSaved: number;
    estimatedGbpSaved: number;
  };
  flipitQuant: {
    equityGbp: number;
    currentRung: number;
    inBand: boolean;
    safePositionGbp: number;
  };
  studioHiggsfield: {
    cameraRigsCount: number;
    lensProfilesCount: number;
    soulIdSupported: boolean;
  };
  mobileBridge: {
    pairedDevicesCount: number;
    apnsOnline: boolean;
    fcmOnline: boolean;
  };
}

export function getMasterDashboard(): MasterDashboard {
  const heal = autoHealDoctor({
    hasCloudKeys: true,
    ollamaConfigured: false,
    ollamaReachable: false,
    online: true,
    vaultWritable: true,
    platform: process.platform,
  });

  const cache = getMultiTierCacheStats();
  const savings = getSavingsSummary();
  const d = desk();
  const ladder = project100xLadder(d.now?.equity ?? 5.0);
  const mobile = getMobileBridgeStatus();

  const totalHits = cache.l1.hits + (cache.semantic?.hits || 0);
  const totalMisses = cache.l1.misses + (cache.semantic?.misses || 0);
  const hitRatio = totalHits + totalMisses > 0 ? (totalHits / (totalHits + totalMisses)) * 100 : 0;

  return {
    timestamp: Date.now(),
    systemHealth: {
      status: heal.status === "clean" ? "HEALTHY" : "DEGRADED",
      doctorSummary: heal.summary,
      activeToolsCount: TOOLS.length,
    },
    cacheStats: {
      l1Entries: cache.l1.size,
      l2Entries: cache.semantic?.entries || 0,
      totalHitRatioPct: Number(hitRatio.toFixed(1)),
    },
    costSavings: {
      totalRequests: savings.ledger.totalRequests,
      freeTierPct: savings.freeEfficiencyPercentage,
      dollarsSaved: Number(savings.ledger.dollarsSavedTotal.toFixed(2)),
      estimatedGbpSaved: savings.estimatedGbpSaved,
    },
    flipitQuant: {
      equityGbp: Number((d.now?.equity ?? 5.0).toFixed(2)),
      currentRung: d.now?.rung ?? 0,
      inBand: d.now?.inBand ?? true,
      safePositionGbp: Number(((d.now?.equity ?? 5.0) * ladder.optimalKellyFraction).toFixed(2)),
    },
    studioHiggsfield: {
      cameraRigsCount: HIGGSFIELD_CAMERA_RIGS.length,
      lensProfilesCount: HIGGSFIELD_LENSES.length,
      soulIdSupported: true,
    },
    mobileBridge: {
      pairedDevicesCount: mobile.pairedDevicesCount,
      apnsOnline: mobile.apnsConfigured,
      fcmOnline: mobile.fcmConfigured,
    },
  };
}
