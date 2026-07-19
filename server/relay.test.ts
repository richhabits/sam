import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPool } from "./keys.ts";
import { _resetBreakers, breakerStatus, canAttempt, relayBrain, type Brain } from "./relay.ts";

// The Relay's guarantees. The critical one first: a request that must stay local can NEVER cross to
// a cloud brain — it's refused explicitly, and the cloud brain's run() is never even called. Plus:
// the Breaker opens after repeated failure (fail fast), half-opens after a cooldown, and closes on a
// success; a 4xx-that-isn't-429 stops hammering; a thrown call (e.g. a timeout) counts as a failure.

const COOLDOWN = 30_000;
beforeEach(() => _resetBreakers());
afterEach(() => _resetBreakers());

function brain(over: Partial<Brain> & { id: string; boundary: "local" | "cloud" }): Brain {
  return { run: async () => "ok", ...over };
}

describe("the boundary — no silent local→cloud crossing", () => {
  it("refuses a cloud brain when the request must stay local — and never calls run()", async () => {
    const run = vi.fn(async () => "leaked to cloud");
    const r = await relayBrain(brain({ id: "groq", boundary: "cloud", noKey: true, run }), "s", "p", { allowCloud: false });
    expect(r).toEqual({ ok: false, error: { kind: "blocked", brain: "groq", detail: expect.stringMatching(/refused to cross to cloud/) } });
    expect(run).not.toHaveBeenCalled(); // the invariant: the call never happened
  });

  it("allows a cloud brain when crossing is permitted", async () => {
    const r = await relayBrain(brain({ id: "groq", boundary: "cloud", noKey: true }), "s", "p", { allowCloud: true });
    expect(r).toEqual({ ok: true, value: "ok" });
  });

  it("a local brain always runs — the boundary only gates the cloud direction", async () => {
    const r = await relayBrain(brain({ id: "ollama", boundary: "local", noKey: true }), "s", "p", { allowCloud: false });
    expect(r).toEqual({ ok: true, value: "ok" });
  });
});

describe("the Breaker — fail fast, then recover", () => {
  const failing = (run: () => Promise<string>) => brain({ id: "flaky", boundary: "cloud", noKey: true, run });

  it("opens after 3 brain-level failures and then skips without calling run()", async () => {
    const run = vi.fn(async () => { throw new Error("down"); });
    for (let i = 0; i < 3; i++) await relayBrain(failing(run), "s", "p", { allowCloud: true }, { retryDelayMs: 0 });
    expect(breakerStatus("flaky")).toBe("open");
    const callsBefore = run.mock.calls.length;
    const r = await relayBrain(failing(run), "s", "p", { allowCloud: true }, { retryDelayMs: 0 });
    expect(r).toEqual({ ok: false, error: { kind: "breaker-open", brain: "flaky" } });
    expect(run.mock.calls.length).toBe(callsBefore); // failed fast — run was NOT called
  });

  it("half-opens after the cooldown and closes on a success", async () => {
    const down = vi.fn(async () => { throw new Error("down"); });
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) await relayBrain(failing(down), "s", "p", { allowCloud: true }, { retryDelayMs: 0, now: t0 });
    expect(breakerStatus("flaky", t0)).toBe("open");
    const later = t0 + COOLDOWN + 1;
    expect(breakerStatus("flaky", later)).toBe("half-open");
    expect(canAttempt("flaky", later)).toBe(true); // the probe is allowed
    const r = await relayBrain(brain({ id: "flaky", boundary: "cloud", noKey: true, run: async () => "back" }), "s", "p", { allowCloud: true }, { now: later });
    expect(r).toEqual({ ok: true, value: "back" });
    expect(breakerStatus("flaky", later)).toBe("closed"); // success closed it
  });

  it("a single success resets the failure count (no premature trip)", async () => {
    let n = 0;
    const flappy = brain({ id: "flaky", boundary: "cloud", noKey: true, run: async () => { n++; if (n === 2) return "ok"; throw new Error("blip"); } });
    await relayBrain(flappy, "s", "p", { allowCloud: true }, { retryDelayMs: 0 }); // fail
    await relayBrain(flappy, "s", "p", { allowCloud: true }, { retryDelayMs: 0 }); // success → resets
    await relayBrain(brain({ id: "flaky", boundary: "cloud", noKey: true, run: async () => { throw new Error("x"); } }), "s", "p", { allowCloud: true }, { retryDelayMs: 0 });
    expect(breakerStatus("flaky")).toBe("closed"); // 1 fail after reset, nowhere near the trip
  });
});

describe("keyed brains — pool + retry + stop-hammering", () => {
  it("a thrown call (timeout etc.) is a failure; a 4xx-that-isn't-429 stops after one attempt", async () => {
    setPool("prov", ["k1", "k2", "k3"]);
    const run = vi.fn(async () => { const e = new Error("bad request") as Error & { status: number }; e.status = 400; throw e; });
    const r = await relayBrain(brain({ id: "prov", boundary: "cloud", run }), "s", "p", { allowCloud: true });
    expect(r).toEqual({ ok: false, error: { kind: "failed", brain: "prov" } });
    expect(run).toHaveBeenCalledTimes(1); // 400 = bad key/request → don't burn the other keys
  });

  it("a 429 rotates through the pool (transient — try the other keys)", async () => {
    setPool("prov2", ["k1", "k2"]);
    const run = vi.fn(async () => { const e = new Error("rate") as Error & { status: number }; e.status = 429; throw e; });
    await relayBrain(brain({ id: "prov2", boundary: "cloud", run }), "s", "p", { allowCloud: true });
    expect(run).toHaveBeenCalledTimes(2); // tried both keys before giving up
  });

  it("a success returns the text and keeps the brain closed", async () => {
    setPool("prov3", ["k1"]);
    const r = await relayBrain(brain({ id: "prov3", boundary: "cloud", run: async () => "answer" }), "s", "p", { allowCloud: true });
    expect(r).toEqual({ ok: true, value: "answer" });
    expect(breakerStatus("prov3")).toBe("closed");
  });

  it("a brain with NO key doesn't trip the Breaker — no attempt is not a failure", async () => {
    setPool("empty", []); // no keys configured
    const run = vi.fn(async () => "x");
    for (let i = 0; i < 5; i++) await relayBrain(brain({ id: "empty", boundary: "cloud", run }), "s", "p", { allowCloud: true });
    expect(run).not.toHaveBeenCalled();
    expect(breakerStatus("empty")).toBe("closed"); // never opened despite 5 calls — nothing was attempted
  });
});

describe("streaming — maxKeys:1 so a stream is never retried mid-emit", () => {
  it("tries exactly ONE key even with a multi-key pool (a retry would double-emit tokens)", async () => {
    setPool("streamer", ["k1", "k2", "k3"]);
    const run = vi.fn(async () => { const e = new Error("mid-stream drop") as Error & { status: number }; e.status = 500; throw e; });
    const r = await relayBrain(brain({ id: "streamer", boundary: "cloud", run }), "s", "p", { allowCloud: true }, { maxKeys: 1 });
    expect(r).toEqual({ ok: false, error: { kind: "failed", brain: "streamer" } });
    expect(run).toHaveBeenCalledTimes(1); // NOT 3 — a partially-emitted stream must not re-run on another key
  });
});
