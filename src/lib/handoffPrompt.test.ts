import { describe, expect, it } from "vitest";
import { HANDOFF_PROMPT } from "./handoffPrompt";

// This prompt is copied into someone ELSE'S assistant, which then writes a profile about the
// user that comes back into SAM. Two things must never drift: it must not ask for secrets, and
// it must not invite the other model to invent a profile. Both are one careless edit away.

describe("handoff prompt", () => {
  it("explicitly refuses credentials and sensitive detail", () => {
    const p = HANDOFF_PROMPT.toLowerCase();
    for (const word of ["password", "api key", "bank", "card"]) {
      expect(p, `should name ${word} in the do-not-include list`).toContain(word);
    }
    expect(p).toMatch(/do not include|leave it out/);
  });

  it("tells the other model not to guess", () => {
    // A model asked for a profile it doesn't have will happily write a plausible one, and SAM
    // would then store fiction as durable facts about its owner.
    expect(HANDOFF_PROMPT.toLowerCase()).toMatch(/do not guess|skip that line|only what you actually know/);
  });

  it("asks for facts, never for instructions to SAM", () => {
    // The output is UNTRUSTED input to SAM's importer. If the prompt invited the other assistant
    // to write directives ("tell SAM to always..."), we'd be manufacturing an injection payload
    // and handing it to ourselves.
    expect(HANDOFF_PROMPT).not.toMatch(/tell SAM to|instruct SAM|SAM should always/i);
  });

  it("covers the surfaces SAM actually has", () => {
    // A generic "tell me about yourself" wastes the round trip. These headings map onto real
    // features: personas, Business mode, people, schedules/workflows, tools, the consent model.
    for (const heading of [
      "How I like to be spoken to",
      "My work",
      "People",
      "Recurring jobs",
      "Tools I actually use",
      "Boundaries",
    ]) {
      expect(HANDOFF_PROMPT, `missing section: ${heading}`).toContain(heading);
    }
  });

  it("stays short enough to paste anywhere", () => {
    // Some chat inputs choke on very long pastes, and a wall of text discourages reading it —
    // which matters when the whole point is that you can see what you're handing over.
    expect(HANDOFF_PROMPT.length).toBeLessThan(2600);
    expect(HANDOFF_PROMPT.length).toBeGreaterThan(600);
  });
});
