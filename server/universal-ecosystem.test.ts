import { describe, it, expect } from "vitest";
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
});
