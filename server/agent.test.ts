// ─────────────────────────────────────────────────────────────
//  S.A.M. · agent loop tests  (model mocked — no network)
//  Verifies: safe tools auto-run, risky tools pause for approval,
//  approval resumes, decline is respected.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the model so we script exactly what "SAM" replies each step.
const replies: string[] = [];
vi.mock("./models.ts", () => ({
  runModel: vi.fn(async () => ({ text: replies.shift() ?? "done", provider: "test", tier: "local" })),
}));

import { runAgent, resumeAgent, parseToolCall } from "./agent.ts";
import { _reset as resetIssues, listIssues } from "./issues.ts";

beforeEach(() => { replies.length = 0; });

describe("parseToolCall — local recovery (avoids a model repair round-trip)", () => {
  it("parses clean JSON, even embedded in prose or a code fence", () => {
    expect(parseToolCall('{"tool":"web_search","input":{"query":"x"}}')).toEqual({ tool: "web_search", input: { query: "x" } });
    expect(parseToolCall('Sure! ```json\n{"tool":"get_datetime","input":{}}\n```')).toEqual({ tool: "get_datetime", input: {} });
  });
  it("recovers the malformations small models actually emit — no model repair needed", () => {
    expect(parseToolCall("{'tool':'web_search','input':{'query':'best crm'}}")).toEqual({ tool: "web_search", input: { query: "best crm" } });   // single quotes
    expect(parseToolCall('{"tool":"web_search","input":{"query":"x"},}')).toEqual({ tool: "web_search", input: { query: "x" } });                // trailing comma
    expect(parseToolCall('{tool: "get_weather", input: {place: "London"}}')).toEqual({ tool: "get_weather", input: { place: "London" } });        // unquoted keys
  });
  it("returns null for plain prose (no false tool call)", () => {
    expect(parseToolCall("Here's your answer, no tool needed.")).toBeNull();
    expect(parseToolCall("I think {this} is fine.")).toBeNull();
  });
});

describe("agent loop", () => {
  it("auto-runs a SAFE tool then returns the final answer", async () => {
    replies.push('{"tool":"get_datetime","input":{}}');   // step 1: call safe tool
    replies.push("Here is the time, the user.");              // step 2: final answer
    const r = await runAgent("SYS", "what time is it?", "local");
    expect(r.kind).toBe("final");
    expect(r.text).toContain("time");
    expect(r.trace.length).toBe(1);                        // one action taken
    expect(r.trace[0]).toMatch(/time/i);
  });

  it("TURBO (forceFast) answers in ONE call — no tool loop even on a tool-shaped message", async () => {
    replies.push('{"tool":"get_datetime","input":{}}');   // a tool-shaped reply that would loop in normal mode
    replies.push("SHOULD NOT be consumed");
    const r = await runAgent("SYS", "what time is it?", "free", undefined, true);   // forceFast = turbo
    expect(r.kind).toBe("final");
    expect(r.trace.length).toBe(0);            // no tools ran
    expect(replies.length).toBe(1);            // exactly ONE model call consumed
  });

  it("PAUSES on a risky tool and does not execute it", async () => {
    replies.push('{"tool":"run_command","input":{"command":"echo hi"}}');
    const r = await runAgent("SYS", "run echo", "local");
    expect(r.kind).toBe("pending");
    expect(r.tool).toBe("run_command");
    expect(r.input.command).toBe("echo hi");
    expect(r.preview).toMatch(/echo hi/);
    expect(r.transcript).toBeTruthy();                     // resumable
  });

  it("resumes and runs the action after approval", async () => {
    replies.push("Done — I ran it.");                      // after the tool runs, final answer
    const r = await resumeAgent("SYS", "the user: run echo", "local", true, "run_command", { command: "echo hi" });
    expect(r.kind).toBe("final");
    expect(r.trace.length).toBe(1);
    expect(r.text).toMatch(/done/i);
  });

  it("respects a decline — does not run the action", async () => {
    replies.push("No problem, I won't run it.");
    const r = await resumeAgent("SYS", "the user: run echo", "local", false, "run_command", { command: "echo hi" });
    expect(r.kind).toBe("final");
    expect(r.trace.length).toBe(0);                        // nothing executed
  });

  it("answers directly when no tool is needed", async () => {
    replies.push("Two plus two is four.");
    const r = await runAgent("SYS", "what is 2+2?", "local");
    expect(r.kind).toBe("final");
    expect(r.trace.length).toBe(0);
  });
});

// allow = the SKILL.md `tools:` allowlist. 9th positional arg to runAgent.
const withAllow = (allow: string[]) =>
  ["local" as const, undefined, false, false, undefined, undefined, allow] as const;

describe("capability scope (SKILL.md tools: allowlist)", () => {
  it("DENIES an out-of-scope tool and never runs it (nudges the model instead)", async () => {
    replies.push('{"tool":"web_search","input":{"query":"x"}}');   // web_search NOT in the allowlist
    replies.push("Answered without it.");
    const r = await runAgent("SYS", "q", ...withAllow(["get_datetime"]));
    expect(r.kind).toBe("final");
    expect(r.trace.length).toBe(0);                    // the safe tool would have run if allowed — it didn't
  });

  it("ALLOWS a declared in-scope tool to run", async () => {
    replies.push('{"tool":"get_datetime","input":{}}');
    replies.push("The time is now.");
    const r = await runAgent("SYS", "time?", ...withAllow(["get_datetime"]));
    expect(r.kind).toBe("final");
    expect(r.trace.length).toBe(1);                    // in-scope tool ran
  });

  it("no allowlist ⇒ unrestricted (backward compatible)", async () => {
    replies.push('{"tool":"get_datetime","input":{}}');
    replies.push("The time is now.");
    const r = await runAgent("SYS", "time?", "local");   // allow undefined
    expect(r.trace.length).toBe(1);
  });

  it("an out-of-scope RISKY tool is denied BEFORE the approval prompt (scope beats surface)", async () => {
    replies.push('{"tool":"run_command","input":{"command":"echo hi"}}');   // risky AND out of scope
    replies.push("Did it another way.");
    const r = await runAgent("SYS", "run echo", ...withAllow(["get_datetime"]));
    expect(r.kind).toBe("final");                       // NOT pending — never surfaced for approval
    expect(r.trace.length).toBe(0);
  });
});

describe("the Parser — invalid tool calls are rejected loudly, never executed on a guess", () => {
  beforeEach(() => { process.env.SAM_PARSER = "1"; resetIssues(); });
  afterEach(() => { delete process.env.SAM_PARSER; resetIssues(); });

  it("an invalid write_file (missing required content) never runs — and is recorded to the Black Box", async () => {
    replies.push('{"tool":"write_file","input":{"path":"~/notes.md"}}');   // invalid: no `content`
    replies.push("Alright, I'll leave it for now.");                        // model gives up → final
    const r = await runAgent("SYS", "save my notes", "local");
    expect(r.kind).toBe("final");                                            // it did NOT pause to run write_file
    expect(r.trace.length).toBe(0);                                         // nothing executed
    expect(listIssues().some((i) => /invalid tool call: write_file/.test(i.message))).toBe(true);
  });

  it("self-repair round-trips: the diagnostic feeds back and a corrected call reaches the approval gate", async () => {
    replies.push('{"tool":"write_file","input":{"path":"~/notes.md","content":42}}'); // invalid: content wrong type
    replies.push('{"tool":"write_file","input":{"path":"~/notes.md","content":"fixed"}}'); // corrected
    const r = await runAgent("SYS", "save my notes", "local");
    expect(r.kind).toBe("pending");                                          // the CORRECTED call reached approval
    expect(r.kind === "pending" && r.tool).toBe("write_file");
    expect(replies.length).toBe(0);                                         // both model turns consumed (retry happened)
  });

  it("with the Parser OFF (SAM_PARSER=0 kill-switch), the same invalid call is NOT gated", async () => {
    process.env.SAM_PARSER = "0";
    replies.push('{"tool":"write_file","input":{"path":"~/notes.md"}}');   // invalid, but ungated
    const r = await runAgent("SYS", "save my notes", "local");
    expect(r.kind).toBe("pending");                                         // reaches approval un-validated (old behaviour)
  });
});

describe("the Grammar — a constrained local turn is a tool call or a {respond} final answer", () => {
  beforeEach(() => { process.env.SAM_GRAMMAR = "1"; });
  afterEach(() => { delete process.env.SAM_GRAMMAR; });

  it("unwraps a {respond} envelope into the plain final answer (never shows raw JSON)", async () => {
    replies.push('{"respond":"The time is noon, the user."}');
    const r = await runAgent("SYS", "what time is it?", "local");
    expect(r.kind).toBe("final");
    expect(r.text).toBe("The time is noon, the user.");     // unwrapped, not the raw JSON
  });

  it("still runs a constrained tool call, then unwraps the final answer", async () => {
    replies.push('{"tool":"get_datetime","input":{}}');     // constrained tool call
    replies.push('{"respond":"Done — it is noon."}');       // constrained final answer
    const r = await runAgent("SYS", "what time is it?", "local");
    expect(r.trace.length).toBe(1);                         // the tool ran
    expect(r.kind).toBe("final");
    expect(r.text).toBe("Done — it is noon.");
  });
});
