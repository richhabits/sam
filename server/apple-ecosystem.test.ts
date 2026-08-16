import { describe, it, expect } from "vitest";
import {
  processWatchPrompt,
  APPLE_APP_INTENTS,
  prepareWatchActionNotification,
} from "./apple-ecosystem.ts";

describe("Apple Multi-Device Ecosystem & Watch Dispatch", () => {
  it("processes zero-token deterministic queries instantly for Watch glance", async () => {
    const res = await processWatchPrompt({
      transcript: "15 * 8",
      sourceDevice: "apple_watch",
    });

    expect(res.isZeroCost).toBe(true);
    expect(res.fullAnswer).toContain("120");
    expect(res.glanceText).toContain("120");
    expect(res.durationMs).toBeGreaterThanOrEqual(1);
  });

  it("exposes Apple AppIntents framework definitions", () => {
    expect(APPLE_APP_INTENTS.length).toBeGreaterThanOrEqual(4);
    const askIntent = APPLE_APP_INTENTS.find((i) => i.intentId === "AskSAMIntent");
    expect(askIntent).toBeDefined();
    expect(askIntent?.supportedDevices).toContain("watchOS");
    expect(askIntent?.supportedDevices).toContain("macOS");
  });

  it("generates glanceable wrist action push notifications", () => {
    const notif = prepareWatchActionNotification({
      title: "Approve Build #41",
      body: "Yard worker wants to run git commit on main",
      category: "APPROVE_TASK",
      actionId: "task_99182",
    });

    expect(notif.notificationId).toBeTruthy();
    expect(notif.apnsPayload.data.wristGlanceable).toBe("true");
    expect(notif.apnsPayload.data.watchCategory).toBe("APPROVE_TASK");
  });
});
