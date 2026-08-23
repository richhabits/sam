import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateSpeechAudio,
  synthesizeDialogueAudio,
  VOICES,
} from "./audio-engine.ts";
import { audioSynthesizeSpeechTool } from "./tools.ts";

describe("Streaming Voice & Audio Engine", () => {
  // generateSpeechAudio calls out to ElevenLabs/Pollinations over the real network.
  // A test suite must not depend on a live third-party service — slow, flaky, and it
  // hits Pollinations' free tier on every CI run and every contributor's `npm test`.
  // Stub fetch so these exercise the function's own logic (voice selection, cue timing,
  // fallback-to-stub-on-no-key), not a network round trip.
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 })
    );
  });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("generates speech audio with simulated waveform and duration", async () => {
    const res = await generateSpeechAudio("Welcome back to SAM. All trading ladders are operational.", "sam_host");
    expect(res.voice.id).toBe("sam_host");
    expect(res.durationSeconds).toBeGreaterThan(0);
    expect(res.waveformSample.length).toBe(32);
    expect(res.audioFormat).toBe("mp3");
    expect(res.audioBase64Stub).toContain(";base64,");
  });

  it("synthesizes multi-speaker podcast dialogue with Alex and Sam", async () => {
    const dialogue = await synthesizeDialogueAudio("The £5 Compounding Experiment", [
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

  it("audioSynthesizeSpeechTool returns expected action format", async () => {
    const out = await audioSynthesizeSpeechTool({
      text: "System status check complete.",
      voice: "echo_deep",
    });
    expect(out).toContain("Voice Audio Synthesis Ready");
    expect(out).toContain("Echo");
    expect(out).toContain("32-Bin Waveform:");
  });

  it("falls back to the stub when the network is unavailable", async () => {
    fetchSpy.mockRejectedValue(new Error("network unreachable"));
    const res = await generateSpeechAudio("Offline fallback check.", "sam_host");
    expect(res.audioBase64Stub).toContain(";base64,");
  });
});
