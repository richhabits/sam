import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  prepareMobilePush,
  issueBiometricChallenge,
  verifyBiometricChallenge,
  getMobileBridgeStatus,
} from "./mobile-bridge.ts";
import { mobileDispatchNotificationTool } from "./tools.ts";

describe("Mobile Bridge & Push Notification Engine", () => {
  it("formats APNs and FCM push payloads with privacy scrubbing", () => {
    const prep = prepareMobilePush({
      title: "Trading Alert: sk-ant-api03-secretkey12345678",
      body: "Ladder milestone reached on Rung 15. Target: £450.00",
      category: "watchdog",
      deepLink: "/flipit",
    });

    expect(prep.notificationId).toContain("notif_");
    expect(prep.scrubbedTitle).not.toContain("secretkey12345678");
    expect(prep.apnsPayload.aps.category).toBe("WATCHDOG");
    expect(prep.apnsPayload.aps["thread-id"]).toBe("sam_watchdog");
    expect(prep.fcmPayload.android.notification.channelId).toBe("sam_urgent");
    expect(prep.apnsPayload.data.deepLink).toBe("/flipit");
  });

  it("issues and verifies biometric challenge-response tokens", () => {
    const challenge = issueBiometricChallenge("Authorize high-stakes trade");
    expect(challenge.challengeId).toContain("bio_");
    expect(challenge.nonce.length).toBeGreaterThanOrEqual(16);

    const token = createHash("sha256").update(challenge.nonce + challenge.purpose).digest("hex");
    const verified = verifyBiometricChallenge(challenge.challengeId, token);
    expect(verified).toBe(true);

    // Cannot replay token
    const replayed = verifyBiometricChallenge(challenge.challengeId, token);
    expect(replayed).toBe(false);
  });

  // AUDIT FIX: verifyBiometricChallenge used to also accept the raw nonce echoed straight
  // back as "valid" — but issueBiometricChallenge() hands the nonce to the caller in its own
  // response, so that accepted a value that proves nothing beyond "received the HTTP
  // response." Removed; this pins it rejected. (Note the sha256(nonce+purpose) path above
  // isn't real biometric proof either, for the same reason — see the warning comment on
  // verifyBiometricChallenge. This function is currently unwired to any route or tool.)
  it("rejects the raw nonce echoed back as a token — that proves nothing was actually verified", () => {
    const challenge = issueBiometricChallenge("Authorize high-stakes trade");
    const rejected = verifyBiometricChallenge(challenge.challengeId, challenge.nonce);
    expect(rejected).toBe(false);
  });

  it("retrieves mobile bridge device snapshot", () => {
    const status = getMobileBridgeStatus();
    expect(status.apnsConfigured).toBe(true);
    expect(status.fcmConfigured).toBe(true);
    expect(Array.isArray(status.devices)).toBe(true);
  });

  it("runs mobileDispatchNotificationTool", async () => {
    const out = await mobileDispatchNotificationTool({
      title: "Daily Briefing",
      body: "All systems online and green.",
      category: "task",
    });
    expect(out).toContain("Mobile Notification Prepared & Dispatched");
    expect(out).toContain("Daily Briefing");
    expect(out).toContain("APNs Category:");
  });
});
