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
  streamModel: vi.fn(async (_t: string, _s: string, _p: string, onChunk?: (c: string) => void) => {
    const text = replies.shift() ?? "done"; onChunk?.(text); return { text, provider: "test", tier: "local" };
  }),
  // The Grammar reaches the brain whenever the LOCAL brain is the one generating (see models.ts).
  grammarReaches: vi.fn(async (tier: string) => tier === "local"),
}));

import { runAgent, runAgentStream, resumeAgent, parseToolCall, UNTRUSTED_SOURCE } from "./agent.ts";
import { CURTAIN_FALLBACK } from "./curtain.ts";
import { _reset as resetIssues, listIssues } from "./issues.ts";

beforeEach(() => { replies.length = 0; });

describe("parseToolCall — local recovery (avoids a model repair round-trip)", () => {
  // AUDIT FIX: every tool that returns attacker-influenced web content must be fenced as
  // UNTRUSTED, or a prompt-injection rides in unmarked. These readers were missing.
  it("fences ALL external-content web readers as untrusted", () => {
    for (const t of ["web_fetch", "web_search", "web_crawl", "web_extract", "web_research", "site_map", "research"]) {
      expect(UNTRUSTED_SOURCE.has(t), t).toBe(true);
    }
  });

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

describe("the Parser on the STREAMING path (runAgentStream) — parity with the loop", () => {
  beforeEach(() => { process.env.SAM_PARSER = "1"; resetIssues(); });
  afterEach(() => { delete process.env.SAM_PARSER; resetIssues(); });
  const collect = async (msg: string) => {
    const events: { type: string; [k: string]: any }[] = [];
    await runAgentStream("SYS", msg, "local", undefined, (e) => events.push(e as any));
    return events;
  };

  it("an invalid write_file is rejected — never emitted as a tool run or a pending approval", async () => {
    replies.push('{"tool":"write_file","input":{"path":"~/notes.md"}}');   // invalid: missing content
    replies.push("Alright, leaving it.");                                   // final answer
    const events = await collect("save my notes");
    expect(events.some((e) => e.type === "pending")).toBe(false);           // never surfaced to approve/run
    expect(events.some((e) => e.type === "tool")).toBe(false);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(listIssues().some((i) => /invalid tool call: write_file/.test(i.message))).toBe(true);
  });

  it("a VALID risky call still reaches the pending approval (not blocked by the Parser)", async () => {
    replies.push('{"tool":"write_file","input":{"path":"~/notes.md","content":"hi"}}');
    const events = await collect("save my notes");
    const pending = events.find((e) => e.type === "pending");
    expect(pending?.tool).toBe("write_file");
  });
});

describe("the Grammar on the STREAMING path (SAM_GRAMMAR_STREAM) — {respond} decoded as prose", () => {
  beforeEach(() => { process.env.SAM_GRAMMAR_STREAM = "1"; });
  afterEach(() => { delete process.env.SAM_GRAMMAR_STREAM; });
  const collect = async (msg: string) => { const ev: { type: string; [k: string]: any }[] = []; await runAgentStream("SYS", msg, "local", undefined, (e) => ev.push(e as any)); return ev; };

  it("streams a {respond} answer decoded as prose — never the raw JSON", async () => {
    replies.push('{"respond":"The time is noon."}');
    const ev = await collect("what time is it?");
    const streamed = ev.filter((e) => e.type === "token").map((e) => e.t).join("");
    expect(streamed).toBe("The time is noon.");
    expect(streamed).not.toContain('"respond"');                          // no raw JSON leaked to the user
    expect(ev.find((e) => e.type === "done")?.text).toBe("The time is noon.");
  });

  it("a constrained tool call streams nothing, runs, then the answer streams after", async () => {
    replies.push('{"tool":"get_datetime","input":{}}');                    // streams nothing (parsed + run)
    replies.push('{"respond":"Done — it is noon."}');
    const ev = await collect("what time is it?");
    expect(ev.some((e) => e.type === "tool")).toBe(true);                  // the tool ran
    expect(ev.filter((e) => e.type === "token").map((e) => e.t).join("")).toBe("Done — it is noon.");
  });
});

describe("the Grammar STREAM is default-ON, with a prose fallback when the brain ignores the constraint", () => {
  // No SAM_GRAMMAR_STREAM in the env — proves the flag defaults on (=0 is the kill-switch).
  const collect = async (msg: string) => { const ev: { type: string; [k: string]: any }[] = []; await runAgentStream("SYS", msg, "local", undefined, (e) => ev.push(e as any)); return ev; };

  it("a {respond} answer is decoded even with the flag unset (default on)", async () => {
    replies.push('{"respond":"Paris."}');
    const ev = await collect("capital of France?");
    expect(ev.filter((e) => e.type === "token").map((e) => e.t).join("")).toBe("Paris.");
    expect(ev.find((e) => e.type === "done")?.text).toBe("Paris.");
  });

  it("a brain that IGNORES the constraint (streams prose, not JSON) still streams token-by-token", async () => {
    replies.push("The capital of France is Paris.");                       // not JSON — constraint not honored
    const ev = await collect("capital of France?");
    const streamed = ev.filter((e) => e.type === "token").map((e) => e.t).join("");
    expect(streamed).toBe("The capital of France is Paris.");              // prose still reached the user live
    expect(ev.find((e) => e.type === "done")?.text).toBe("The capital of France is Paris.");
  });

  it("the =0 kill-switch turns the STREAM decoder off — and the envelope still never reaches the user", async () => {
    process.env.SAM_GRAMMAR_STREAM = "0";
    replies.push('{"respond":"Paris."}');                                  // off → not decoded live; detected as tool-mode
    const ev = await collect("capital of France?");
    const streamed = ev.filter((e) => e.type === "token").map((e) => e.t).join("");
    // THIS ASSERTION USED TO REQUIRE THE LEAK. It read `toContain('"respond"')` — the tool-mode
    // buffer held the JSON back from the live stream, then released it WHOLE at the end, so with the
    // decoder off the user was shown `{"respond":"Paris."}` as their answer. That is the same class
    // of bug as the one reported on 2026-08-12: SAM's protocol rendered as prose. The Curtain
    // suppresses the envelope on the way out, and `forUser` unwraps it rather than dropping it, so
    // the kill-switch now costs the LIVE decoding it names and nothing else.
    expect(streamed).not.toContain('"respond"');
    expect(ev.find((e) => e.type === "done")?.text).toBe("Paris.");        // the answer still arrives, whole
    delete process.env.SAM_GRAMMAR_STREAM;
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

// ─────────────────────────────────────────────────────────────
//  THE CURTAIN on the emit path — the bug this was written for.
//
//  Reported 2026-08-12 from a paired phone against a real SAM (local llama3.2:3b, no cloud keys):
//  the model's deliberation about which tool to call was rendered to the user as the answer. These
//  feed that exact text through the paths a user actually receives — the SSE stream and the
//  non-streaming loop — and assert the scaffolding is not in what they see.
// ─────────────────────────────────────────────────────────────
describe("the Curtain — scaffolding never reaches the user, whichever brain answered", () => {
  const LEAK =
    "Since we're out of scope in this moment and there's a missing piece to be found by running a " +
    "list_dir tool first — I'll give a clear, immediate answer using only plain text: Assistant apps " +
    "aren't available on Macs due to macOS security measures; SAM is an AI designed specifically for Mac.";
  const ASKED = "In three short bullets, what makes you different from a cloud assistant?";

  const stream = async (msg: string) => {
    const ev: { type: string; [k: string]: any }[] = [];
    await runAgentStream("SYS", msg, "local", undefined, (e) => ev.push(e as any));
    return {
      tokens: ev.filter((e) => e.type === "token").map((e) => e.t).join(""),
      done: ev.find((e) => e.type === "done")?.text ?? "",
    };
  };
  const assertClean = (text: string, label: string) => {
    expect(text, `${label}: names a tool`).not.toContain("list_dir");
    expect(text, `${label}: leaks the scope deliberation`).not.toMatch(/out of scope|missing piece/i);
    expect(text, `${label}: leaks the format instruction`).not.toMatch(/plain text/i);
  };

  it("STREAM: the emitted tokens and the done text both exclude the tool deliberation", async () => {
    replies.push(LEAK);
    const { tokens, done } = await stream(ASKED);
    assertClean(done, "done");
    assertClean(tokens, "tokens");                       // the live stream too — the user READS these as they land
    expect(done).toContain("macOS security measures");   // the answer that was hiding behind it survived
  });

  it("STREAM: caught even when the Grammar WAS honored (the preamble was inside {respond})", async () => {
    replies.push(JSON.stringify({ respond: LEAK }));
    const { tokens, done } = await stream(ASKED);
    assertClean(done, "done");
    assertClean(tokens, "tokens");
    expect(done).toContain("macOS security measures");
  });

  it("LOOP (non-streaming): the final answer excludes it too", async () => {
    replies.push(LEAK);
    const r = await runAgent("SYS", ASKED, "local");
    expect(r.kind).toBe("final");
    assertClean(r.text!, "final");
    expect(r.text).toContain("macOS security measures");
  });

  it("a turn that was ALL deliberation degrades to a plain answer, not to exposed internals", async () => {
    resetIssues();
    replies.push("I'll need to run list_dir first. Let me check the available tools before answering.");
    const r = await runAgent("SYS", ASKED, "local");
    expect(r.text).toBe(CURTAIN_FALLBACK);
    assertClean(r.text!, "fallback");
    // NO SILENT FAILURES: a brain that produced no answer is a real failure and gets recorded.
    expect(listIssues().some((i) => /stage direction/i.test(i.message))).toBe(true);
  });

  it("leaves an ordinary answer completely untouched", async () => {
    const clean = "SAM runs on your Mac. Nothing leaves the machine. It's free.";
    replies.push(clean);
    const { tokens, done } = await stream(ASKED);
    expect(done).toBe(clean);
    expect(tokens).toBe(clean);
  });

  it("SAM_CURTAIN=0 is the kill-switch — and it turns off the STREAM too, not just the done text", async () => {
    process.env.SAM_CURTAIN = "0";
    replies.push(LEAK);
    const r = await runAgent("SYS", ASKED, "local");
    expect(r.text).toContain("list_dir");                // off → the raw text, exactly as before

    // Found by running it: the switch used to reach `forUser` only, so the raw text came back in
    // `done` while the live stream was still being trimmed — half-off in both directions at once.
    replies.push(LEAK);
    const { tokens, done } = await stream(ASKED);
    expect(tokens).toContain("list_dir");
    expect(done).toContain("list_dir");
    delete process.env.SAM_CURTAIN;
  });

  it("LOCAL MICRO-SOLVER: solves arithmetic locally without calling model", async () => {
    const r = await runAgent("SYS", "calculate 100 * 25", "local");
    expect(r.kind).toBe("final");
    expect(r.text).toContain("2500");
    expect(r.provider).toBe("local-micro-solver");

    const { tokens, done } = await stream("1024 mb in gb");
    expect(done).toContain("1 GB");
    expect(tokens).toContain("1 GB");
  });
});
