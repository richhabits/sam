import { describe, it, expect, vi } from "vitest";

vi.mock("./models.ts", () => ({
  runModel: vi.fn(async () => ({
    text: JSON.stringify({
      title: "Cinematic Test Storyboard",
      narrativeGoal: "High-speed cinematic story arc",
      shots: [
        {
          shotNumber: 1,
          shotType: "Wide Establishing",
          durationSec: 4,
          cameraMoveId: "dolly_out_epic",
          lensId: "anamorphic_panavision",
          action: "Opening wide vista",
          cinematicPrompt: "Anamorphic wide vista with dramatic lighting",
          transitionToNext: "Cut",
        },
        {
          shotNumber: 2,
          shotType: "Medium Shot",
          durationSec: 4,
          cameraMoveId: "steadicam_tracking",
          lensId: "arri_master_prime",
          action: "Dynamic character motion",
          cinematicPrompt: "Medium tracking shot with realistic motion",
          transitionToNext: "Cut",
        },
        {
          shotNumber: 3,
          shotType: "Hero Climax",
          durationSec: 5,
          cameraMoveId: "orbit_360_cw",
          lensId: "imax_70mm_grand",
          action: "Hero climax wrap",
          cinematicPrompt: "Orbital hero wrap with volumetric light",
          transitionToNext: "Cut",
        },
      ],
    }),
    provider: "test",
    tier: "local",
  })),
}));

import {
  HIGGSFIELD_CAMERA_RIGS,
  HIGGSFIELD_LENSES,
  HIGGSFIELD_PHYSICS,
  buildCharacterAnchorPrompt,
  compileHiggsfieldMotionPrompt,
  generateStoryboardDirector,
  type CharacterProfile,
} from "./studio-higgsfield.ts";
import {
  studioHiggsfieldDirectorTool,
  studioMotionControllerTool,
  studioCharacterLockTool,
} from "./tools.ts";

describe("Higgsfield Studio 100x Engine", () => {
  describe("Camera Rigs & 3D Vectors", () => {
    it("exports comprehensive 3D camera trajectory presets", () => {
      expect(HIGGSFIELD_CAMERA_RIGS.length).toBeGreaterThanOrEqual(10);
      for (const rig of HIGGSFIELD_CAMERA_RIGS) {
        expect(rig.id).toBeDefined();
        expect(rig.label).toBeDefined();
        expect(rig.vectors.translation).toHaveLength(3);
        expect(rig.vectors.rotation).toHaveLength(3);
        expect(rig.promptCue.length).toBeGreaterThan(10);
      }
    });

    it("includes signature Higgsfield moves (orbit, vertigo, bullet time, FPV dive)", () => {
      const ids = HIGGSFIELD_CAMERA_RIGS.map(r => r.id);
      expect(ids).toContain("orbit_360_cw");
      expect(ids).toContain("bullet_time_freeze");
      expect(ids).toContain("vertigo_hitchcock");
      expect(ids).toContain("fpv_drone_dive");
    });
  });

  describe("Cinematic Lenses & Physics", () => {
    it("exports anamorphic, prime, and IMAX lens profiles", () => {
      expect(HIGGSFIELD_LENSES.length).toBeGreaterThanOrEqual(4);
      const anamorphic = HIGGSFIELD_LENSES.find(l => l.id === "anamorphic_panavision");
      expect(anamorphic).toBeDefined();
      expect(anamorphic?.aspectRatio).toBe("2.39:1");
      expect(anamorphic?.promptSignature).toContain("Panavision");
    });

    it("exports aerodynamic and fluid physics dynamics", () => {
      expect(HIGGSFIELD_PHYSICS.length).toBeGreaterThanOrEqual(4);
      const cloth = HIGGSFIELD_PHYSICS.find(p => p.id === "cloth_wind_flutter");
      expect(cloth?.promptModifier).toContain("cloth physics");
    });
  });

  describe("SoulID Character Consistency", () => {
    it("builds consistent character anchor prompt with unique tokens", () => {
      const profile: CharacterProfile = {
        characterId: "char_elena",
        name: "Elena Rostova",
        age: 29,
        gender: "female",
        ethnicity: "Eastern European",
        facialFeatures: "high angular cheekbones, small scar on left eyebrow",
        hair: "platinum blonde bob",
        eyes: "striking ice blue",
        signatureClothing: "tailored charcoal trench coat with high collar",
        distinctTokens: ["elena_soul_v1", "rostova_anchor"],
      };

      const prompt = buildCharacterAnchorPrompt(profile);
      expect(prompt).toContain("Elena Rostova");
      expect(prompt).toContain("high angular cheekbones");
      expect(prompt).toContain("platinum blonde bob");
      expect(prompt).toContain("elena_soul_v1");
      expect(prompt).toContain("Maintain exact facial bone structure");
    });
  });

  describe("3D Motion Control Synthesis", () => {
    it("compiles base prompt with camera trajectory, lens signature, and intensity scaling", () => {
      const syn = compileHiggsfieldMotionPrompt({
        basePrompt: "Cyberpunk street samurai leaping across rooftops in rain",
        cameraRigId: "fpv_drone_dive",
        lensId: "anamorphic_panavision",
        physicsId: "particle_fire_embers",
        motionIntensity: 2.0,
      });

      expect(syn.compiledPrompt).toContain("Cyberpunk street samurai");
      expect(syn.compiledPrompt).toContain("FPV drone dive");
      expect(syn.compiledPrompt).toContain("Panavision");
      expect(syn.compiledPrompt).toContain("volumetric fire physics");
      expect(syn.compiledPrompt).toContain("motion intensity: 200%");
      expect(syn.cameraTrajectory.intensity).toBe(2.0);
      expect(syn.negativePrompt).toContain("blurry");
    });
  });

  describe("Multi-Shot Storyboard Director", () => {
    it("generates structured multi-shot storyboard with camera cues", async () => {
      const proj = await generateStoryboardDirector({
        concept: "Neon high-speed car chase through Neo-Tokyo underground tunnel",
        shotCount: 3,
      });

      expect(proj.title).toBeDefined();
      expect(proj.shots.length).toBe(3);
      expect(proj.totalDurationSec).toBeGreaterThan(0);
      expect(proj.shots[0].cameraMoveId).toBeDefined();
      expect(proj.shots[0].lensId).toBeDefined();
      expect(proj.negativePromptScrub).toContain("blurry");
    });
  });

  describe("Higgsfield Tools in TOOLS", () => {
    it("runs studioHiggsfieldDirectorTool", async () => {
      const out = await studioHiggsfieldDirectorTool({
        concept: "Interstellar spaceship entering a black hole event horizon",
        shotCount: 3,
        characterName: "Commander Vance",
      });

      expect(out).toContain("Higgsfield Studio Storyboard");
      expect(out).toContain("Shot 1");
      expect(out).toContain("Camera Rig:");
    });

    it("runs studioMotionControllerTool", async () => {
      const out = await studioMotionControllerTool({
        prompt: "Surfer riding giant bioluminescent wave at night",
        cameraRig: "orbit_360_cw",
        lens: "imax_70mm_grand",
        physics: "fluid_liquid_splash",
        motionIntensity: 1.5,
      });

      expect(out).toContain("Higgsfield 3D Motion Control Synthesis");
      expect(out).toContain("Camera Trajectory");
      expect(out).toContain("Compiled Generation Prompt");
    });

    it("runs studioCharacterLockTool", async () => {
      const out = await studioCharacterLockTool({
        name: "Aria Thorne",
        hair: "crimson red braids",
        eyes: "amber",
      });

      expect(out).toContain("Higgsfield SoulID Character Profile Locked");
      expect(out).toContain("Aria Thorne");
      expect(out).toContain("crimson red braids");
      expect(out).toContain("Character Consistency Prompt Anchor");
    });
  });
});
