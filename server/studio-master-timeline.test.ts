import { describe, it, expect } from "vitest";
import {
  formatSmpteTimecode,
  compileProductionTimeline,
} from "./studio-master-timeline.ts";

describe("S.A.M. Studio Multi-Track Production Timeline", () => {
  it("formats SMPTE timecodes precisely at 24fps", () => {
    expect(formatSmpteTimecode(0, 24)).toBe("00:00:00:00");
    expect(formatSmpteTimecode(24, 24)).toBe("00:00:01:00");
    expect(formatSmpteTimecode(36, 24)).toBe("00:00:01:12");
    expect(formatSmpteTimecode(24 * 60, 24)).toBe("00:01:00:00");
    expect(formatSmpteTimecode(24 * 3600, 24)).toBe("01:00:00:00");
  });

  it("compiles synchronized video and audio timeline with valid EDL export", () => {
    const timeline = compileProductionTimeline({
      conceptPrompt: "Cyberpunk rogue courier evading drones in neon alleyway",
      sceneCount: 4,
      aspectRatio: "2.39:1",
      customCharacterAnchor: "Courier Jax with illuminated cyan jacket",
    });

    expect(timeline.framerateFps).toBe(24);
    expect(timeline.aspectRatio).toBe("2.39:1");
    expect(timeline.characterSeedAnchor).toBe("Courier Jax with illuminated cyan jacket");
    expect(timeline.videoShots.length).toBe(4);
    expect(timeline.audioTracks.length).toBeGreaterThan(0);
    expect(timeline.totalFrames).toBeGreaterThan(0);
    expect(timeline.smpteDuration).toMatch(/^\d{2}:\d{2}:\d{2}:\d{2}$/);

    // Verify EDL structure
    expect(timeline.edlManifestText).toContain("TITLE:");
    expect(timeline.edlManifestText).toContain("001  AX       V     C");
    expect(timeline.edlManifestText).toContain("CAMERA RIG:");
  });
});
