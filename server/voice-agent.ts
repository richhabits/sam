// ─────────────────────────────────────────────────────────────
//  S.A.M. · STREAMING BIDIRECTIONAL VOICE AGENT & AUDIO PIPELINE
//
//  Low-latency Voice Activity Detection (VAD), energy hysteresis,
//  PCM-to-WAV stream encapsulation, and real-time interruption handling.
// ─────────────────────────────────────────────────────────────

export type VoiceState = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING" | "INTERRUPTED";

export interface VoiceSessionConfig {
  sampleRate?: number;            // e.g. 16000 Hz
  channels?: number;              // 1 (mono)
  bitDepth?: number;              // 16-bit
  energyThresholdRms?: number;    // VAD speech trigger threshold (e.g. 0.02)
  speechOnsetFrames?: number;     // Consecutive frames needed to trigger speech (default: 3)
  speechHangoverFrames?: number;  // Consecutive silent frames needed to end speech (default: 10)
}

export interface VoiceSessionState {
  sessionId: string;
  state: VoiceState;
  sampleRate: number;
  speechFramesCount: number;
  silentFramesCount: number;
  isSpeaking: boolean;
  totalAudioProcessedMs: number;
  lastRmsEnergy: number;
  bufferedChunksCount: number;
}

export class VoiceStreamSession {
  public readonly sessionId: string;
  public state: VoiceState = "IDLE";
  public readonly sampleRate: number;
  public readonly channels: number;
  public readonly bitDepth: number;
  private energyThreshold: number;
  private onsetFramesRequired: number;
  private hangoverFramesRequired: number;

  private speechFrames = 0;
  private silentFrames = 0;
  private audioChunks: Buffer[] = [];
  private totalSamples = 0;
  private lastRms = 0;

  constructor(sessionId: string, config: VoiceSessionConfig = {}) {
    this.sessionId = sessionId;
    this.sampleRate = config.sampleRate || 16000;
    this.channels = config.channels || 1;
    this.bitDepth = config.bitDepth || 16;
    this.energyThreshold = config.energyThresholdRms || 0.02;
    this.onsetFramesRequired = config.speechOnsetFrames || 3;
    this.hangoverFramesRequired = config.speechHangoverFrames || 8;
  }

  /**
   * Calculates Root Mean Square (RMS) energy of 16-bit PCM buffer.
   */
  public calculateRms(pcmChunk: Buffer): number {
    if (!pcmChunk || pcmChunk.length < 2) return 0;
    let sumSquares = 0;
    const sampleCount = Math.floor(pcmChunk.length / 2);

    for (let i = 0; i < pcmChunk.length; i += 2) {
      const sample = pcmChunk.readInt16LE(i) / 32768.0; // Normalize -1.0 to 1.0
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }

  /**
   * Ingests a raw PCM audio chunk and updates VAD state machine.
   */
  public feedAudioChunk(pcmChunk: Buffer): {
    state: VoiceState;
    event?: "SPEECH_START" | "SPEECH_END" | "INTERRUPTION";
    rmsEnergy: number;
    wavReadyBuffer?: Buffer;
  } {
    const rms = this.calculateRms(pcmChunk);
    this.lastRms = Number(rms.toFixed(4));
    this.totalSamples += pcmChunk.length / 2;

    let event: "SPEECH_START" | "SPEECH_END" | "INTERRUPTION" | undefined;

    // Check for user interruption (barge-in while assistant is speaking)
    if (this.state === "SPEAKING" && rms > this.energyThreshold * 1.5) {
      this.state = "INTERRUPTED";
      event = "INTERRUPTION";
      this.audioChunks = [pcmChunk];
      this.speechFrames = 1;
      this.silentFrames = 0;
      return { state: this.state, event, rmsEnergy: this.lastRms };
    }

    if (rms >= this.energyThreshold) {
      this.speechFrames++;
      this.silentFrames = 0;

      if (this.speechFrames >= this.onsetFramesRequired && this.state !== "LISTENING") {
        this.state = "LISTENING";
        event = "SPEECH_START";
      }
      this.audioChunks.push(pcmChunk);
    } else {
      this.silentFrames++;
      if (this.state === "LISTENING") {
        this.audioChunks.push(pcmChunk);

        if (this.silentFrames >= this.hangoverFramesRequired) {
          this.state = "PROCESSING";
          event = "SPEECH_END";
          const wavBuffer = this.finalizeWavAudio();
          return { state: this.state, event, rmsEnergy: this.lastRms, wavReadyBuffer: wavBuffer };
        }
      }
    }

    return { state: this.state, event, rmsEnergy: this.lastRms };
  }

  /**
   * Compiles buffered PCM chunks into a valid standard WAV audio buffer.
   */
  public finalizeWavAudio(): Buffer {
    const pcmData = Buffer.concat(this.audioChunks);
    this.audioChunks = [];
    this.speechFrames = 0;
    this.silentFrames = 0;

    const wavHeader = buildWavHeader(pcmData.length, this.sampleRate, this.channels, this.bitDepth);
    return Buffer.concat([wavHeader, pcmData]);
  }

  /**
   * Manually sets session to SPEAKING (TTS output started).
   */
  public setSpeaking(): void {
    this.state = "SPEAKING";
  }

  /**
   * Resets session to IDLE.
   */
  public reset(): void {
    this.state = "IDLE";
    this.audioChunks = [];
    this.speechFrames = 0;
    this.silentFrames = 0;
  }

  public getStatus(): VoiceSessionState {
    const totalMs = Math.round((this.totalSamples / this.sampleRate) * 1000);
    return {
      sessionId: this.sessionId,
      state: this.state,
      sampleRate: this.sampleRate,
      speechFramesCount: this.speechFrames,
      silentFramesCount: this.silentFrames,
      isSpeaking: this.state === "SPEAKING",
      totalAudioProcessedMs: totalMs,
      lastRmsEnergy: this.lastRms,
      bufferedChunksCount: this.audioChunks.length,
    };
  }
}

/**
 * Builds a 44-byte standard RIFF WAV header for raw PCM audio.
 */
export function buildWavHeader(
  dataLength: number,
  sampleRate = 16000,
  channels = 1,
  bitDepth = 16
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;

  // RIFF identifier
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4); // File length - 8
  header.write("WAVE", 8);

  // Format chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);             // Format chunk size (16 for PCM)
  header.writeUInt16LE(1, 20);              // Audio format (1 = PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);

  // Data chunk
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

const activeVoiceSessions = new Map<string, VoiceStreamSession>();

export function getOrCreateVoiceSession(sessionId = "default-mic", config?: VoiceSessionConfig): VoiceStreamSession {
  let session = activeVoiceSessions.get(sessionId);
  if (!session) {
    session = new VoiceStreamSession(sessionId, config);
    activeVoiceSessions.set(sessionId, session);
  }
  return session;
}
