import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  processUniversalPrompt,
  UNIVERSAL_SHORTCUTS,
  registerDeviceHandoff,
  getDeviceHandoff,
} from "./universal-ecosystem.ts";

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, execFile: mockExecFile };
});

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

  describe("Cross-Platform OS Bridges (macOS, Windows, Linux)", () => {
    it("identifies platform runtime capabilities", async () => {
      const { getSystemPlatformInfo } = await import("./universal-ecosystem.ts");
      const info = getSystemPlatformInfo();
      expect(info.os).toBeDefined();
      expect(["darwin", "win32", "linux", "other"]).toContain(info.os);
      expect(info.arch).toBeDefined();
      expect(["osascript", "powershell", "notify-send", "fallback"]).toContain(info.notificationBridge);
    });

    it("dispatches native notifications cleanly across platforms", async () => {
      const { dispatchNativeNotification } = await import("./universal-ecosystem.ts");
      const res = await dispatchNativeNotification("Yard Build Succeeded", "All 230 tests passed clean.", {
        subtitle: "Antigravity Compiler",
      });
      expect(res.dispatched).toBe(true);
      expect(res.title).toBe("Yard Build Succeeded");
      expect(res.body).toBe("All 230 tests passed clean.");
    });

    it("resolves cross-platform URI commands cleanly", async () => {
      const { openCrossPlatformUri } = await import("./universal-ecosystem.ts");
      const res = await openCrossPlatformUri("https://github.com");
      expect(res.success).toBe(true);
      expect(res.command).toMatch(/(open|start|xdg-open)/);
    });

    describe("shell-injection resistance (real dispatch path, not the test-mode short-circuit)", () => {
      const realEnv = { VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV };
      beforeEach(() => {
        mockExecFile.mockReset();
        delete process.env.VITEST;
        process.env.NODE_ENV = "production";
      });
      afterEach(() => {
        if (realEnv.VITEST !== undefined) process.env.VITEST = realEnv.VITEST;
        process.env.NODE_ENV = realEnv.NODE_ENV;
      });

      it("passes notification content as argv, never as a shell-interpolated string — a payload with shell/PowerShell metacharacters never reaches a shell", async () => {
        const { dispatchNativeNotification } = await import("./universal-ecosystem.ts");
        const payload = 'Alert `$(touch /tmp/pwned)` $(rm -rf ~) "; evil #';
        await dispatchNativeNotification(payload, "body");

        expect(mockExecFile).toHaveBeenCalledTimes(1);
        const [cmd, args] = mockExecFile.mock.calls[0];
        expect(typeof cmd).toBe("string");
        expect(Array.isArray(args)).toBe(true);
        // Never a single pre-built shell command string — that's the whole point of execFile.
        expect(cmd).not.toContain(" ");
      });

      it("passes URI content as argv, never as a shell-interpolated string — a malicious URI can't break out and inject commands", async () => {
        const { openCrossPlatformUri } = await import("./universal-ecosystem.ts");
        const payload = 'https://example.com/x"; rm -rf ~ #';
        await openCrossPlatformUri(payload);

        expect(mockExecFile).toHaveBeenCalledTimes(1);
        const [cmd, args] = mockExecFile.mock.calls[0];
        expect(Array.isArray(args)).toBe(true);
        expect(args).toContain(payload);
        expect(cmd).not.toContain(" ");
      });
    });
  });
});
