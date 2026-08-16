import { describe, it, expect } from "vitest";
import { generateCinematicStoryboard } from "./studio-director.ts";
import { studioDirectorStoryboardTool } from "./tools.ts";

describe("Studio Autonomous AI Director & Multi-Track Storyboard", () => {
  it("generates multi-shot storyboard with frame timing and camera rigs", () => {
    const plan = generateCinematicStoryboard({
      narrativePrompt: "Cyberpunk rooftop duel in Tokyo rain",
      sceneCount: 4,
      aspectRatio: "2.39:1",
      framerateFps: 24,
    });

    expect(plan.title).toContain("Cyberpunk");
    expect(plan.aspectRatio).toBe("2.39:1");
    expect(plan.framerateFps).toBe(24);
    expect(plan.shots.length).toBe(4);
    expect(plan.totalDurationSec).toBe(16);
    expect(plan.totalFrames).toBe(16 * 24);
    expect(plan.characterSeedAnchor).toBeTruthy();

    // Verify shot progression
    expect(plan.shots[0].startFrame).toBe(0);
    expect(plan.shots[0].endFrame).toBe(96);
    expect(plan.shots[1].startFrame).toBe(96);
    expect(plan.shots[1].endFrame).toBe(192);
  });

  it("studioDirectorStoryboardTool outputs formatted production storyboard", async () => {
    const out = await studioDirectorStoryboardTool({ prompt: "Futuristic spaceship launch sequence" });
    expect(out).toContain("Cinematic Storyboard Director's Plan");
    expect(out).toContain("Total Shots:");
    expect(out).toContain("Shot 1");
  });
});
