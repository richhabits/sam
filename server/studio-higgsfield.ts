// ─────────────────────────────────────────────────────────────
//  S.A.M. · HIGGSFIELD STUDIO ENGINE
//
//  Data structures for camera trajectory vectors and API client,
//  multi-shot storyboard sequencing, SoulID consistent character
//  anchoring, physics motion simulation, and cinematic lens optics.
// ─────────────────────────────────────────────────────────────

import { runModel } from "./models.ts";

export interface CameraMove {
  id: string;
  label: string;
  category: "orbit" | "dolly" | "crane" | "pan_tilt" | "dynamic" | "cinematic";
  description: string;
  vectors: {
    translation: [number, number, number]; // [dx, dy, dz]
    rotation: [number, number, number];    // [pitch/rx, yaw/ry, roll/rz]
    zoomSpeed: number;
  };
  promptCue: string;
}

export const HIGGSFIELD_CAMERA_RIGS: CameraMove[] = [
  // ── Orbit & Wrap Moves ──
  {
    id: "orbit_360_cw",
    label: "360° Clockwise Orbit",
    category: "orbit",
    description: "Smooth 360-degree seamless circular sweep around subject clockwise",
    vectors: { translation: [0, 0, 0], rotation: [0, 1.0, 0], zoomSpeed: 0 },
    promptCue: "360-degree seamless orbital wrap clockwise around subject, continuous smooth circular tracking, parallax background separation",
  },
  {
    id: "orbit_360_ccw",
    label: "360° Counter-Clockwise Orbit",
    category: "orbit",
    description: "Smooth 360-degree seamless circular sweep around subject counter-clockwise",
    vectors: { translation: [0, 0, 0], rotation: [0, -1.0, 0], zoomSpeed: 0 },
    promptCue: "360-degree seamless orbital wrap counter-clockwise around subject, continuous circular tracking, dynamic parallax",
  },
  {
    id: "bullet_time_freeze",
    label: "Matrix Bullet Time",
    category: "orbit",
    description: "Frozen-time ultra-slow motion circular camera rotation",
    vectors: { translation: [0, 0, 0], rotation: [0, 1.5, 0], zoomSpeed: 0 },
    promptCue: "Matrix bullet-time frozen moment, 1000fps ultra slow motion, rapid 3D orbital camera curve around frozen action, suspended airborne particles",
  },

  // ── Dolly & Push/Pull ──
  {
    id: "dolly_in_rapid",
    label: "Rapid Dolly Push-In",
    category: "dolly",
    description: "High-speed cinematic push forward straight into subject's eyes",
    vectors: { translation: [0, 0, 1.0], rotation: [0, 0, 0], zoomSpeed: 1.2 },
    promptCue: "Fast cinematic dolly push-in toward subject, shallow depth of field intensifying, background rushing past in creamy bokeh",
  },
  {
    id: "dolly_out_epic",
    label: "Epic Dolly Pull-Out",
    category: "dolly",
    description: "Slow dramatic pull-back revealing monumental scale and vast surroundings",
    vectors: { translation: [0, 0, -1.0], rotation: [0, 0, 0], zoomSpeed: -1.0 },
    promptCue: "Slow grand cinematic dolly pull-out, revealing colossal environment, monumental scale, breathtaking wide perspective",
  },
  {
    id: "vertigo_hitchcock",
    label: "Hitchcock Vertigo Zoom",
    category: "dolly",
    description: "Simultaneous dolly-in and optical zoom-out distorting background perspective",
    vectors: { translation: [0, 0, 1.0], rotation: [0, 0, 0], zoomSpeed: -1.0 },
    promptCue: "Vertigo effect, Hitchcock zolly zoom, foreground remains fixed scale while background perspective warps and stretches dramatically",
  },

  // ── Crane, Jib & Aerial ──
  {
    id: "crane_pedestal_up",
    label: "Hero Crane Rise",
    category: "crane",
    description: "Sweeping vertical pedestal crane lift from ground level to soaring height",
    vectors: { translation: [0, 1.0, 0], rotation: [-0.3, 0, 0], zoomSpeed: 0 },
    promptCue: "Vertical crane pedestal ascent, camera swoops upward from ground level tilting down at heroic angle, sweeping majestic reveal",
  },
  {
    id: "fpv_drone_dive",
    label: "FPV Acrobatic Drone Dive",
    category: "dynamic",
    description: "Aggressive high-speed FPV dive through tight architectural spaces",
    vectors: { translation: [0.5, -1.0, 1.5], rotation: [-0.6, 0.4, 0.5], zoomSpeed: 1.5 },
    promptCue: "Acrobatic FPV drone dive, extreme high speed, banking sharp turns, proximity flyby with intense dynamic motion blur and kinetic energy",
  },
  {
    id: "whip_pan_transition",
    label: "Kinetic Whip Pan",
    category: "dynamic",
    description: "Rapid motion-blurred horizontal camera snap",
    vectors: { translation: [1.0, 0, 0], rotation: [0, 2.0, 0], zoomSpeed: 0 },
    promptCue: "Kinetic whip pan snap, extreme horizontal motion blur, rapid perspective transition, high velocity dynamic shift",
  },
  {
    id: "steadicam_tracking",
    label: "Steadicam Follow",
    category: "cinematic",
    description: "Fluid continuous steadicam tracking alongside or following subject",
    vectors: { translation: [0, 0, 0.8], rotation: [0, 0, 0], zoomSpeed: 0 },
    promptCue: "Silky smooth steadicam tracking shot, fluid continuous movement following subject, cinematic organic glide, perfectly balanced framing",
  },
  {
    id: "macro_slider_glide",
    label: "Macro Texture Glide",
    category: "cinematic",
    description: "Microscopic probe lens gliding across intricate surface textures",
    vectors: { translation: [0.2, 0, 0.4], rotation: [0, 0, 0], zoomSpeed: 0.5 },
    promptCue: "Laowa macro probe lens ultra close-up glide, razor-thin focal plane, microscopic surface details and reflections, extreme texture fidelity",
  },
  {
    id: "dutch_roll_tension",
    label: "Dutch Angle Roll",
    category: "pan_tilt",
    description: "Dramatic tilted roll axis creating suspense and psychological tension",
    vectors: { translation: [0, 0, 0.2], rotation: [0, 0, 0.4], zoomSpeed: 0 },
    promptCue: "Dramatic 30-degree Dutch angle tilt with slow clockwise roll, heavy psychological tension, expressive cinematic canting",
  },
];

export interface LensProfile {
  id: string;
  name: string;
  focalLength: string;
  aperture: string;
  aspectRatio: string;
  characteristics: string;
  promptSignature: string;
}

export const HIGGSFIELD_LENSES: LensProfile[] = [
  {
    id: "anamorphic_panavision",
    name: "Panavision C-Series Anamorphic",
    focalLength: "40mm Anamorphic",
    aperture: "T2.0",
    aspectRatio: "2.39:1",
    characteristics: "Horizontal blue/cyan streak flares, oval bokeh, vintage barrel distortion",
    promptSignature: "shot on Panavision C-Series 40mm Anamorphic lens, 2.39:1 widescreen, subtle cyan streak flares, creamy oval bokeh, cinematic filmic depth",
  },
  {
    id: "arri_master_prime",
    name: "Arri / Zeiss Master Prime 50mm",
    focalLength: "50mm Prime",
    aperture: "f/1.3",
    aspectRatio: "16:9",
    characteristics: "Razor sharpness, neutral color reproduction, pristine glass, cinematic rendering",
    promptSignature: "shot on Arri Alexa 35 with Zeiss Master Prime 50mm at f/1.3, tack-sharp subject isolation, natural skin texture micro-contrast, Hollywood master cinematography",
  },
  {
    id: "imax_70mm_grand",
    name: "IMAX 15/70mm Film Stock",
    focalLength: "65mm Large Format",
    aperture: "f/2.8",
    aspectRatio: "1.43:1",
    characteristics: "Unprecedented resolution, massive dynamic range, organic grain structure",
    promptSignature: "shot on IMAX 70mm 15-perf film stock, Christopher Nolan visual scale, unmatched hyper-fine detail, deep dynamic range, authentic fine Kodak film grain",
  },
  {
    id: "portrait_85mm_bokeh",
    name: "Canon 85mm f/1.2 L II USM",
    focalLength: "85mm Portrait",
    aperture: "f/1.2",
    aspectRatio: "4:5",
    characteristics: "Dreamy ethereal background melt, ultra-flattering facial compression",
    promptSignature: "shot on 85mm f/1.2 lens wide open, dreamy creamy background bokeh melt, razor sharp eyelash detail, flattering facial compression, soft studio lighting",
  },
  {
    id: "vintage_super_8",
    name: "Kodak Super 8mm Ektachrome",
    focalLength: "12mm Vintage Zoom",
    aperture: "f/1.8",
    aspectRatio: "4:3",
    characteristics: "Nostalgic warm color bleed, subtle gate weave, retro light leaks",
    promptSignature: "authentic vintage Kodak Super 8mm film, warm nostalgic color tones, gentle gate weave, subtle retro light leaks, 1970s indie aesthetic",
  },
];

export interface PhysicsPreset {
  id: string;
  name: string;
  physicsDescription: string;
  promptModifier: string;
}

export const HIGGSFIELD_PHYSICS: PhysicsPreset[] = [
  {
    id: "cloth_wind_flutter",
    name: "Dynamic Cloth & Wind Simulation",
    physicsDescription: "Aerodynamic turbulent wind forces acting on fabrics and garments",
    promptModifier: "realistic aerodynamic cloth physics, silk fabric billowing and rippling in turbulent gale wind, dynamic folds and micro-wrinkle flutter",
  },
  {
    id: "fluid_liquid_splash",
    name: "Fluid Dynamics & Liquid Splashes",
    physicsDescription: "Navier-Stokes fluid viscosity, droplet collision, and surface tension",
    promptModifier: "high-speed fluid dynamics simulation, crystal-clear water droplet splashes, surface tension refraction, liquid vortex swirling in slow motion",
  },
  {
    id: "particle_fire_embers",
    name: "Explosive Volumetric Embers",
    physicsDescription: "Thermodynamic heat buoyancy, ash dispersion, and illuminated particle sparks",
    promptModifier: "volumetric fire physics, glowing orange embers floating upward with heat convection, turbulent smoke plumes, dynamic fiery illumination",
  },
  {
    id: "zero_g_float",
    name: "Zero-Gravity Orbital Drift",
    physicsDescription: "Weightless inertia, floating hair/debris, and rotational physics",
    promptModifier: "zero-gravity physics simulation, hair and delicate debris floating weightlessly, gentle rotational inertia, space station orbital drift",
  },
];

// ── CHARACTER CONSISTENCY & SOULID MATRIX ──

export interface CharacterProfile {
  characterId: string;
  name: string;
  age: number | string;
  gender: string;
  ethnicity: string;
  facialFeatures: string;
  hair: string;
  eyes: string;
  signatureClothing: string;
  distinctTokens: string[];
}

export function buildCharacterAnchorPrompt(char: CharacterProfile): string {
  const tokens = char.distinctTokens && char.distinctTokens.length > 0
    ? `[Anchor tokens: ${char.distinctTokens.join(", ")}]`
    : "";
  return `Consistent character identity: ${char.name}, a ${char.age} ${char.ethnicity} ${char.gender}, ${char.facialFeatures}, ${char.hair}, ${char.eyes} eyes, wearing ${char.signatureClothing}. Maintain exact facial bone structure, skin tone, and features across all frames without drift. ${tokens}`.trim();
}

// ── MULTI-SHOT STORYBOARD DIRECTOR ──

export interface StoryboardShot {
  shotNumber: number;
  shotType: "Extreme Wide" | "Wide Establishing" | "Medium Shot" | "Over the Shoulder" | "Close-Up" | "Extreme Close-Up" | "Hero Climax";
  durationSec: number;
  cameraMoveId: string;
  lensId: string;
  action: string;
  cinematicPrompt: string;
  transitionToNext: "Cut" | "Dissolve" | "Whip Pan" | "Match Cut" | "Morph";
}

export interface StoryboardProject {
  title: string;
  narrativeGoal: string;
  characterProfile?: CharacterProfile;
  totalDurationSec: number;
  shots: StoryboardShot[];
  negativePromptScrub: string;
}

export async function generateStoryboardDirector(input: {
  concept: string;
  shotCount?: number;
  style?: string;
  character?: CharacterProfile;
  localOnly?: boolean;
}): Promise<StoryboardProject> {
  const count = Math.min(Math.max(2, input.shotCount || 4), 8);
  const style = input.style || "Cinematic Hollywood Film";
  const charPrompt = input.character ? buildCharacterAnchorPrompt(input.character) : "";

  const system = `You are an elite Hollywood Director and Higgsfield AI Cinematographer.
Decompose the user's concept into an exact ${count}-shot cinematic storyboard.
Return ONLY valid JSON matching this schema:
{
  "title": "Short title",
  "narrativeGoal": "Summary of visual story arc",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "Wide Establishing | Medium Shot | Close-Up | Hero Climax",
      "durationSec": 4,
      "cameraMoveId": "dolly_in_rapid | orbit_360_cw | fpv_drone_dive | crane_pedestal_up | steadicam_tracking | vertigo_hitchcock",
      "lensId": "anamorphic_panavision | arri_master_prime | imax_70mm_grand | portrait_85mm_bokeh",
      "action": "Description of what happens",
      "cinematicPrompt": "Full vivid prompt formatted for Higgsfield AI video generation with subject, lighting, lens, and camera motion cues",
      "transitionToNext": "Cut | Dissolve | Whip Pan | Match Cut"
    }
  ]
}`;

  const prompt = `Concept: "${input.concept}"\nVisual Style: ${style}\n${charPrompt ? `Character Anchor: ${charPrompt}` : ""}\nGenerate ${count} shots:`;

  try {
    const modelTier = input.localOnly ? "local" : "free";
    const res = await runModel(modelTier, system, prompt);
    const jsonText = (res.text || "").replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(jsonText);

    const shots: StoryboardShot[] = (parsed.shots || []).map((s: any, idx: number) => ({
      shotNumber: s.shotNumber || idx + 1,
      shotType: s.shotType || (idx === 0 ? "Wide Establishing" : idx === count - 1 ? "Hero Climax" : "Medium Shot"),
      durationSec: Number(s.durationSec) || 4,
      cameraMoveId: s.cameraMoveId || "steadicam_tracking",
      lensId: s.lensId || "anamorphic_panavision",
      action: s.action || "Dynamic action unfold",
      cinematicPrompt: s.cinematicPrompt || input.concept,
      transitionToNext: s.transitionToNext || (idx === count - 1 ? "Cut" : "Cut"),
    }));

    const totalDurationSec = shots.reduce((sum, s) => sum + s.durationSec, 0);

    return {
      title: parsed.title || "Cinematic Storyboard",
      narrativeGoal: parsed.narrativeGoal || input.concept,
      characterProfile: input.character,
      totalDurationSec,
      shots,
      negativePromptScrub: "blurry, deformed, bad anatomy, low quality, jitter, flicker, frame drop, duplicate limbs, distorted face, watermark, text overlay",
    };
  } catch {
    // Fallback deterministic storyboard
    const fallbackShots: StoryboardShot[] = [
      {
        shotNumber: 1,
        shotType: "Wide Establishing",
        durationSec: 4,
        cameraMoveId: "dolly_out_epic",
        lensId: "anamorphic_panavision",
        action: `Establishing wide view for "${input.concept}"`,
        cinematicPrompt: `${input.concept}, wide establishing shot, anamorphic 2.39:1 widescreen, golden hour dramatic rim light, epic scale`,
        transitionToNext: "Cut",
      },
      {
        shotNumber: 2,
        shotType: "Medium Shot",
        durationSec: 4,
        cameraMoveId: "steadicam_tracking",
        lensId: "arri_master_prime",
        action: `Character interaction and movement`,
        cinematicPrompt: `${input.concept}, medium tracking shot, Arri Alexa 35, Zeiss 50mm, steady cinematic motion`,
        transitionToNext: "Cut",
      },
      {
        shotNumber: 3,
        shotType: "Hero Climax",
        durationSec: 5,
        cameraMoveId: "orbit_360_cw",
        lensId: "imax_70mm_grand",
        action: `Climactic hero moment`,
        cinematicPrompt: `${input.concept}, dramatic hero climax, 360-degree orbital sweep, IMAX 70mm, volumetric god rays and floating particles`,
        transitionToNext: "Cut",
      },
    ];

    return {
      title: "Cinematic Storyboard",
      narrativeGoal: input.concept,
      characterProfile: input.character,
      totalDurationSec: 13,
      shots: fallbackShots,
      negativePromptScrub: "blurry, deformed, bad anatomy, jitter, flicker, low resolution",
    };
  }
}

// ── 3D MOTION CONTROL SYNTHESIZER ──

export interface MotionControlRequest {
  basePrompt: string;
  cameraRigId?: string;
  lensId?: string;
  physicsId?: string;
  motionIntensity?: number; // 0.1 to 5.0 (default: 1.0)
  aspectRatio?: "16:9" | "9:16" | "1:1" | "2.39:1" | "4:5";
  characterProfile?: CharacterProfile;
  seed?: number;
}

export interface MotionControlSynthesis {
  compiledPrompt: string;
  negativePrompt: string;
  aspectRatio: string;
  cameraTrajectory: {
    rig: string;
    translation: [number, number, number];
    rotation: [number, number, number];
    intensity: number;
  };
  lensSignature: string;
  physicsCues: string;
  seed: number;
}

export function compileHiggsfieldMotionPrompt(req: MotionControlRequest): MotionControlSynthesis {
  const rig = HIGGSFIELD_CAMERA_RIGS.find(r => r.id === req.cameraRigId) || HIGGSFIELD_CAMERA_RIGS[0];
  const lens = HIGGSFIELD_LENSES.find(l => l.id === req.lensId) || HIGGSFIELD_LENSES[0];
  const physics = HIGGSFIELD_PHYSICS.find(p => p.id === req.physicsId);
  const intensity = Math.min(Math.max(0.1, req.motionIntensity || 1.0), 5.0);
  const aspect = req.aspectRatio || (lens.aspectRatio as any) || "16:9";
  const seed = req.seed ?? Math.floor(Math.random() * 1_000_000);

  const parts: string[] = [req.basePrompt.trim()];

  if (req.characterProfile) {
    parts.push(buildCharacterAnchorPrompt(req.characterProfile));
  }

  parts.push(rig.promptCue);
  parts.push(lens.promptSignature);

  if (physics) {
    parts.push(physics.promptModifier);
  }

  if (intensity !== 1.0) {
    parts.push(`dynamic motion intensity: ${(intensity * 100).toFixed(0)}%`);
  }

  return {
    compiledPrompt: parts.join(". ").replace(/\.\./g, "."),
    negativePrompt: "blurry, out of focus, distorted anatomy, jitter, strobing, deformed face, unnatural motion, plastic skin, low bitrate, watermark",
    aspectRatio: aspect,
    cameraTrajectory: {
      rig: rig.id,
      translation: [
        rig.vectors.translation[0] * intensity,
        rig.vectors.translation[1] * intensity,
        rig.vectors.translation[2] * intensity,
      ],
      rotation: [
        rig.vectors.rotation[0] * intensity,
        rig.vectors.rotation[1] * intensity,
        rig.vectors.rotation[2] * intensity,
      ],
      intensity,
    },
    lensSignature: lens.name,
    physicsCues: physics?.name || "Standard Cinematic Physics",
    seed,
  };
}
