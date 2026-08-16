import { describe, it, expect } from "vitest";
import {
  generateSmartStudioPreset,
  buildSimpleFlipItSummary,
  executeSmartAction,
} from "./smart-actions.ts";
import {
  smartQuickActionTool,
  smartStudioPresetTool,
  smartFlipitSummaryTool,
} from "./tools.ts";

describe("Smart Actions & Maximum UX Suite", () => {
  describe("generateSmartStudioPreset", () => {
    it("generates instant Higgsfield cinematic preset with auto-matched rig and lens", () => {
      const res = generateSmartStudioPreset("Dragon soaring over volcanic fortress", "action");
      expect(res.concept).toContain("Dragon");
      expect(res.enhancedPrompt).toContain("FPV drone dive");
      expect(res.enhancedPrompt).toContain("Arri");
      expect(res.recommendedCameraRig).toBe("fpv_drone_dive");
      expect(res.readyToGenerate).toBe(true);
    });

    it("defaults gracefully to cinematic mood", () => {
      const res = generateSmartStudioPreset("Serene mountain lake at dawn");
      expect(res.recommendedLens).toBe("imax_70mm_grand");
      expect(res.aspectRatio).toBe("2.39:1");
    });
  });

  describe("buildSimpleFlipItSummary", () => {
    it("constructs a clean novice-friendly financial glance card", () => {
      const card = buildSimpleFlipItSummary();
      expect(card.currentEquity).toContain("£");
      expect(card.rungStatus).toContain("Rung");
      expect(card.ladderProgressPct).toBeGreaterThanOrEqual(0);
      expect(card.ladderProgressPct).toBeLessThanOrEqual(100);
      expect(card.safePositionSize).toContain("£");
      expect(card.actionAdvice.length).toBeGreaterThan(10);
    });
  });

  describe("executeSmartAction Intent Dispatcher", () => {
    it("routes creative/video prompts to Studio action", async () => {
      const act = await executeSmartAction("Make a 4k cinematic video of a spaceship landing");
      expect(act.category).toBe("STUDIO");
      expect(act.title).toContain("Studio 1-Click Director");
      expect(act.details.length).toBeGreaterThanOrEqual(2);
    });

    it("routes investment/money prompts to FlipIt action", async () => {
      const act = await executeSmartAction("How is my money ladder and investment doing?");
      expect(act.category).toBe("INVESTMENT");
      expect(act.title).toContain("FlipIt Investment");
      expect(act.details.some(d => d.includes("Safe Sizing"))).toBe(true);
    });

    it("routes general/system prompts to System Health Autopilot", async () => {
      const act = await executeSmartAction("Check system status and cleanup");
      expect(act.category).toBe("SYSTEM");
      expect(act.title).toContain("SAM System Health");
    });
  });

  describe("Smart UX Tools in TOOLS", () => {
    it("runs smartQuickActionTool", async () => {
      const out = await smartQuickActionTool({ intent: "Create an anime video" });
      expect(out).toContain("Studio 1-Click Director Action");
      expect(out).toContain("Enhanced Prompt");
    });

    it("runs smartStudioPresetTool", async () => {
      const out = await smartStudioPresetTool({ concept: "Cyberpunk neon car", mood: "moody" });
      expect(out).toContain("Higgsfield 1-Click Studio Preset");
      expect(out).toContain("Recommended Camera:");
    });

    it("runs smartFlipitSummaryTool", async () => {
      const out = await smartFlipitSummaryTool();
      expect(out).toContain("FlipIt Quick Glance Summary");
      expect(out).toContain("Current Balance:");
      expect(out).toContain("Safe Position Size:");
    });
  });
});
