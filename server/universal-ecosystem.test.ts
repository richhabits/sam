import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  processUniversalPrompt,
  UNIVERSAL_SHORTCUTS,
  registerDeviceHandoff,
  getDeviceHandoff,
} from "./universal-ecosystem.ts";

describe("Universal Multi-Device Ecosystem (Android, Wear OS, Windows, Linux, PWA)", () => {
  it("processes Wear OS smartwatch prompts with concise wrist formatting", async () => {
    const res = await processUniversalPrompt({
      transcript: "100 miles in km",
      platform: "wear_os",
      deviceName: "Galaxy Watch 6",
    });

    expect(res.platform).toBe("wear_os");
    expect(res.isZeroCost).toBe(true);
    expect(res.fullAnswer).toContain("160.93");
    expect(res.glanceText).toContain("160.93");
  });

  it("exposes universal shortcuts across Android, Windows, and Linux", () => {
    expect(UNIVERSAL_SHORTCUTS.length).toBeGreaterThanOrEqual(4);
    const flipit = UNIVERSAL_SHORTCUTS.find((s) => s.id === "flipit_shield_status");
    expect(flipit).toBeDefined();
    expect(flipit?.platforms).toContain("android");
    expect(flipit?.platforms).toContain("windows");
    expect(flipit?.platforms).toContain("wear_os");
  });

  it("handles seamless cross-device session handoff", () => {
    const session = registerDeviceHandoff({
      sessionId: "sess_xyz123",
      devicePlatform: "wear_os",
      deviceName: "Pixel Watch 2",
      activePrompt: "Review flipit portfolio allocations",
      activeSurface: "flipit",
    });

    expect(session.sessionId).toBe("sess_xyz123");
    expect(session.lastActiveDevice).toBe("wear_os");

    const retrieved = getDeviceHandoff("sess_xyz123");
    expect(retrieved?.activeSurface).toBe("flipit");
    expect(retrieved?.deviceName).toBe("Pixel Watch 2");
  });

  // AUDIT FIX: activeHandoffs had no TTL or size bound at all, unlike pairing.ts's pendingCodes
  // (short-lived, pruned on mint) — an authenticated caller could grow it unbounded forever.
  describe("handoff sessions expire — no unbounded growth", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("a session is gone after the TTL window", () => {
      registerDeviceHandoff({
        sessionId: "sess_ttl_test",
        devicePlatform: "android",
        deviceName: "Pixel 9",
        activePrompt: "test",
      });
      expect(getDeviceHandoff("sess_ttl_test")).not.toBeNull();

      vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes — past the 30-minute TTL
      expect(getDeviceHandoff("sess_ttl_test")).toBeNull();
    });

    it("registering a new session prunes other expired ones", () => {
      registerDeviceHandoff({ sessionId: "sess_old", devicePlatform: "android", deviceName: "Old" });
      vi.advanceTimersByTime(31 * 60 * 1000);
      registerDeviceHandoff({ sessionId: "sess_new", devicePlatform: "ios", deviceName: "New" });

      expect(getDeviceHandoff("sess_old")).toBeNull();
      expect(getDeviceHandoff("sess_new")).not.toBeNull();
    });
  });
});
