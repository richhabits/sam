// ─────────────────────────────────────────────────────────────
//  S.A.M. · STUDIO STORYBOARD ENGINE
//
//  Builds JSON metadata for storyboards with camera vector rigs,
//  lighting palettes, consistent character seeds, and SMPTE frame timing.
// ─────────────────────────────────────────────────────────────

import { HIGGSFIELD_CAMERA_RIGS, type CameraMove } from "./studio-higgsfield.ts";

export interface StoryboardShot {
  shotNumber: number;
  durationSec: number;
  startFrame: number;
  endFrame: number;
  cameraRig: CameraMove;
  sceneTitle: string;
  visualPrompt: string;
  lightingScheme: "GOLDEN_HOUR" | "CYBERPUNK_NEON" | "VOLUMETRIC_NOIR" | "STUDIO_KEY_FILL" | "OVERCAST_DIFFUSE";
  lensOptics: "35MM_ANAMORPHIC" | "50MM_PRIME_F1.2" | "85MM_PORTRAIT" | "16MM_ULTRA_WIDE";
  audioCue: string;
}

export interface CinematicDirectorPlan {
  title: string;
  theme: string;
  aspectRatio: "16:9" | "9:16" | "2.39:1" | "1:1";
  framerateFps: 24 | 30 | 60;
  totalDurationSec: number;
  totalFrames: number;
  characterSeedAnchor: string;
  shots: StoryboardShot[];
}

export function generateCinematicStoryboard(params: {
  narrativePrompt: string;
  sceneCount?: number;
  aspectRatio?: "16:9" | "9:16" | "2.39:1" | "1:1";
  framerateFps?: 24 | 30 | 60;
}): CinematicDirectorPlan {
  const scenes = Math.min(8, Math.max(3, params.sceneCount ?? 4));
  const fps = params.framerateFps ?? 24;
  const ratio = params.aspectRatio ?? "16:9";
  const prompt = String(params.narrativePrompt || "Cinematic Epic Narrative").trim();

  const rigs = HIGGSFIELD_CAMERA_RIGS;
  const lightings: StoryboardShot["lightingScheme"][] = [
    "GOLDEN_HOUR",
    "CYBERPUNK_NEON",
    "VOLUMETRIC_NOIR",
    "STUDIO_KEY_FILL",
    "OVERCAST_DIFFUSE",
  ];
  const lenses: StoryboardShot["lensOptics"][] = [
    "35MM_ANAMORPHIC",
    "50MM_PRIME_F1.2",
    "85MM_PORTRAIT",
    "16MM_ULTRA_WIDE",
  ];

  const shots: StoryboardShot[] = [];
  let currentFrame = 0;
  const shotDurationSec = 4; // 4 seconds per shot

  for (let i = 0; i < scenes; i++) {
    const rig = rigs[i % rigs.length];
    const lighting = lightings[i % lightings.length];
    const lens = lenses[i % lenses.length];
    const startFrame = currentFrame;
    const endFrame = startFrame + (shotDurationSec * fps);
    currentFrame = endFrame;

    shots.push({
      shotNumber: i + 1,
      durationSec: shotDurationSec,
      startFrame,
      endFrame,
      cameraRig: rig,
      sceneTitle: `Scene ${i + 1}: ${prompt.slice(0, 30)}... [${rig.label}]`,
      visualPrompt: `${prompt}, ${rig.promptCue}, ${lighting.toLowerCase().replace(/_/g, " ")}, shot on ${lens.toLowerCase().replace(/_/g, " ")}, photorealistic 8K render`,
      lightingScheme: lighting,
      lensOptics: lens,
      audioCue: i === 0 ? "Opening ambient crescendo and cinematic sub-bass hit" : `Orchestral transition tempo at frame ${startFrame}`,
    });
  }

  const totalDuration = scenes * shotDurationSec;

  return {
    title: `Director's Cut: ${prompt.slice(0, 40)}`,
    theme: prompt,
    aspectRatio: ratio,
    framerateFps: fps,
    totalDurationSec: totalDuration,
    totalFrames: currentFrame,
    characterSeedAnchor: `soul_anchor_${Math.abs(prompt.split("").reduce((acc, c) => (acc << 5) - acc + c.charCodeAt(0), 0))}`,
    shots,
  };
}
