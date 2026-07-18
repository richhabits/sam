import { describe, it, expect } from "vitest";
import { isDegenerateRepetition, collapseRepetition } from "./repetition.ts";

describe("isDegenerateRepetition — trips on a runaway loop", () => {
  it("word repeated many times", () => {
    expect(isDegenerateRepetition("Sure! " + "hello ".repeat(30))).toBe(true);
  });
  it("single word with no spaces repeated", () => {
    expect(isDegenerateRepetition("hello".repeat(40))).toBe(true);
  });
  it("a whole sentence repeated", () => {
    expect(isDegenerateRepetition("I can help with that. ".repeat(10))).toBe(true);
  });
  it("short token spammed", () => {
    expect(isDegenerateRepetition("answer: " + "ok ".repeat(40))).toBe(true);
  });
  it("extreme pure-symbol run", () => {
    expect(isDegenerateRepetition("=".repeat(60))).toBe(true);
  });
});

describe("isDegenerateRepetition — leaves legitimate text alone", () => {
  const ok = [
    "",
    "hello",
    "Hello! How can I help you today?",
    "The quick brown fox jumps over the lazy dog. It was a fine morning.",
    "Here are three options:\n1. Ollama\n2. Groq\n3. Cerebras\n\nEach is free.",
    "ha ha ha that's funny",                    // only 3 reps — not degenerate
    "| Name | Age |\n| --- | --- |\n| A | 1 |",  // markdown table rule — symbol run, not extreme
    "Really really really good.",               // 3 reps
    "\n\nParagraph one.\n\nParagraph two.\n\n",  // blank lines, not a loop
  ];
  for (const s of ok) {
    it(`ignores: ${JSON.stringify(s.slice(0, 30))}`, () => expect(isDegenerateRepetition(s)).toBe(false));
  }
});

describe("collapseRepetition — cleans the runaway tail, keeps the good prefix", () => {
  it("collapses a word loop to one occurrence", () => {
    const out = collapseRepetition("Sure, here goes: " + "hello ".repeat(30));
    expect(out).toBe("Sure, here goes: hello");
  });
  it("collapses a repeated sentence", () => {
    const out = collapseRepetition("Answer. " + "I can help. ".repeat(12));
    expect(out).toBe("Answer. I can help.");
  });
  it("leaves clean text unchanged", () => {
    const clean = "A normal answer with no loops at all.";
    expect(collapseRepetition(clean)).toBe(clean);
  });
});
