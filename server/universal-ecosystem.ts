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

export interface SystemPlatformInfo {
  os: "darwin" | "win32" | "linux" | "other";
  arch: string;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  notificationBridge: "osascript" | "powershell" | "notify-send" | "fallback";
}

/**
 * Returns runtime host OS platform capabilities (macOS, Windows, Linux)
 */
export function getSystemPlatformInfo(): SystemPlatformInfo {
  const platform = process.platform;
  const isMac = platform === "darwin";
  const isWindows = platform === "win32";
  const isLinux = platform === "linux";

  let notificationBridge: SystemPlatformInfo["notificationBridge"] = "fallback";
  if (isMac) notificationBridge = "osascript";
  else if (isWindows) notificationBridge = "powershell";
  else if (isLinux) notificationBridge = "notify-send";

  return {
    os: isMac ? "darwin" : isWindows ? "win32" : isLinux ? "linux" : "other",
    arch: process.arch,
    isMac,
    isWindows,
    isLinux,
    notificationBridge,
  };
}

export interface NativeNotificationResult {
  dispatched: boolean;
  channel: string;
  title: string;
  body: string;
}

/**
 * Dispatches a native desktop notification across macOS, Windows, and Linux.
 */
export async function dispatchNativeNotification(
  title: string,
  message: string,
  options?: { subtitle?: string; sound?: boolean }
): Promise<NativeNotificationResult> {
  const cleanTitle = String(title || "S.A.M. Alert").replace(/["'\\]/g, "");
  const cleanMsg = String(message || "").replace(/["'\\]/g, "");
  const cleanSub = String(options?.subtitle || "").replace(/["'\\]/g, "");
  const sound = options?.sound !== false;

  const info = getSystemPlatformInfo();

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return {
      dispatched: true,
      channel: `test:${info.notificationBridge}`,
      title: cleanTitle,
      body: cleanMsg,
    };
  }

  try {
    const { exec } = await import("node:child_process");
    if (info.isMac) {
      const soundArg = sound ? 'sound name "default"' : "";
      const subArg = cleanSub ? `subtitle "${cleanSub}"` : "";
      const script = `display notification "${cleanMsg}" with title "${cleanTitle}" ${subArg} ${soundArg}`;
      exec(`osascript -e '${script}'`);
    } else if (info.isWindows) {
      const psScript = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName("text")
$textNodes.Item(0).AppendChild($template.CreateTextNode("${cleanTitle}")) > $null
$textNodes.Item(1).AppendChild($template.CreateTextNode("${cleanMsg}")) > $null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("S.A.M.").Show($toast)
      `.trim().replace(/\n/g, "; ");
      exec(`powershell -Command "${psScript}"`);
    } else if (info.isLinux) {
      exec(`notify-send "${cleanTitle}" "${cleanMsg}"`);
    }
    return {
      dispatched: true,
      channel: info.notificationBridge,
      title: cleanTitle,
      body: cleanMsg,
    };
  } catch (err: any) {
    return {
      dispatched: false,
      channel: "error",
      title: cleanTitle,
      body: `Notification failed: ${err?.message || "Unknown error"}`,
    };
  }
}

/**
 * Platform-agnostic default URL/file opener (macOS open, Windows start, Linux xdg-open)
 */
export async function openCrossPlatformUri(uri: string): Promise<{ success: boolean; command: string }> {
  const cleanUri = String(uri || "").trim();
  const info = getSystemPlatformInfo();
  let cmd = "open";
  if (info.isWindows) cmd = "cmd.exe /c start";
  else if (info.isLinux) cmd = "xdg-open";

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return { success: true, command: `${cmd} ${cleanUri}` };
  }

  try {
    const { exec } = await import("node:child_process");
    exec(`${cmd} "${cleanUri}"`);
    return { success: true, command: `${cmd} ${cleanUri}` };
  } catch {
    return { success: false, command: `${cmd} ${cleanUri}` };
  }
}
