import { describe, it, expect } from "vitest";
import { SPECIALISTS, NINJAS } from "./agents.ts";

describe("Agent Roster Integrity", () => {
  it("exports specialists and ninjas", () => {
    expect(SPECIALISTS).toBeInstanceOf(Array);
    expect(NINJAS).toBeInstanceOf(Array);
    expect(SPECIALISTS.length).toBeGreaterThan(0);
    expect(NINJAS.length).toBeGreaterThan(0);
  });

  it("ensures no duplicate agent IDs exist across the entire roster", () => {
    const allAgents = [...SPECIALISTS, ...NINJAS];
    const ids = allAgents.map(a => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("validates that all agents have complete fields", () => {
    const allAgents = [...SPECIALISTS, ...NINJAS];
    for (const agent of allAgents) {
      expect(typeof agent.id).toBe("string");
      expect(agent.id).toMatch(/^[a-z0-9]+$/);
      expect(typeof agent.name).toBe("string");
      expect(agent.name.length).toBeGreaterThan(0);
      expect(typeof agent.emoji).toBe("string");
      expect(typeof agent.brief).toBe("string");
      expect(agent.brief.length).toBeGreaterThan(10);
      expect(typeof agent.modeledOn).toBe("string");
      expect(agent.modeledOn.length).toBeGreaterThan(3);
    }
  });

  it("has specific core squads integrated", () => {
    const allIds = [...SPECIALISTS, ...NINJAS].map(a => a.id);
    expect(allIds).toContain("scout");
    expect(allIds).toContain("forge");
    expect(allIds).toContain("hawk"); // Original ninja
    expect(allIds).toContain("loom"); // Fable scale
    expect(allIds).toContain("switch"); // DevOps
    expect(allIds).toContain("gavel"); // Enterprise
  });
});
