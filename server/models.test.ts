import { describe, it, expect, vi, afterEach } from "vitest";
import { pickLane, localStaysOnDevice, streamModel } from "./models.ts";

function ndjsonBody(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= lines.length) { controller.close(); return; }
      controller.enqueue(enc.encode(`${lines[i++]}\n`));
    },
  });
}

// AUDIT FIX: the streaming path used to send Private/local-mode prompts to Groq/Gemini
// because it only excluded the "premium" tier. Local must stay on the machine, streaming or
// not — the same guarantee the non-streaming path already makes.
describe("Private mode never crosses to a cloud brain", () => {
  it("keeps the local tier on-device", () => {
    expect(localStaysOnDevice("local")).toBe(true);
  });
  it("lets free and premium reach cloud (they are not private)", () => {
    expect(localStaysOnDevice("free")).toBe(false);
    expect(localStaysOnDevice("premium")).toBe(false);
  });
});

// repetition.ts (isDegenerateRepetition/collapseRepetition) existed, was tested in isolation,
// and was never actually called from anywhere in the streaming path — a weak/quantized local
// Ollama model stuck in "hello hello hello…" would stream garbage right up to its 5-minute
// timeout with nothing to stop it. Wired into callOllamaStream 2026-08-15; this proves it from
// the public entry point (streamModel), not just that the guard function itself works.
describe("a degenerate Ollama loop gets cut off mid-stream, not just detected", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("stops forwarding chunks once a loop is detected, and returns collapsed text", async () => {
    const loopLines = Array.from({ length: 12 }, () => JSON.stringify({ message: { content: "hello there " } }));
    const lines = [...loopLines, JSON.stringify({ message: { content: "SHOULD_NOT_APPEAR" } })];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, body: ndjsonBody(lines) }),
    );

    const chunks: string[] = [];
    const r = await streamModel("local", "system", "prompt", (t) => chunks.push(t));

    const forwarded = chunks.join("");
    expect(forwarded).not.toContain("SHOULD_NOT_APPEAR");
    expect(r.text).not.toContain("SHOULD_NOT_APPEAR");
    // Collapsed to essentially one occurrence — nowhere near the 12x it would be uncollapsed.
    expect((r.text.match(/hello there/g) || []).length).toBeLessThanOrEqual(2);
  });
});

describe("pickLane — task-aware model routing", () => {
  it("quick chat → fast", () => {
    expect(pickLane("hey what's up")).toBe("fast");
    expect(pickLane("remind me to call mum")).toBe("fast");
  });

  it("code/debug → code", () => {
    expect(pickLane("debug this stack trace")).toBe("code");
    expect(pickLane("```js\nconst x = 1\n```  why does this break")).toBe("code");
    expect(pickLane("refactor my typescript function")).toBe("code");
  });

  it("reasoning/analysis → deep", () => {
    expect(pickLane("analyse the pros and cons of these two suppliers")).toBe("deep");
    expect(pickLane("compare the strategy here and explain why one wins")).toBe("deep");
  });

  it("long prompt → deep even without keywords", () => {
    expect(pickLane("x ".repeat(200))).toBe("deep");
  });

  it("handles empty/garbage safely", () => {
    expect(pickLane("")).toBe("fast");
    expect(pickLane(undefined as any)).toBe("fast");
  });
});
