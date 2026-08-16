// ─────────────────────────────────────────────────────────────
//  S.A.M. · APPLE MULTI-DEVICE ECOSYSTEM & WATCH DISPATCH
//
//  Unifies Mac, iPhone, iPad, and Apple Watch:
//  - Watch voice-to-prompt dispatch & glanceable wrist cards
//  - Interactive wrist action approvals (Yard build / FlipIt halt)
//  - Apple AppIntents & Siri Shortcuts schema integration
//  - Cross-device Continuity session handoff
// ─────────────────────────────────────────────────────────────

import { runModel } from "./models.ts";
import { resolveOptimalRoute } from "./speculative-router.ts";
import { trySolveLocally } from "./local-micro-solver.ts";
import { prepareMobilePush, type PreparedPushNotification } from "./mobile-bridge.ts";

export interface WatchPromptRequest {
  transcript: string;
  sourceDevice: "apple_watch" | "siri_shortcut" | "widget" | "ipad_canvas" | "mac_node";
  deviceId?: string;
  wantsSpeech?: boolean;
}

export interface WatchPromptResponse {
  glanceText: string;
  fullAnswer: string;
  speechAudioPrompt: string;
  tier: string;
  isZeroCost: boolean;
  suggestedActions: { id: string; label: string; action: string; destructive?: boolean }[];
  durationMs: number;
}

export interface AppleAppIntentDef {
  intentId: string;
  title: string;
  description: string;
  parameters: { name: string; type: "string" | "number" | "boolean"; required: boolean }[];
  supportedDevices: ("watchOS" | "iOS" | "iPadOS" | "macOS")[];
}

export const APPLE_APP_INTENTS: AppleAppIntentDef[] = [
  {
    intentId: "AskSAMIntent",
    title: "Ask SAM Anything",
    description: "Voice-driven prompt dispatched directly to SAM's difficulty cascade brain matrix.",
    parameters: [{ name: "prompt", type: "string", required: true }],
    supportedDevices: ["watchOS", "iOS", "iPadOS", "macOS"],
  },
  {
    intentId: "CheckSystemStatusIntent",
    title: "Check System Vitals",
    description: "Glanceable overview of active yard tasks, memory health, and portfolio P&L.",
    parameters: [],
    supportedDevices: ["watchOS", "iOS", "iPadOS", "macOS"],
  },
  {
    intentId: "ApproveYardTaskIntent",
    title: "Approve Pending Build",
    description: "Authorize a sensitive code execution or terminal command directly from Apple Watch.",
    parameters: [{ name: "taskId", type: "string", required: true }],
    supportedDevices: ["watchOS", "iOS", "macOS"],
  },
  {
    intentId: "FlipItRiskHaltIntent",
    title: "FlipIt Emergency Halt",
    description: "Trigger immediate circuit-breaker to halt leveraged allocations and hedge portfolio.",
    parameters: [],
    supportedDevices: ["watchOS", "iOS", "macOS"],
  },
];

export async function processWatchPrompt(req: WatchPromptRequest): Promise<WatchPromptResponse> {
  const t0 = Date.now();
  const text = String(req.transcript || "").trim();
  if (!text) {
    return {
      glanceText: "I'm listening. Ask me anything.",
      fullAnswer: "I'm listening. Ask me anything.",
      speechAudioPrompt: "I'm listening. Ask me anything.",
      tier: "TIER_0_INSTANT",
      isZeroCost: true,
      suggestedActions: [],
      durationMs: 1,
    };
  }

  // 1. Try Zero-Token Micro Solver first for sub-millisecond local Watch answers
  const micro = trySolveLocally(text);
  if (micro.solvedLocally) {
    const glance = micro.answer.length > 80 ? `${micro.answer.slice(0, 77)}...` : micro.answer;
    return {
      glanceText: glance,
      fullAnswer: micro.answer,
      speechAudioPrompt: micro.answer,
      tier: "TIER_0_LOCAL_MICRO",
      isZeroCost: true,
      suggestedActions: [],
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  // 2. Route via Speculative Difficulty Cascade
  const route = resolveOptimalRoute(text);
  const actions: WatchPromptResponse["suggestedActions"] = [];

  const lower = text.toLowerCase();
  if (lower.includes("build") || lower.includes("task") || lower.includes("yard")) {
    actions.push({ id: "view_task", label: "View Yard", action: "open_surface:tasks" });
  }
  if (lower.includes("halt") || lower.includes("trade") || lower.includes("portfolio") || lower.includes("risk")) {
    actions.push({ id: "halt_risk", label: "Halt Leveraged Trades", action: "flipit:circuit_breaker", destructive: true });
  }

  try {
    const res = await runModel(
      "free",
      "You are SAM, a fast AI assistant on Apple Watch. Answer with extreme clarity in 1-2 concise sentences.",
      text
    );
    const answer = res.text || "Task processed.";
    // Create a compact, glanceable wrist summary
    const glance = answer.length > 120 ? `${answer.slice(0, 117)}...` : answer;

    return {
      glanceText: glance,
      fullAnswer: answer,
      speechAudioPrompt: glance,
      tier: route.tier,
      isZeroCost: route.isZeroCostLane,
      suggestedActions: actions,
      durationMs: Math.max(1, Date.now() - t0),
    };
  } catch (err: any) {
    return {
      glanceText: `SAM: ${err?.message || "Processed locally."}`,
      fullAnswer: `Processed locally: ${err?.message || "Complete"}`,
      speechAudioPrompt: "Processed locally.",
      tier: route.tier,
      isZeroCost: route.isZeroCostLane,
      suggestedActions: actions,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }
}

export function prepareWatchActionNotification(params: {
  title: string;
  body: string;
  category: "APPROVE_TASK" | "FLIPIT_ALERT" | "SWARM_UPDATE";
  actionId: string;
}): PreparedPushNotification {
  return prepareMobilePush({
    title: params.title,
    body: params.body,
    category: "alert",
    data: {
      watchCategory: params.category,
      actionId: params.actionId,
      wristGlanceable: "true",
    },
    priority: "high",
  });
}
