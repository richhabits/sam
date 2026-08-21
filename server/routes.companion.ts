import type { Express } from "express";
import { getHardwareVitals } from "./hardware-monitor.ts";
import { recordAuditEvent, verifyAuditChainIntegrity } from "./audit-ledger.ts";
import { APPLE_APP_INTENTS } from "./apple-ecosystem.ts";
import { UNIVERSAL_SHORTCUTS } from "./universal-ecosystem.ts";
import { isLoopback } from "./http-guards.ts";

export function registerCompanionRoutes(app: Express) {
  // Companion Vitals Endpoint (Apple Watch / Wear OS / Mobile PWA)
  app.get("/api/companion/vitals", (_req, res) => {
    const vitals = getHardwareVitals();
    const auditStatus = verifyAuditChainIntegrity();

    res.json({
      success: true,
      timestamp: Date.now(),
      vitals,
      auditChain: {
        valid: auditStatus.valid,
        totalEntries: auditStatus.totalEntries,
        latestHash: auditStatus.latestHash,
      },
    });
  });

  // 1-Tap Companion Action Approval Endpoint
  app.post("/api/companion/action/approve", async (req, res) => {
    if (!isLoopback(req)) {
      return res.status(403).json({ error: "Companion approvals can only originate from loopback/local device bridges." });
    }

    const { actionId, actor, details } = req.body || {};
    if (!actionId) {
      return res.status(400).json({ error: "actionId is required for companion approval." });
    }

    const entry = recordAuditEvent(
      actor === "watch" ? "watch_companion" : "operator",
      `COMPANION_APPROVE_${String(actionId).toUpperCase()}`,
      details || {},
      "SUCCESS"
    );

    res.json({
      success: true,
      actionId,
      auditEntry: entry,
    });
  });

  // Siri Shortcuts & Universal Companion Manifest
  app.get("/api/companion/shortcuts", (_req, res) => {
    res.json({
      appleAppIntents: APPLE_APP_INTENTS,
      universalShortcuts: UNIVERSAL_SHORTCUTS,
    });
  });
}
