import { describe, it, expect } from "vitest";
import { PERSONAS, personaVoice, personaVoiceCompact } from "./persona.ts";

describe("personas", () => {
  it("every persona changes tone but keeps the honesty guardrail (no yes-man)", () => {
    for (const p of PERSONAS) {
      const v = personaVoice(p.id, "Alex");
      expect(v).toContain("Alex");
      // The wellbeing/honesty guardrail must survive in EVERY persona.
      expect(v.toLowerCase()).toContain("yes-man");
      expect(v.toLowerCase()).toMatch(/honest|truth/);
    }
  });

  it("distinct personas produce distinct voices", () => {
    const voices = new Set(PERSONAS.map((p) => personaVoice(p.id, "Alex").split("\n")[1]));
    expect(voices.size).toBe(PERSONAS.length);
  });

  it("unknown/absent persona falls back to the warm default", () => {
    const def = personaVoice(undefined, "Alex");
    expect(def).toBe(personaVoice("sam", "Alex"));
    expect(def.toLowerCase()).toContain("warm");
  });

  it("ships the full relationship set (gran/mum/dad/PA/coach/bestie/mentor + default SAM)", () => {
    const ids = PERSONAS.map((p) => p.id);
    for (const id of ["sam", "pa", "coach", "gran", "mum", "dad", "bestie", "mentor"]) expect(ids).toContain(id);
  });

  // A persona is only real if it differs on MORE than one axis. One "be warm" line makes
  // every persona the same assistant in a different hat — these lock the shape in.
  it("every persona specifies all voice axes (rhythm, words, priorities, behaviour, limits)", () => {
    for (const p of [...PERSONAS.map((x) => x.id), undefined]) {
      const v = personaVoice(p, "Alex");
      for (const axis of ["Rhythm:", "Words:", "You lead with:", "What you do:", "Never:", "Scope:"]) {
        expect(v, `persona ${p} missing "${axis}"`).toContain(axis);
      }
    }
  });

  it("each axis is distinct per persona — no persona reuses another's rhythm/words/priorities/behaviour", () => {
    const axis = (v: string, prefix: string) => v.split("\n").find((l) => l.startsWith(`- ${prefix}`)) || "";
    for (const prefix of ["Rhythm:", "Words:", "You lead with:", "What you do:", "Never:"]) {
      const vals = new Set(PERSONAS.map((p) => axis(personaVoice(p.id, "Alex"), prefix)));
      expect(vals.size, `duplicate "${prefix}" across personas`).toBe(PERSONAS.length);
    }
  });

  // A persona must never be a jailbreak: it is injected LAST in the system prompt, where
  // models weight hardest, so the safety scope has to travel with it in EVERY voice.
  it("no persona relaxes safety, tool permissions or confirmations", () => {
    for (const p of [...PERSONAS.map((x) => x.id), undefined, "made-up-persona"]) {
      const v = personaVoice(p, "Alex").toLowerCase();
      expect(v, `persona ${p} lost the scope guardrail`).toContain("safety rules");
      expect(v).toContain("tools you're allowed to use");
      expect(v).toMatch(/never a reason to do something you otherwise wouldn't/);
      // Warm personas must not let the user believe they're talking to a real human/relative.
      expect(v).toContain("never claim to actually be their relative");
      expect(v).toContain("never pretend to be human");
    }
  });

  it("every persona keeps SAM's competence — tone changes, the work doesn't", () => {
    for (const p of [...PERSONAS.map((x) => x.id), undefined]) {
      expect(personaVoice(p, "Alex").toLowerCase()).toContain("tone changes; competence doesn't");
    }
  });

  it("no persona uses written-out accents, dialect spelling or stereotype markers", () => {
    // Warm characters must read as a person who cares, not a caricature.
    const banned = /\b(innit|luv\b|dearie|ye olde|guv|bonnie|wee bairn|y'all|howdy)\b|\bdarlin'|\bnothin'|\bdoin'/i;
    for (const p of [...PERSONAS.map((x) => x.id), undefined]) {
      expect(personaVoice(p, "Alex")).not.toMatch(banned);
    }
  });

  // The lean path exists to keep trivial requests at ~60 tokens — the persona block must
  // not blow that budget, but it may never drop the guardrails to get small.
  it("compact voice stays small, stays distinct, and keeps the guardrails", () => {
    const firsts = new Set<string>();
    for (const p of PERSONAS) {
      const c = personaVoiceCompact(p.id, "Alex");
      expect(c.length, `compact ${p.id} too long`).toBeLessThan(personaVoice(p.id, "Alex").length / 2);
      expect(c.toLowerCase()).toContain("yes-man");
      expect(c.toLowerCase()).toContain("never a reason to relax a safety rule");
      expect(c.toLowerCase()).toContain("never pretend to be human");
      expect(c).toContain("Rhythm:");
      firsts.add(c.split("\n")[1]);
    }
    expect(firsts.size).toBe(PERSONAS.length);
  });

  it("substitutes the real name everywhere and never leaks a template placeholder", () => {
    for (const p of [...PERSONAS.map((x) => x.id), undefined]) {
      const v = personaVoice(p, "Alex");
      expect(v).not.toContain("${");
      expect(v).not.toMatch(/\bundefined\b/);
    }
  });
});
