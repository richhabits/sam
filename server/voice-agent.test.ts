import { describe, it, expect } from "vitest";
import {
  VoiceStreamSession,
  buildWavHeader,
  getOrCreateVoiceSession,
} from "./voice-agent.ts";

function generatePcmSineTone(durationMs: number, sampleRate = 16000, frequency = 440, amplitude = 0.5): Buffer {
  const sampleCount = Math.floor((durationMs / 1000) * sampleRate);
  const buf = Buffer.alloc(sampleCount * 2);

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude;
    const int16 = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buf.writeInt16LE(int16, i * 2);
  }

  return buf;
}

function generateSilentPcm(durationMs: number, sampleRate = 16000): Buffer {
  const sampleCount = Math.floor((durationMs / 1000) * sampleRate);
  return Buffer.alloc(sampleCount * 2);
}

describe("S.A.M. Streaming Voice Agent & VAD Engine", () => {
  it("builds a 44-byte standard RIFF WAV header with exact byte rates", () => {
    const dataLen = 32000; // 1 second of 16kHz 16-bit mono
    const header = buildWavHeader(dataLen, 16000, 1, 16);

    expect(header.length).toBe(44);
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.toString("ascii", 8, 12)).toBe("WAVE");
    expect(header.toString("ascii", 12, 16)).toBe("fmt ");
    expect(header.readUInt32LE(24)).toBe(16000); // Sample rate
    expect(header.readUInt32LE(28)).toBe(32000); // Byte rate (16000 * 2)
    expect(header.toString("ascii", 36, 40)).toBe("data");
    expect(header.readUInt32LE(40)).toBe(dataLen);
  });

  it("calculates RMS energy correctly for tone vs silence", () => {
    const session = new VoiceStreamSession("test-rms");

    const silentChunk = generateSilentPcm(100);
    const silentRms = session.calculateRms(silentChunk);
    expect(silentRms).toBe(0);

    const toneChunk = generatePcmSineTone(100, 16000, 440, 0.4);
    const toneRms = session.calculateRms(toneChunk);
    expect(toneRms).toBeGreaterThan(0.2);
  });

  it("transitions state machine from IDLE to LISTENING on speech onset", () => {
    const session = new VoiceStreamSession("test-vad", {
      energyThresholdRms: 0.05,
      speechOnsetFrames: 2,
      speechHangoverFrames: 3,
    });

    expect(session.state).toBe("IDLE");

    const voiceChunk = generatePcmSineTone(100, 16000, 440, 0.3);

    // Frame 1: speech detected but onset threshold (2) not yet met
    const r1 = session.feedAudioChunk(voiceChunk);
    expect(r1.state).toBe("IDLE");

    // Frame 2: onset met -> triggers SPEECH_START and LISTENING
    const r2 = session.feedAudioChunk(voiceChunk);
    expect(r2.state).toBe("LISTENING");
    expect(r2.event).toBe("SPEECH_START");
  });

  it("detects speech end, packages WAV audio, and transitions to PROCESSING", () => {
    const session = new VoiceStreamSession("test-hangover", {
      energyThresholdRms: 0.05,
      speechOnsetFrames: 1,
      speechHangoverFrames: 2,
    });

    const voiceChunk = generatePcmSineTone(100, 16000, 440, 0.3);
    const silentChunk = generateSilentPcm(100);

    // Start speech
    session.feedAudioChunk(voiceChunk);
    expect(session.state).toBe("LISTENING");

    // Silence frame 1
    session.feedAudioChunk(silentChunk);
    expect(session.state).toBe("LISTENING");

    // Silence frame 2 -> hangover met -> triggers SPEECH_END and returns ready WAV
    const res = session.feedAudioChunk(silentChunk);
    expect(res.state).toBe("PROCESSING");
    expect(res.event).toBe("SPEECH_END");
    expect(res.wavReadyBuffer).toBeDefined();
    expect(res.wavReadyBuffer?.length).toBeGreaterThan(44);
  });

  it("handles barge-in interruption during SPEAKING", () => {
    const session = getOrCreateVoiceSession("test-bargein");
    session.setSpeaking();
    expect(session.state).toBe("SPEAKING");

    // Loud user voice interrupts
    const loudVoice = generatePcmSineTone(100, 16000, 440, 0.6);
    const res = session.feedAudioChunk(loudVoice);

    expect(res.state).toBe("INTERRUPTED");
    expect(res.event).toBe("INTERRUPTION");
  });
});
