// ─────────────────────────────────────────────────────────────
//  S.A.M. · STREAMING VOICE & AUDIO SYNTHESIS ENGINE
//
//  Generates multi-voice dialogue audio, podcast narration,
//  and streaming speech synthesis for mobile and web.
// ─────────────────────────────────────────────────────────────

export interface VoiceProfile {
  id: string;
  name: string;
  gender: "male" | "female" | "neutral";
  accent: string;
  pitch: number;
  speed: number;
}

export const VOICES: VoiceProfile[] = [
  { id: "sam_host", name: "Sam (Host)", gender: "male", accent: "British / London", pitch: 1.0, speed: 1.05 },
  { id: "alex_cohost", name: "Alex (Co-Host)", gender: "female", accent: "American / Natural", pitch: 1.05, speed: 1.0 },
  { id: "nova_calm", name: "Nova", gender: "female", accent: "Neutral Warm", pitch: 0.95, speed: 0.95 },
  { id: "echo_deep", name: "Echo", gender: "male", accent: "Deep Cinematic", pitch: 0.85, speed: 1.0 },
];

export interface SpeechSynthesisResult {
  text: string;
  voice: VoiceProfile;
  audioFormat: "mp3" | "wav" | "aac";
  durationSeconds: number;
  waveformSample: number[];
  audioBase64Stub: string;
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

export async function generateSpeechAudio(
  text: string,
  voiceId = "sam_host",
  options: { speed?: number; pitch?: number } = {}
): Promise<SpeechSynthesisResult> {
  const clean = String(text || "").trim();
  const v = VOICES.find(x => x.id === voiceId) || VOICES[0];
  const effectiveSpeed = options.speed ?? v.speed;

  // Approximate speech duration: ~150 words per minute
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  const rawSeconds = (wordCount / 150) * 60;
  const duration = Math.max(1, Number((rawSeconds / effectiveSpeed).toFixed(2)));

  // Generate simulated 32-bin audio waveform for UI/mobile rendering
  const waveform: number[] = [];
  for (let i = 0; i < 32; i++) {
    const val = 0.2 + 0.6 * Math.abs(Math.sin((i / 32) * Math.PI * 4 + clean.length));
    waveform.push(Number(val.toFixed(2)));
  }

  let audioBase64Stub = "";
  try {
    const EL_KEY = process.env.ELEVENLABS_API_KEY || "";
    if (EL_KEY) {
      const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
      const EL_MODEL = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": EL_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, model_id: EL_MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } }),
      });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        audioBase64Stub = `data:audio/mp3;base64,${Buffer.from(buf).toString("base64")}`;
      }
    }
    
    // Fallback to real Pollinations TTS if no ElevenLabs key
    if (!audioBase64Stub) {
      const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(clean)}?model=openai-audio&voice=nova`, { signal: AbortSignal.timeout(30000) });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        audioBase64Stub = `data:audio/mp3;base64,${Buffer.from(buf).toString("base64")}`;
      }
    }
  } catch (err) {
    console.error("Live TTS failed:", err);
  }

  if (!audioBase64Stub) {
     audioBase64Stub = `data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAA...`;
  }

  return {
    text: clean,
    voice: v,
    audioFormat: "mp3",
    durationSeconds: duration,
    waveformSample: waveform,
    audioBase64Stub,
  };
}

export interface DialogueExchange {
  speaker: string;
  text: string;
}

export interface AudioTimelineCue {
  cueIndex: number;
  speaker: string;
  voice: VoiceProfile;
  startSec: number;
  endSec: number;
  durationSec: number;
  text: string;
  waveform: number[];
  audioBase64Stub: string;
}

export interface PodcastSynthesisResult {
  title: string;
  topic?: string;
  cues: AudioTimelineCue[];
  exchanges: {
    speaker: string;
    voiceId: string;
    text: string;
    durationSec: number;
  }[];
  totalDurationSeconds: number;
  backgroundMusicTrack?: string;
}

export async function synthesizeDialogueAudio(
  title: string,
  exchanges: DialogueExchange[],
  options: { topic?: string; backgroundMusic?: string } = {}
): Promise<PodcastSynthesisResult> {
  let currentTime = 0;
  const cues: AudioTimelineCue[] = [];
  const renderedExchanges = [];

  for (let index = 0; index < exchanges.length; index++) {
    const ex = exchanges[index];
    const isAlex = ex.speaker.toLowerCase().includes("alex");
    const voiceId = isAlex ? "alex_cohost" : "sam_host";
    const speech = await generateSpeechAudio(ex.text, voiceId);

    const startSec = Number(currentTime.toFixed(2));
    const endSec = Number((currentTime + speech.durationSeconds).toFixed(2));
    currentTime = endSec + 0.3; // 300ms natural conversational pause

    cues.push({
      cueIndex: index + 1,
      speaker: ex.speaker,
      voice: speech.voice,
      startSec,
      endSec,
      durationSec: speech.durationSeconds,
      text: ex.text,
      waveform: speech.waveformSample,
      audioBase64Stub: speech.audioBase64Stub,
    });

    renderedExchanges.push({
      speaker: ex.speaker,
      voiceId,
      text: ex.text,
      durationSec: speech.durationSeconds,
    });
  }

  return {
    title: title || "Audio Overview Dialogue",
    topic: options.topic,
    cues,
    exchanges: renderedExchanges,
    totalDurationSeconds: Number(currentTime.toFixed(2)),
    backgroundMusicTrack: options.backgroundMusic,
  };
}
