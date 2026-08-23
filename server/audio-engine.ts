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

  let audioBase64Stub = `data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAA...`;

  if (process.platform === "darwin") {
    try {
      const tempId = `say_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const outPath = join(tmpdir(), `${tempId}.m4a`);
      
      // Map voices to local macOS voices
      let localVoice = "Daniel";
      if (voiceId === "alex_cohost") localVoice = "Samantha";
      if (voiceId === "nova_calm") localVoice = "Serena";
      if (voiceId === "echo_deep") localVoice = "Alex";

      // execFile with an argument array, not exec with an interpolated string: `clean` can
      // contain attacker-controlled text (this runs from an agent tool call, reachable from
      // whatever the agent just read off the web/an email), and no amount of quote-escaping
      // stops shell metacharacters like $(...) or backticks from being interpreted inside a
      // shell string. Passing args directly bypasses the shell, so there's nothing to escape.
      await execFileAsync("say", ["-v", localVoice, clean, "-o", outPath, "--data-format=aac"]);
      const audioBuffer = await readFile(outPath);
      audioBase64Stub = `data:audio/mp4;base64,${audioBuffer.toString("base64")}`;
      await unlink(outPath).catch(() => {});
    } catch (error) {
      console.warn("Failed to generate local TTS using say command:", error);
    }
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
