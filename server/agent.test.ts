// ─────────────────────────────────────────────────────────────
//  S.A.M. · agent loop tests  (model mocked — no network)
//  Verifies: safe tools auto-run, risky tools pause for approval,
//  approval resumes, decline is respected.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the model so we script exactly what "SAM" replies each step.
const replies: string[] = [];
vi.mock("./models.ts", () => ({
  runModel: vi.fn(async () => ({ text: replies.shift() ?? "done", provider: "test", tier: "local" })),
}));

import { runAgent, resumeAgent, parseToolCall } from "./agent.ts";

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
