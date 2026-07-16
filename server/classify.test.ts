import { describe, it, expect } from "vitest";
import { classify, route, selfCheckFailed, nextTierUp, CONTINUATION_RE } from "./classify.ts";

describe("classify", () => {
  it("greetings & acks are trivial → local + lean", () => {
    for (const m of ["hi", "hey", "thanks!", "thank you", "ok", "cheers"]) {
      const v = classify(m);
      expect(v.klass).toBe("trivial");
      expect(v.lean).toBe(true);
    }
  });

  // ANTI-AMNESIA: the exact failure from the field — "ok proceed with plan" came back
  // "there is no plan, this conversation just started". Continuation commands must NEVER be
  // classified lean (which drops memory) — they need the thread + agreed plan.
  it("continuation commands are never lean (proceed/continue/do step 1/1 then 2 then 3)", () => {
    for (const m of ["proceed", "continue", "ok proceed with the plan", "do step 1", "1 then 2 then 3", "finish it", "complete until done", "keep going", "next step", "go ahead"]) {
      expect(CONTINUATION_RE.test(m), `CONTINUATION_RE should match "${m}"`).toBe(true);
      expect(classify(m).lean, `"${m}" must not be lean`).toBe(false);
    }
  });

  it("bare acknowledgements stay trivial (not swept up as continuations)", () => {
    // "thanks"/"cheers" carry no continuation intent — the token diet still applies to them.
    expect(CONTINUATION_RE.test("thanks")).toBe(false);
    expect(CONTINUATION_RE.test("cheers mate")).toBe(false);
  });

  it("simple maths is trivial", () => {
    expect(classify("what's 12 * 8?").klass).toBe("trivial");
    expect(classify("15% of 200").klass).toBe("trivial");
  });

  it("short generation one-liners are trivial", () => {
    expect(classify("translate 'good morning' to French").klass).toBe("trivial");
  });

  it("live/current-info requests need tools (never trivial)", () => {
    for (const m of ["what's the weather in London today?", "search the web for X", "what time is it in Tokyo right now?"]) {
      expect(classify(m).klass).toBe("needs-tools");
    }
  });

  it("heavy reasoning is hard", () => {
    expect(classify("analyze the pros and cons of remote work").klass).toBe("hard");
    expect(classify("think through whether to raise or bootstrap").klass).toBe("hard");
  });

  it("everything else is standard", () => {
    expect(classify("draft a 3 paragraph essay about the history of tea and its trade routes across asia").klass).toBe("standard");
  });
});

describe("route (free-first)", () => {
  it("trivial → local", () => { expect(route("hi").tier).toBe("local"); });
  it("standard/needs-tools → free", () => {
    expect(route("what's the weather today?").tier).toBe("free");
  });
  it("hard stays FREE by default (free-first), premium only on opt-in", () => {
    expect(route("analyze the trade-offs of microservices").tier).toBe("free");
    expect(route("analyze the trade-offs of microservices", { allowPremium: true }).tier).toBe("premium");
  });
  it("an explicit user tier always wins", () => {
    expect(route("hi", { userTier: "premium" }).tier).toBe("premium");
    expect(route("analyze X", { userTier: "local" }).tier).toBe("local");
  });
  it("hard/needs-tools use the deep lane; trivial/standard use fast", () => {
    expect(route("analyze X").lane).toBe("deep");
    expect(route("what's the weather?").lane).toBe("deep");
    expect(route("hi").lane).toBe("fast");
  });
});

describe("selfCheckFailed", () => {
  it("flags empty, refusal, brain-error, and echo", () => {
    expect(selfCheckFailed("")).toBe(true);
    expect(selfCheckFailed("ok")).toBe(true);   // < 8 chars
    expect(selfCheckFailed("I can't help with that.")).toBe(true);
    expect(selfCheckFailed("Sorry — I couldn't reach a brain just now.")).toBe(true);
    expect(selfCheckFailed("what is a semaphore?", "what is a semaphore?")).toBe(true);
  });
  it("passes a normal, complete answer", () => {
    expect(selfCheckFailed("A semaphore is a synchronisation primitive that limits concurrent access.")).toBe(false);
  });
});

describe("nextTierUp", () => {
  it("local → free always; free → premium only when allowed", () => {
    expect(nextTierUp("local", false)).toBe("free");
    expect(nextTierUp("free", false)).toBe(null);
    expect(nextTierUp("free", true)).toBe("premium");
    expect(nextTierUp("premium", true)).toBe(null);
  });
});
