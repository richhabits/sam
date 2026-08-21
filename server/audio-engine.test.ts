import { describe, it, expect } from "vitest";
import {
  generateSpeechAudio,
  synthesizeDialogueAudio,
  VOICES,
} from "./audio-engine.ts";
import { audioSynthesizeSpeechTool } from "./tools.ts";

describe("Streaming Voice & Audio Engine", () => {
  it("generates speech audio with simulated waveform and duration", () => {
    const res = generateSpeechAudio("Welcome back to SAM. All trading ladders are operational.", "sam_host");
    expect(res.voice.id).toBe("sam_host");
    expect(res.durationSeconds).toBeGreaterThan(0);
    expect(res.waveformSample.length).toBe(32);
    expect(res.audioFormat).toBe("mp3");
    expect(res.audioBase64Stub).toContain("data:audio/mp3;base64");
  });

  it("synthesizes multi-speaker podcast dialogue with Alex and Sam", () => {
    const dialogue = synthesizeDialogueAudio("The £5 Compounding Experiment", [
      { speaker: "Alex", text: "Today we are looking at SAM's £5 compounding ladder." },
      { speaker: "Sam", text: "That's right, we are testing the Kelly criterion sizing." },
    ]);

    expect(dialogue.title).toBe("The £5 Compounding Experiment");
    expect(dialogue.exchanges.length).toBe(2);
    expect(dialogue.exchanges[0].voiceId).toBe("alex_cohost");
    expect(dialogue.exchanges[1].voiceId).toBe("sam_host");
    expect(dialogue.cues.length).toBe(2);
    expect(dialogue.cues[0].startSec).toBe(0);
    expect(dialogue.cues[1].startSec).toBeGreaterThan(dialogue.cues[0].endSec);
    expect(dialogue.totalDurationSeconds).toBeGreaterThan(0);
  });

  it("runs audioSynthesizeSpeechTool", async () => {
    const out = await audioSynthesizeSpeechTool({
      text: "System status check complete.",
      voice: "echo_deep",
    });
    expect(out).toContain("Voice Audio Synthesis Ready");
    expect(out).toContain("Echo");
    expect(out).toContain("32-Bin Waveform:");
  });
});
