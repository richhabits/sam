import { describe, expect, it } from "vitest";
import { detectWake, type WakeClock } from "./wake";

function clock(): WakeClock {
  return { now: 1000, whistleFrames: 0, lastClap: 0, firstClap: 0, cooldownUntil: 0 };
}

describe("wake detector (no mic)", () => {
  it("fires after a sustained whistle in the 1–4 kHz band", () => {
    const freq = new Uint8Array(64);
    const time = new Uint8Array(64).fill(128);
    freq[20] = 220;
    const c = clock();
    let fired = 0;
    for (let i = 0; i < 10; i++) {
      c.now = 1000 + i * 16;
      if (detectWake(freq, time, 10, 40, c)) fired++;
    }
    expect(fired).toBeGreaterThanOrEqual(1);
  });

  it("fires on a double clap, not a single clap", () => {
    const freq = new Uint8Array(64);
    const spike = new Uint8Array(64).fill(128);
    spike[0] = 128 + 100;
    const quiet = new Uint8Array(64).fill(128);
    const c = clock();
    expect(detectWake(freq, spike, 10, 40, c)).toBe(false);
    c.now = 1400;
    expect(detectWake(freq, quiet, 10, 40, c)).toBe(false);
    c.now = 1500;
    expect(detectWake(freq, spike, 10, 40, c)).toBe(true);
  });

  it("silence never wakes", () => {
    const freq = new Uint8Array(64);
    const time = new Uint8Array(64).fill(128);
    const c = clock();
    for (let i = 0; i < 20; i++) {
      c.now = 1000 + i * 16;
      expect(detectWake(freq, time, 10, 40, c)).toBe(false);
    }
  });
});
