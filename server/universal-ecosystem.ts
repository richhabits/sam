// ─────────────────────────────────────────────────────────────
//  S.A.M. · UNIVERSAL MULTI-DEVICE ECOSYSTEM
//  (Android, Wear OS, Windows, Linux, Apple, & PWA)
//
//  Cross-device continuity and lightweight companion bridges:
//  - Wear OS & Android voice dispatch and quick tile actions
//  - Android App Actions & Google Assistant shortcuts manifest
//  - Windows 10/11 System Tray & Quick Hotkey Capture
//  - Universal real-time cross-device session handoff
// ─────────────────────────────────────────────────────────────

import { runModel } from "./models.ts";
import { trySolveLocally } from "./local-micro-solver.ts";
import { resolveOptimalRoute } from "./speculative-router.ts";

export type DevicePlatform = "android" | "wear_os" | "windows" | "linux" | "macos" | "ios" | "watchos" | "pwa";

export interface UniversalPromptRequest {
  transcript: string;
  platform: DevicePlatform;
  deviceId?: string;
  deviceName?: string;
  context?: { activeApp?: string; location?: string };
}

export interface UniversalPromptResponse {
  glanceText: string;
  fullAnswer: string;
  platform: DevicePlatform;
  tier: string;
  isZeroCost: boolean;
  actions: { id: string; label: string; payload: string; destructive?: boolean }[];
  durationMs: number;
}

export interface UniversalShortcutDef {
  id: string;
  shortLabel: string;
  longLabel: string;
  icon: string;
  actionUri: string;
  platforms: DevicePlatform[];
}

export const UNIVERSAL_SHORTCUTS: UniversalShortcutDef[] = [
  {
    id: "voice_quick_prompt",
    shortLabel: "Ask SAM",
    longLabel: "Ask SAM via Voice",
    icon: "mic",
    actionUri: "sam://prompt/voice",
    platforms: ["android", "wear_os", "windows", "ios", "watchos"],
  },
  {
    id: "yard_status",
    shortLabel: "Yard Status",
    longLabel: "View Active Yard Builds",
    icon: "build",
    actionUri: "sam://surface/tasks",
    platforms: ["android", "windows", "linux", "macos", "ios", "pwa"],
  },
  {
    id: "flipit_shield_status",
    shortLabel: "FlipIt Shield",
    longLabel: "Check Portfolio Risk Shield",
    icon: "shield",
    actionUri: "sam://surface/flipit",
    platforms: ["android", "wear_os", "windows", "macos", "ios", "watchos"],
  },
  {
    id: "camera_vision",
    shortLabel: "Look (Vision)",
    longLabel: "Look Through Device Camera",
    icon: "camera",
    actionUri: "sam://camera/look",
    platforms: ["android", "ios", "macos", "windows"],
  },
];

// In-memory active cross-device handoff registry
interface DeviceHandoffSession {
  sessionId: string;
  lastActiveDevice: DevicePlatform;
  deviceName: string;
  activePrompt: string;
  activeSurface: string;
  updatedAt: number;
}

const activeHandoffs = new Map<string, DeviceHandoffSession>();
// Unlike pairing.ts's pendingCodes (short-lived, single-use, pruned on mint), this had no TTL
// or size bound at all — an authenticated caller (the POST route is gated) could grow it
// unbounded indefinitely. 30 minutes is generous for genuine cross-device continuity while
// keeping the registry from accumulating forever.
const HANDOFF_TTL_MS = 30 * 60 * 1000;

export async function processUniversalPrompt(req: UniversalPromptRequest): Promise<UniversalPromptResponse> {
  const t0 = Date.now();
  const text = String(req.transcript || "").trim();
  const platform = req.platform || "pwa";

  if (!text) {
    return {
      glanceText: "I'm listening. Ask SAM anything.",
      fullAnswer: "I'm listening. Ask SAM anything.",
      platform,
      tier: "TIER_0_INSTANT",
      isZeroCost: true,
      actions: [],
      durationMs: 1,
    };
  }

  // 1. Instant local zero-token evaluation
  const micro = trySolveLocally(text);
  if (micro.solvedLocally) {
    const isWrist = platform === "wear_os" || platform === "watchos";
    const glance = isWrist && micro.answer.length > 80 ? `${micro.answer.slice(0, 77)}...` : micro.answer;

    return {
      glanceText: glance,
      fullAnswer: micro.answer,
      platform,
      tier: "TIER_0_LOCAL_MICRO",
      isZeroCost: true,
      actions: [],
      durationMs: Math.max(1, Date.now() - t0),
    };
  }

  // 2. Speculative Difficulty Routing
  const route = resolveOptimalRoute(text);
  const actions: UniversalPromptResponse["actions"] = [];

  const lower = text.toLowerCase();
  if (lower.includes("task") || lower.includes("build") || lower.includes("yard")) {
    actions.push({ id: "open_tasks", label: "Open Yard Tasks", payload: "surface:tasks" });
  }
  if (lower.includes("risk") || lower.includes("halt") || lower.includes("circuit") || lower.includes("trade")) {
    actions.push({ id: "halt_risk", label: "Trigger Risk Halt", payload: "flipit:circuit_breaker", destructive: true });
  }

  try {
    const systemPrompt = platform === "wear_os" || platform === "watchos"
      ? "You are SAM, a fast AI assistant on a smartwatch. Give direct, high-value answers in 1-2 brief sentences."
      : "You are SAM, an intelligent autonomous assistant. Answer clearly, accurately, and concisely.";

    const res = await runModel("free", systemPrompt, text);
    const answer = res.text || "Task processed.";
    const glance = answer.length > 120 ? `${answer.slice(0, 117)}...` : answer;

    return {
      glanceText: glance,
      fullAnswer: answer,
      platform,
      tier: route.tier,
      isZeroCost: route.isZeroCostLane,
      actions,
      durationMs: Math.max(1, Date.now() - t0),
    };
  } catch (err: any) {
    return {
      glanceText: `SAM: ${err?.message || "Processed locally."}`,
      fullAnswer: `Processed locally: ${err?.message || "Complete"}`,
      platform,
      tier: route.tier,
      isZeroCost: route.isZeroCostLane,
      actions,
      durationMs: Math.max(1, Date.now() - t0),
    };
  }
}

export function registerDeviceHandoff(session: {
  sessionId: string;
  devicePlatform: DevicePlatform;
  deviceName: string;
  activePrompt?: string;
  activeSurface?: string;
}): DeviceHandoffSession {
  const now = Date.now();
  for (const [id, entry] of activeHandoffs) if (now - entry.updatedAt > HANDOFF_TTL_MS) activeHandoffs.delete(id);

  const data: DeviceHandoffSession = {
    sessionId: session.sessionId,
    lastActiveDevice: session.devicePlatform,
    deviceName: session.deviceName || "Unknown Device",
    activePrompt: session.activePrompt || "",
    activeSurface: session.activeSurface || "chat",
    updatedAt: now,
  };
  activeHandoffs.set(session.sessionId, data);
  return data;
}

export function getDeviceHandoff(sessionId: string): DeviceHandoffSession | null {
  const entry = activeHandoffs.get(sessionId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > HANDOFF_TTL_MS) { activeHandoffs.delete(sessionId); return null; }
  return entry;
}
