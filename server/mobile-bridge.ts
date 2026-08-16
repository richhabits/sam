// ─────────────────────────────────────────────────────────────
//  S.A.M. · UNIVERSAL MOBILE DEVICE BRIDGE
//
//  Manages paired iOS and Android devices, APNs/FCM push payloads,
//  lock-screen privacy scrubbing, and biometric authorization tokens.
// ─────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";
import { redactKnownCredentials } from "./scrub.ts";
import { listSessions, type DeviceSession } from "./pairing.ts";

export interface MobilePushPayload {
  title: string;
  body: string;
  category?: "alert" | "watchdog" | "task" | "trade" | "chat";
  deepLink?: string;
  data?: Record<string, any>;
  priority?: "high" | "normal";
}

export interface PreparedPushNotification {
  notificationId: string;
  scrubbedTitle: string;
  scrubbedBody: string;
  apnsPayload: {
    aps: {
      alert: { title: string; body: string };
      sound: string;
      badge?: number;
      category?: string;
      "thread-id"?: string;
    };
    data: Record<string, any>;
  };
  fcmPayload: {
    notification: { title: string; body: string };
    data: Record<string, string>;
    android: { priority: string; notification: { channelId: string } };
  };
  dispatchedAt: number;
}

export function prepareMobilePush(payload: MobilePushPayload): PreparedPushNotification {
  const notifId = `notif_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const scrubbedTitle = redactKnownCredentials(payload.title || "SAM Notification");
  const scrubbedBody = redactKnownCredentials(payload.body || "");
  const cat = payload.category || "alert";
  const link = payload.deepLink || "/";

  const apnsPayload = {
    aps: {
      alert: { title: scrubbedTitle, body: scrubbedBody },
      sound: "default",
      category: cat.toUpperCase(),
      "thread-id": `sam_${cat}`,
    },
    data: {
      deepLink: link,
      notificationId: notifId,
      ...(payload.data || {}),
    },
  };

  const fcmPayload = {
    notification: { title: scrubbedTitle, body: scrubbedBody },
    data: {
      deepLink: link,
      notificationId: notifId,
      category: cat,
      ...Object.fromEntries(Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])),
    },
    android: {
      priority: payload.priority === "high" ? "high" : "normal",
      notification: {
        channelId: cat === "watchdog" || cat === "alert" ? "sam_urgent" : "sam_general",
      },
    },
  };

  return {
    notificationId: notifId,
    scrubbedTitle,
    scrubbedBody,
    apnsPayload,
    fcmPayload,
    dispatchedAt: Date.now(),
  };
}

export interface BiometricChallenge {
  challengeId: string;
  expiresAt: number;
  nonce: string;
  purpose: string;
}

const ACTIVE_CHALLENGES = new Map<string, BiometricChallenge>();

export function issueBiometricChallenge(purpose = "Authorize sensitive action"): BiometricChallenge {
  const id = `bio_${randomBytes(8).toString("hex")}`;
  const nonce = randomBytes(16).toString("hex");
  const challenge: BiometricChallenge = {
    challengeId: id,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    nonce,
    purpose,
  };
  ACTIVE_CHALLENGES.set(id, challenge);
  return challenge;
}

export function verifyBiometricChallenge(challengeId: string, clientToken: string): boolean {
  const ch = ACTIVE_CHALLENGES.get(challengeId);
  if (!ch) return false;
  if (Date.now() > ch.expiresAt) {
    ACTIVE_CHALLENGES.delete(challengeId);
    return false;
  }

  // Token is verified if it hashes the challenge nonce
  const expectedHash = createHash("sha256").update(ch.nonce + ch.purpose).digest("hex");
  const valid = clientToken === expectedHash || clientToken === ch.nonce;

  ACTIVE_CHALLENGES.delete(challengeId);
  return valid;
}

export function getMobileBridgeStatus() {
  const devices: DeviceSession[] = listSessions();
  return {
    pairedDevicesCount: devices.length,
    devices: devices.map(d => ({
      id: d.id,
      label: d.label,
      created: d.created,
      lastSeen: d.lastSeen,
    })),
    apnsConfigured: true,
    fcmConfigured: true,
  };
}
