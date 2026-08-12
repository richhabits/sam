import { describe, expect, it } from "vitest";
import { CURTAIN_FALLBACK, curtain, curtainOpening, isStageDirection, stageGate } from "./curtain.ts";
import { TOOLS } from "./tools.ts";

// The Curtain stands between a model's text and a human's eyes. These prove the two halves that
// matter and are in tension: scaffolding NEVER gets through, and an ordinary answer is NEVER eaten.
// The second half is the harder one — a leak-stopper that also swallows real answers is not a fix.

const NAMES = TOOLS.map((t) => t.name);

// The text a real user was shown on 2026-08-12: local llama3.2:3b, no cloud keys loaded, asked for
// three bullets about what makes SAM different. Everything up to the colon is SAM's own machinery.
const LEAK =
  "Since we're out of scope in this moment and there's a missing piece to be found by running a " +
  "list_dir tool first — I'll give a clear, immediate answer using only plain text: Assistant apps " +
  "aren't available on Macs due to macOS security measures; SAM is an AI designed specifically for Mac.";

describe("the reported leak", () => {
  const shown = curtain(LEAK, NAMES);

  it("strips every trace of the tool deliberation", () => {
    expect(shown).not.toContain("list_dir");
    expect(shown).not.toContain("out of scope");
    expect(shown).not.toContain("missing piece");
    expect(shown).not.toContain("plain text");
    expect(shown).not.toMatch(/I'll give a clear/);
  });

  it("keeps the answer that was hiding behind it", () => {
    expect(shown).toContain("macOS security measures");
    expect(shown.startsWith("Assistant apps")).toBe(true);
  });
});

describe("isStageDirection — the tells", () => {
  it("catches the tool protocol in any shape it arrives in", () => {
    expect(isStageDirection('{"tool":"web_search","input":{"query":"x"}}', NAMES)).toBe(true);
    expect(isStageDirection("{'tool': 'read_file'}", NAMES)).toBe(true);
    expect(isStageDirection('{"respond":"hi"}', NAMES)).toBe(true);
  });

  it("catches a tool NAME inside a plan to call it", () => {
    expect(isStageDirection("First I need to run web_search for that", NAMES)).toBe(true);
    expect(isStageDirection("Let me use read_file to check", NAMES)).toBe(true);
    expect(isStageDirection("by running a list_dir tool first", NAMES)).toBe(true);
  });

  it("catches a plan frame aimed at the machinery", () => {
    expect(isStageDirection("I'll answer using only plain text", NAMES)).toBe(true);
    expect(isStageDirection("Let me check the available tools first", NAMES)).toBe(true);
    expect(isStageDirection("I need to emit a JSON object", NAMES)).toBe(true);
  });

  // Both of these came from running the real llama3.2:3b against the reported question. Neither was
  // caught by the rules written from the first sample alone.
  it("catches SAM naming its own toolbox (third live sample)", () => {
    expect(isStageDirection("It seems I made an error in my internal tool catalog.", NAMES)).toBe(true);
    expect(isStageDirection("Let me check the tool registry.", NAMES)).toBe(true);
  });

  it("catches a hyphenated 'plain-text answer' (fourth live sample)", () => {
    expect(isStageDirection("Since there are no available tools to provide a contrast, I'll give a plain-text answer", NAMES)).toBe(true);
  });

  it("still allows the honest 'I don't have a tool for that' — an answer, not scaffolding", () => {
    expect(isStageDirection("I don't have a tool for ordering pizza", NAMES)).toBe(false);
    expect(isStageDirection("There's no tool for that on this Mac", NAMES)).toBe(false);
  });

  it("does NOT fire on ordinary assistant voice", () => {
    expect(isStageDirection("I'll check the weather for you", NAMES)).toBe(false);
    expect(isStageDirection("Let me explain how that works", NAMES)).toBe(false);
    expect(isStageDirection("I need to know your postcode first", NAMES)).toBe(false);
    expect(isStageDirection("You should back that up weekly", NAMES)).toBe(false);
  });

  it("does NOT fire on an answer that legitimately NAMES tools", () => {
    // "what can you do?" is a real question with a real answer, and the answer is a list of tools.
    expect(isStageDirection("Here are the tools I have", NAMES)).toBe(false);
    expect(isStageDirection("web_search, read_file and get_weather", NAMES)).toBe(false);
  });

  // Seventeen tools are named with an ordinary English word (call, play, research, translate…).
  // Treating those as identifiers deleted real sentences — "here is the call shape" was read as a
  // plan to invoke the `call` tool. A one-word name only counts next to the word "tool".
  it("does NOT fire on ordinary use of a word that happens to be a tool name", () => {
    expect(isStageDirection("Here is the call shape", NAMES)).toBe(false);
    expect(isStageDirection("I'll call you back at three", NAMES)).toBe(false);
    expect(isStageDirection("Let me play that back for you", NAMES)).toBe(false);
    expect(isStageDirection("I need to translate the research first", NAMES)).toBe(false);
  });

  it("DOES fire when a one-word tool name is named AS a tool", () => {
    expect(isStageDirection("Let me use the research tool for this", NAMES)).toBe(true);
    expect(isStageDirection("I should run the translate tool first", NAMES)).toBe(true);
  });
});

describe("curtain — trims the edges, never the middle", () => {
  it("leaves a clean answer exactly as written", () => {
    const clean = "SAM runs on your Mac.\n- Nothing leaves the machine\n- No account needed\n- Free forever";
    expect(curtain(clean, NAMES)).toBe(clean);
  });

  it("drops a trailing plan as well as a leading one", () => {
    const t = "London is about 12°C today. Now I'll run web_search to double-check.";
    expect(curtain(t, NAMES)).toBe("London is about 12°C today.");
  });

  it("does not touch scaffolding-shaped words in the MIDDLE of an answer", () => {
    const t = "Two options here. I'll use read_file if you want the local copy. Either works.";
    expect(curtain(t, NAMES)).toContain("read_file");   // middle clause survives — only edges are judged
  });

  it("removes a thinking block wherever it sits", () => {
    expect(curtain("<think>the user wants bullets, I should call list_dir</think>It's 12°C.", NAMES)).toBe("It's 12°C.");
    expect(curtain("It's 12°C.<thinking>maybe check again</thinking>", NAMES)).toBe("It's 12°C.");
  });

  it("removes an UNCLOSED thinking block (the stream was cut mid-thought)", () => {
    expect(curtain("It's 12°C.\n<think>should I also mention", NAMES)).toBe("It's 12°C.");
  });

  it("drops a bare protocol label but keeps what follows", () => {
    expect(curtain("Final answer: it's 12°C.", NAMES)).toBe("it's 12°C.");
    // Seen from the real local brain: the model narrating that it is now producing output.
    expect(curtain("Here's a possible response:\n\nSAM runs on your Mac.", NAMES)).toBe("SAM runs on your Mac.");
  });

  // A second live sample, caught by running the real llama3.2:3b against the reported question with
  // the Curtain switched off. Same class, different words — it names a tool that does not even
  // exist. A fix keyed to the first sample's exact phrasing would have sailed straight past this.
  it("catches the SAME class with different words (second live sample)", () => {
    const t = 'Since there\'s no "compare_assistants" tool, I\'ll provide my differentiating features in plain text:\n\n' +
      "• Local Operation: SAM runs on your device.\n• Personalised: SAM learns from your interactions.";
    const shown = curtain(t, NAMES);
    expect(shown).not.toContain("compare_assistants");
    expect(shown).not.toMatch(/plain text/i);
    expect(shown.startsWith("• Local Operation")).toBe(true);
  });

  it("returns empty when the whole turn was deliberation (caller says so plainly)", () => {
    expect(curtain("I'll need to run list_dir first. Let me check the available tools.", NAMES)).toBe("");
    expect(curtain('{"tool":"list_dir","input":{"path":"~"}}', NAMES)).toBe("");
  });

  it("an empty or blank turn stays empty — a different failure, not the Curtain's to dress up", () => {
    expect(curtain("", NAMES)).toBe("");
    expect(curtain("   \n ", NAMES)).toBe("");
  });
});

describe("curtain — code fences are content, not prose", () => {
  it("never judges what is inside a fence (a JSON example is the ANSWER to a coding question)", () => {
    const t = 'Here is the call shape:\n\n```json\n{"tool":"web_search","input":{"query":"x"}}\n```\n\nThat is the envelope.';
    const shown = curtain(t, NAMES);
    expect(shown).toContain('"tool":"web_search"');     // the example survived intact
    expect(shown).toContain("That is the envelope.");
  });

  it("still deletes a fence that IS the protocol wearing a code block", () => {
    const shown = curtain('```json\n{"tool":"list_dir","input":{"path":"~"}}\n```', NAMES);
    expect(shown).toBe("");
  });

  it("leaves an ordinary code answer completely alone", () => {
    const t = "Use this:\n\n```ts\nconst x = read_file(path);\n```";
    expect(curtain(t, NAMES)).toBe(t);
  });
});

describe("stageGate — the live stream, where tokens are read as they land", () => {
  const drain = (chunks: string[]) => {
    const g = stageGate(NAMES);
    return chunks.map((c) => g.push(c)).join("") + g.flush();
  };

  it("holds the opening back and releases only the answer", () => {
    const out = drain([LEAK]);
    expect(out).not.toContain("list_dir");
    expect(out).not.toContain("plain text");
    expect(out).toContain("macOS security measures");
  });

  it("works across arbitrary chunk boundaries (a real token stream)", () => {
    const chunks = LEAK.match(/.{1,7}/gs)!;             // seven characters at a time
    const out = drain(chunks);
    expect(out).not.toContain("list_dir");
    expect(out).not.toContain("out of scope");
    expect(out).toContain("macOS security measures");
  });

  it("passes a clean answer through whole — nothing is lost to the gate", () => {
    expect(drain(["SAM runs ", "on your Mac. ", "Nothing leaves it."])).toBe("SAM runs on your Mac. Nothing leaves it.");
  });

  it("opens once and then stops judging — the middle of an answer streams untouched", () => {
    const g = stageGate(NAMES);
    g.push("It's 12°C today. ");                        // gate opens here
    expect(g.push("I'll use read_file next.")).toBe("I'll use read_file next.");   // mid-answer: passed through
  });

  it("emits NOTHING when the whole stream was deliberation", () => {
    expect(drain(["I'll need to run list_dir first. ", "Let me check the available tools."])).toBe("");
  });

  it("flushes a short answer that never hit a clause boundary", () => {
    expect(drain(["Paris"])).toBe("Paris");
  });
});

describe("CURTAIN_FALLBACK", () => {
  it("is honest — it does not claim an answer, or name the machinery that failed", () => {
    expect(CURTAIN_FALLBACK).toMatch(/didn't reach a clean answer/i);
    expect(CURTAIN_FALLBACK).not.toMatch(/tool|json|model|schema|prompt/i);
  });
});

describe("curtainOpening — same rule, opening only", () => {
  it("keeps a trailing plan that `curtain` would drop (the end hasn't been written yet)", () => {
    const t = "London is about 12°C today. Now I'll run web_search to double-check.";
    expect(curtainOpening(t, NAMES)).toBe(t);
  });
});
