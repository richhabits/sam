import { describe, expect, it } from "vitest";
import { getHardwareProfile, getOllamaStatus } from "./hardware.ts";

describe("Hardware Profiling Engine", () => {
  it("detects system memory and assigns a valid tier", () => {
    const profile = getHardwareProfile();
    expect(profile.totalMemoryGB).toBeGreaterThan(0);
    expect(profile.freeMemoryGB).toBeGreaterThanOrEqual(0);
    expect(["entry", "mid", "pro", "ultra"]).toContain(profile.tier);
    expect(profile.recommendedModels.length).toBeGreaterThan(0);
    expect(profile.cpuCores).toBeGreaterThan(0);
    expect(typeof profile.platform).toBe("string");
  });

  it("provides tailored models with parameter and vram specs", () => {
    const profile = getHardwareProfile();
    for (const model of profile.recommendedModels) {
      expect(model.name).toBeTruthy();
      expect(model.tag).toBeTruthy();
      expect(model.vramRequiredGB).toBeGreaterThan(0);
      expect(["fast-chat", "coding", "deep-reasoning", "vision", "heavy-thinker"]).toContain(model.specialty);
    }
  });

  it("handles offline Ollama check gracefully without throwing", async () => {
    const status = await getOllamaStatus("http://127.0.0.1:9999");
    expect(status.online).toBe(false);
    expect(status.models).toEqual([]);
  });
});
