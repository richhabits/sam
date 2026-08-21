import type { Express } from "express";
import { getHardwareVitals } from "./hardware-monitor.ts";
import { recordAuditEvent, verifyAuditChainIntegrity } from "./audit-ledger.ts";
import { APPLE_APP_INTENTS } from "./apple-ecosystem.ts";
import { UNIVERSAL_SHORTCUTS } from "./universal-ecosystem.ts";
import { takePending } from "./pending.ts";
import { resolveAsk, getAsk } from "./ask.ts";
import { allow } from "./authz.ts";
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

    const { actionId, actor, details, always } = req.body || {};
    if (!actionId) {
      return res.status(400).json({ error: "actionId is required for companion approval." });
    }

    // Check if this actionId resolves a server-held pending tool approval
    const pending = takePending(String(actionId));
    let resolvedType = "GENERIC_ACTION";
    let toolName: string | undefined;

    if (pending) {
      resolvedType = "PENDING_TOOL_APPROVAL";
      toolName = pending.tool;
      if (always && toolName) {
        allow(toolName);
      }
    } else {
      // Check if this actionId resolves an unattended Ask
      const ask = getAsk(String(actionId));
      if (ask) {
        resolvedType = "UNATTENDED_ASK_RESOLUTION";
        toolName = ask.tool;
        resolveAsk(String(actionId), true);
      }
    }

    const entry = recordAuditEvent(
      actor === "watch" ? "watch_companion" : "operator",
      `COMPANION_APPROVE_${String(actionId).toUpperCase()}`,
      {
        actionId,
        resolvedType,
        tool: toolName,
        details: details || {},
      },
      "SUCCESS"
    );

    res.json({
      success: true,
      actionId,
      resolvedType,
      tool: toolName,
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
