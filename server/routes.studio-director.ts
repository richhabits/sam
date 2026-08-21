import type { Express } from "express";
import { generateCinematicStoryboard } from "./studio-director.ts";
import { compileProductionTimeline } from "./studio-master-timeline.ts";

export function registerStudioDirectorRoutes(app: Express) {
  app.post("/api/studio/director/storyboard", (req, res) => {
    try {
      const { narrativePrompt, sceneCount, aspectRatio, framerateFps } = req.body || {};
      if (!narrativePrompt) {
        return res.status(400).json({ error: "narrativePrompt is required." });
      }

      const plan = generateCinematicStoryboard({
        narrativePrompt,
        sceneCount: sceneCount ? Number(sceneCount) : undefined,
        aspectRatio,
        framerateFps: framerateFps ? Number(framerateFps) as any : undefined,
      });

      res.json(plan);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to generate cinematic storyboard" });
    }
  });

  app.post("/api/studio/timeline/compile", (req, res) => {
    try {
      const { conceptPrompt, sceneCount, aspectRatio, customCharacterAnchor } = req.body || {};
      if (!conceptPrompt) {
        return res.status(400).json({ error: "conceptPrompt is required." });
      }

      const timeline = compileProductionTimeline({
        conceptPrompt,
        sceneCount: sceneCount ? Number(sceneCount) : undefined,
        aspectRatio,
        customCharacterAnchor,
      });

      res.json({
        success: true,
        timeline,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to compile production timeline" });
    }
  });
}

