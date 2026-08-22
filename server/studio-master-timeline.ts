// ─────────────────────────────────────────────────────────────
//  S.A.M. · STUDIO TIMELINE ASSEMBLER
//
//  Assembles storyboard JSON metadata into a sequential list.
// ─────────────────────────────────────────────────────────────

import { generateCinematicStoryboard, type StoryboardShot } from "./studio-director.ts";

export interface ProductionAudioTrack {
  id: string;
  type: "dialogue" | "soundtrack" | "sfx";
  label: string;
  startFrame: number;
  durationFrames: number;
  waveformPattern: string;
}

export interface ProductionShotTrack {
  shotIndex: number;
  name: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  smpteIn: string;
  smpteOut: string;
  cameraRig: string;
  lens: string;
  lightingScheme: string;
  visualPrompt: string;
}

export interface MasterProductionTimeline {
  title: string;
  aspectRatio: string;
  framerateFps: number;
  totalDurationSec: number;
  totalFrames: number;
  smpteDuration: string;
  characterSeedAnchor: string;
  videoShots: ProductionShotTrack[];
  audioTracks: ProductionAudioTrack[];
  edlManifestText: string;
  compiledAt: number;
}

/**
 * Formats frame count into standard SMPTE timecode at 24fps (HH:MM:SS:FF).
 */
export function formatSmpteTimecode(frames: number, fps = 24): string {
  const totalSeconds = Math.floor(frames / fps);
  const ff = frames % fps;
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/**
 * Compiles a cinematic storyboard concept into a full multi-track master production timeline.
 */
export function compileProductionTimeline(input: {
  conceptPrompt: string;
  sceneCount?: number;
  aspectRatio?: "16:9" | "9:16" | "2.39:1" | "1:1";
  customCharacterAnchor?: string;
}): MasterProductionTimeline {
  const storyboard = generateCinematicStoryboard({
    narrativePrompt: input.conceptPrompt,
    sceneCount: input.sceneCount,
    aspectRatio: input.aspectRatio,
  });

  const fps = storyboard.framerateFps;
  const videoShots: ProductionShotTrack[] = [];
  const audioTracks: ProductionAudioTrack[] = [];
  const edlLines: string[] = [
    `TITLE: ${storyboard.title.toUpperCase()}`,
    `FCM: NON-DROP FRAME (24 FPS)`,
    `ASPECT RATIO: ${storyboard.aspectRatio}`,
    ``,
  ];

  let currentFrame = 0;

  for (const shot of storyboard.shots) {
    const shotDurationFrames = Math.round(shot.durationSec * fps);
    const startFrame = currentFrame;
    const endFrame = currentFrame + shotDurationFrames;
    const smpteIn = formatSmpteTimecode(startFrame, fps);
    const smpteOut = formatSmpteTimecode(endFrame, fps);

    videoShots.push({
      shotIndex: shot.shotNumber,
      name: shot.sceneTitle,
      startFrame,
      endFrame,
      durationFrames: shotDurationFrames,
      smpteIn,
      smpteOut,
      cameraRig: shot.cameraRig.label,
      lens: shot.lensOptics,
      lightingScheme: shot.lightingScheme,
      visualPrompt: shot.visualPrompt,
    });

    // Generate dialogue track if voiceover prompt is present
    if (shot.audioCue) {
      audioTracks.push({
        id: `dialogue-shot-${shot.shotNumber}`,
        type: "dialogue",
        label: `VO: "${shot.audioCue.slice(0, 30)}..."`,
        startFrame: startFrame + 12, // 0.5s pre-roll
        durationFrames: Math.max(24, shotDurationFrames - 24),
        waveformPattern: "12,24,45,68,90,75,50,30,15,5",
      });
    }

    // EDL Track format
    const edlIndex = String(shot.shotNumber).padStart(3, "0");
    edlLines.push(
      `${edlIndex}  AX       V     C        ${smpteIn} ${smpteOut} ${smpteIn} ${smpteOut}`
    );
    edlLines.push(`* FROM CLIP NAME: SHOT_${shot.shotNumber}_${shot.sceneTitle.replace(/\s+/g, "_")}`);
    edlLines.push(`* CAMERA RIG: ${shot.cameraRig.label} | LENS: ${shot.lensOptics}`);
    edlLines.push(``);

    currentFrame = endFrame;
  }

  // Add ambient master soundtrack track spanning whole production
  audioTracks.push({
    id: "master-soundtrack",
    type: "soundtrack",
    label: `Cinematic Score [Synthwave Atmosphere]`,
    startFrame: 0,
    durationFrames: currentFrame,
    waveformPattern: "8,14,22,35,48,62,75,88,95,82,65,48,32,18,10,5",
  });

  const totalFrames = currentFrame;
  const totalDurationSec = Math.round((totalFrames / fps) * 10) / 10;
  const smpteDuration = formatSmpteTimecode(totalFrames, fps);

  return {
    title: storyboard.title,
    aspectRatio: storyboard.aspectRatio,
    framerateFps: fps,
    totalDurationSec,
    totalFrames,
    smpteDuration,
    characterSeedAnchor: input.customCharacterAnchor || storyboard.characterSeedAnchor,
    videoShots,
    audioTracks,
    edlManifestText: edlLines.join("\n"),
    compiledAt: Date.now(),
  };
}
