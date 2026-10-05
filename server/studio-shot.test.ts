import { describe, expect, it } from "vitest";
import { shotDuration, zoompanFor } from "./studio-shot.ts";

describe("free Studio shot lane", () => {
  it("maps camera rigs to distinct zoompan moves", () => {
    const dolly = zoompanFor("dolly_in_rapid", 1, 120, 1280, 720);
    const pull = zoompanFor("dolly_out_epic", 1, 120, 1280, 720);
    const orbit = zoompanFor("orbit_360_cw", 1, 120, 1280, 720);
    const crane = zoompanFor("crane_pedestal_up", 1, 120, 1280, 720);
    expect(dolly).toContain("zoompan=");
    expect(dolly).toContain("s=1280x720");
    expect(pull).toContain("max(zoom-");
    expect(orbit).toContain("(iw-iw/zoom)");
    expect(crane).toContain("(ih-ih/zoom)");
    expect(dolly).not.toEqual(pull);
    expect(orbit).not.toEqual(crane);
  });

  it("sizes speak clips from the lines, not a branded clock", () => {
    expect(shotDuration(undefined)).toBe(5);
    expect(shotDuration(12)).toBe(12);
    expect(shotDuration(99)).toBe(20);
    expect(shotDuration(undefined, "one two three four five six seven eight")).toBeGreaterThanOrEqual(4);
  });

  it("does not name engines SAM does not run", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./studio-shot.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/Kling|Sora|Flux|Higgsfield V2/i);
  });
});
