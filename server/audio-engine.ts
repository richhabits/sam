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

export function generateSpeechAudio(
  text: string,
  voiceId = "sam_host",
  options: { speed?: number; pitch?: number } = {}
): SpeechSynthesisResult {
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

  return {
    text: clean,
    voice: v,
    audioFormat: "mp3",
    durationSeconds: duration,
    waveformSample: waveform,
    audioBase64Stub: `data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAA...`,
  };
}

export interface DialogueExchange {
  speaker: string;
  text: string;
}

export interface PodcastSynthesisResult {
  title: string;
  exchanges: {
    speaker: string;
    voiceId: string;
    text: string;
    durationSec: number;
  }[];
  totalDurationSeconds: number;
}

export function synthesizeDialogueAudio(
  title: string,
  exchanges: DialogueExchange[]
): PodcastSynthesisResult {
  const renderedExchanges = exchanges.map((ex) => {
    const isAlex = ex.speaker.toLowerCase().includes("alex");
    const voiceId = isAlex ? "alex_cohost" : "sam_host";
    const speech = generateSpeechAudio(ex.text, voiceId);
    return {
      speaker: ex.speaker,
      voiceId,
      text: ex.text,
      durationSec: speech.durationSeconds,
    };
  });

  const total = renderedExchanges.reduce((sum, e) => sum + e.durationSec, 0);

  return {
    title: title || "Audio Overview Dialogue",
    exchanges: renderedExchanges,
    totalDurationSeconds: Number(total.toFixed(2)),
  };
}
