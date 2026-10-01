import type { Express } from "express";
import { appleAppIntents } from "./apple-ecosystem.ts";
import { getAsk, resolveAsk } from "./ask.ts";
import { recordAuditEvent, verifyAuditChainIntegrity } from "./audit-ledger.ts";
import { getHardwareVitals } from "./hardware-monitor.ts";
import { isLoopback, isPairedSession, isTrustedLocal } from "./http-guards.ts";
import { createGossipMessage, getMeshTopologyReport, processIncomingMeshGossip } from "./p2p-mesh.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { universalShortcuts } from "./universal-ecosystem.ts";
import { getOrCreateVoiceSession } from "./voice-agent.ts";

export type PendingActionResolver = (
  pendingId: string,
  approved: boolean,
  always?: boolean
) => Promise<{
  expired?: boolean;
  result?: any;
  error?: string;
  [k: string]: any;
}>;

export interface CompanionRouteOptions {
  resolvePending?: PendingActionResolver;
}

export function registerCompanionRoutes(app: Express, options?: CompanionRouteOptions) {
  // Watches and PWAs poll vitals, so the budget is generous: 120/min per IP.
  const companionLimit = createRateLimiter({ max: 120, message: "Too many companion requests. Please slow down." });

  // Companion Vitals Endpoint (Apple Watch / Wear OS / Mobile PWA)
  app.get("/api/companion/vitals", companionLimit, (_req, res) => {
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
    // Approving runs a tool SAM paused on. /api/confirm (the same decision, from the HUD) is held by
    // the global mutation gate: the passkey or a paired session. Bare isLoopback here was weaker than
    // that — any local process passes it knowing no secret — so the same bar is enforced in-handler,
    // on top of staying loopback-only (a watch reaches us through a local bridge, not the LAN).
    if (!isLoopback(req)) {
      return res.status(403).json({ error: "Companion approvals can only originate from loopback/local device bridges." });
    }
    if (!isTrustedLocal(req) && !isPairedSession(req)) {
      return res.status(401).json({ error: "not paired", locked: true });
    }

    const { actionId, actor, details, always } = req.body || {};
    if (!actionId) {
      return res.status(400).json({ error: "actionId is required for companion approval." });
    }

    // 1. If options.resolvePending is injected, try the real pending-tool-approval store first.
    // "expired" here just means takePending() found nothing for this id — it doesn't mean the
    // actionId is invalid, since Asks live in a completely separate store (ask.ts). Falling
    // through to step 2 instead of 410-ing here is what lets an unattended Ask still resolve
    // once a real resolver is wired — without it, this branch always wins and Ask resolution
    // becomes permanently unreachable in the running app (resolvePending is always injected).
    let pendingToolExpired = false;
    if (options?.resolvePending) {
      const outcome = await options.resolvePending(String(actionId), true, !!always);
      if (outcome.error) {
        return res.status(500).json({ success: false, error: outcome.error });
      }
      if (!outcome.expired) {
        const entry = recordAuditEvent(
          actor === "watch" ? "watch_companion" : "operator",
          `COMPANION_APPROVE_${String(actionId).toUpperCase()}`,
          { actionId, resolvedType: "PENDING_TOOL_EXECUTION", details: details || {} },
          "SUCCESS"
        );
        return res.json({
          success: true,
          actionId,
          resolvedType: "PENDING_TOOL_EXECUTION",
          result: outcome,
          auditEntry: entry,
        });
      }
      // outcome.expired → no pending-tool record for this id; fall through to the Ask check below,
      // but remember it so a genuinely-unknown id still 410s instead of silently "succeeding" below.
      pendingToolExpired = true;
    }

    // 2. Check if this actionId resolves an unattended Ask
    const ask = getAsk(String(actionId));
    if (ask) {
      resolveAsk(String(actionId), true);
      const entry = recordAuditEvent(
        actor === "watch" ? "watch_companion" : "operator",
        `COMPANION_APPROVE_ASK_${String(actionId).toUpperCase()}`,
        { actionId, resolvedType: "UNATTENDED_ASK_RESOLUTION", tool: ask.tool, details: details || {} },
        "SUCCESS"
      );
      return res.json({
        success: true,
        actionId,
        resolvedType: "UNATTENDED_ASK_RESOLUTION",
        tool: ask.tool,
        auditEntry: entry,
      });
    }

    if (pendingToolExpired) {
      recordAuditEvent("operator", `COMPANION_APPROVE_EXPIRED_${String(actionId).toUpperCase()}`, { actionId }, "DENIED");
      return res.status(410).json({ success: false, error: "Approval expired or not found." });
    }

    // 3. Fallback generic companion confirmation (only when no resolver was injected at all)
    const entry = recordAuditEvent(
      actor === "watch" ? "watch_companion" : "operator",
      `COMPANION_APPROVE_${String(actionId).toUpperCase()}`,
      { actionId, resolvedType: "GENERIC_ACTION", details: details || {} },
      "SUCCESS"
    );
    return res.json({
      success: true,
      actionId,
      resolvedType: "GENERIC_ACTION",
      auditEntry: entry,
    });
  });

  // Siri Shortcuts & Universal Companion Manifest
  app.get("/api/companion/shortcuts", (_req, res) => {
    res.json({
      appleAppIntents: appleAppIntents(),
      universalShortcuts: universalShortcuts(),
    });
  });

  // P2P Swarm Mesh Topology
  app.get("/api/p2p/mesh/nodes", (_req, res) => {
    res.json({
      success: true,
      timestamp: Date.now(),
      topology: getMeshTopologyReport(),
    });
  });

  // P2P Gossip Broadcast
  app.post("/api/p2p/mesh/broadcast", (req, res) => {
    if (!isLoopback(req)) {
      return res.status(403).json({ error: "Mesh broadcast can only originate from local bridges." });
    }
    const { channel, payload, vectorClock, maxHops } = req.body || {};
    if (!channel || !payload) {
      return res.status(400).json({ error: "channel and payload are required." });
    }

    const msg = createGossipMessage(channel, payload, vectorClock, maxHops);
    const result = processIncomingMeshGossip(msg);

    res.json({
      success: true,
      message: msg,
      result,
    });
  });

  // Voice Agent Session Status
  app.get("/api/voice/status", (req, res) => {
    const sessionId = (req.query.sessionId as string) || "default-mic";
    const session = getOrCreateVoiceSession(sessionId);
    res.json({
      success: true,
      session: session.getStatus(),
    });
  });
}
