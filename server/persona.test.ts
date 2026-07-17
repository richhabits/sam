import { describe, it, expect } from "vitest";
import { PERSONAS, personaVoice } from "./persona.ts";

describe("personas", () => {
  it("every persona changes tone but keeps the honesty guardrail (no yes-man)", () => {
    for (const p of PERSONAS) {
      const v = personaVoice(p.id, "Romeo");
      expect(v).toContain("Romeo");
      // The wellbeing/honesty guardrail must survive in EVERY persona.
      expect(v.toLowerCase()).toContain("yes-man");
      expect(v.toLowerCase()).toMatch(/honest|truth/);
    }
  });

  it("distinct personas produce distinct voices", () => {
    const voices = new Set(PERSONAS.map((p) => personaVoice(p.id, "Romeo").split("\n")[1]));
    expect(voices.size).toBe(PERSONAS.length);
  });

  it("unknown/absent persona falls back to the warm default", () => {
    const def = personaVoice(undefined, "Romeo");
    expect(def).toBe(personaVoice("sam", "Romeo"));
    expect(def.toLowerCase()).toContain("warm");
  });

  it("ships the full relationship set (gran/mum/dad/PA/coach/bestie/mentor + default SAM)", () => {
    const ids = PERSONAS.map((p) => p.id);
    for (const id of ["sam", "pa", "coach", "gran", "mum", "dad", "bestie", "mentor"]) expect(ids).toContain(id);
  });
});
