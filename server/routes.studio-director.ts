import type { Express } from "express";
import { generateCinematicStoryboard } from "./studio-director.ts";

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
}
