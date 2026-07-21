import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JobStore } from "./store.ts";
import {
  canTransition, assertTransition, isClaimForfeit, isRetryable, backoffMs,
  overBudget, isTerminal, HEARTBEAT_GRACE_MS, MAX_ATTEMPTS,
} from "./state.ts";

describe("job state rules", () => {
  it("allows only the transitions that make sense", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "done")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(true);
    expect(canTransition("failed", "queued")).toBe(true);      // retry
    expect(canTransition("queued", "done")).toBe(false);       // nothing ran
    expect(canTransition("done", "running")).toBe(false);      // finished is finished
    expect(canTransition("cancelled", "running")).toBe(false);
  });

  it("throws rather than quietly ignoring an illegal move", () => {
    expect(() => assertTransition("done", "running")).toThrow(/cannot go from done to running/);
  });

  it("knows which states are the end of the road", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("running")).toBe(false);
  });

  it("treats an unrenewed claim as forfeit, but only past the grace period", () => {
    const now = 1_000_000;
    const base = { state: "running" as const, startedAt: now - 60_000 };
    expect(isClaimForfeit({ ...base, heartbeatAt: now - 5_000 }, now)).toBe(false);
    expect(isClaimForfeit({ ...base, heartbeatAt: now - (HEARTBEAT_GRACE_MS + 1_000) }, now)).toBe(true);
  });

  it("judges a job that never heartbeated from when it started", () => {
    const now = 1_000_000;
    expect(isClaimForfeit({ state: "running", heartbeatAt: null, startedAt: now - 1_000 }, now)).toBe(false);
    expect(isClaimForfeit({ state: "running", heartbeatAt: null, startedAt: now - 60_000 }, now)).toBe(true);
    // running with no clock at all can never be renewed by anyone
    expect(isClaimForfeit({ state: "running", heartbeatAt: null, startedAt: null }, now)).toBe(true);
  });

  it("never calls a queued or finished job forfeit", () => {
    const now = 1_000_000;
    for (const state of ["queued", "done", "failed", "cancelled"] as const) {
      expect(isClaimForfeit({ state, heartbeatAt: 0, startedAt: 0 }, now)).toBe(false);
    }
  });

  it("retries only faults, never decisions", () => {
    expect(isRetryable("transient", 1)).toBe(true);
    expect(isRetryable("abandoned", 1)).toBe(true);
    expect(isRetryable("budget", 1)).toBe(false);       // a limit was chosen
    expect(isRetryable("permanent", 1)).toBe(false);
    expect(isRetryable("transient", MAX_ATTEMPTS)).toBe(false);
  });

  it("backs off, but caps so a retry never lands past anyone's attention", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(99)).toBe(30_000);
  });

  it("treats an unset ceiling as no ceiling", () => {
    expect(overBudget(1e9, null)).toBe(false);
    expect(overBudget(1e9, 0)).toBe(false);
    expect(overBudget(99, 100)).toBe(false);
    expect(overBudget(100, 100)).toBe(true);
  });
});

describe("the job table", () => {
  let s: JobStore;
  beforeEach(() => { s = new JobStore(":memory:"); });
  afterEach(() => s.close());

  it("enqueues a job that is ready to be claimed", () => {
    const j = s.enqueue("build", { site: "hello" }, { budget: 500 });
    expect(j.state).toBe("queued");
    expect(j.payload).toEqual({ site: "hello" });
    expect(j.costBudget).toBe(500);
    expect(s.queueDepth()).toBe(1);
  });

  it("claims the oldest job first and marks it running", () => {
    const first = s.enqueue("a", {}, { now: 1000 });
    s.enqueue("b", {}, { now: 2000 });
    const claimed = s.claim(3000)!;
    expect(claimed.id).toBe(first.id);
    expect(claimed.state).toBe("running");
    expect(claimed.attempts).toBe(1);
    expect(claimed.startedAt).toBe(3000);
  });

  it("hands a job to exactly one of two racing workers", () => {
    s.enqueue("only-one");
    const a = s.claim();
    const b = s.claim();
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("gives nothing when the queue is empty", () => {
    expect(s.claim()).toBeNull();
  });

  it("runs a job through to done", () => {
    const j = s.enqueue("k");
    s.claim();
    const done = s.finish(j.id);
    expect(done.state).toBe("done");
    expect(done.finishedAt).toBeGreaterThan(0);
  });

  it("refuses to finish a job that never started", () => {
    const j = s.enqueue("k");
    expect(() => s.finish(j.id)).toThrow(/cannot go from queued to done/);
  });

  it("records the heartbeat that keeps a claim alive", () => {
    const j = s.enqueue("k");
    s.claim(1000);
    s.heartbeat(j.id, 9000);
    expect(s.get(j.id)!.heartbeatAt).toBe(9000);
  });

  // ── cancel ────────────────────────────────────────────────────────────────
  it("cancels a queued job outright, since nobody is mid-step", () => {
    const j = s.enqueue("k");
    expect(s.cancel(j.id).state).toBe("cancelled");
  });

  it("asks a running job to stop rather than shooting it", () => {
    const j = s.enqueue("k");
    s.claim();
    const after = s.cancel(j.id);
    expect(after.state).toBe("running");          // still running…
    expect(after.cancelRequested).toBe(true);     // …but told to stop
    expect(s.isCancelRequested(j.id)).toBe(true);
    expect(s.acknowledgeCancel(j.id).state).toBe("cancelled");
  });

  it("does not hand out a job that was cancelled before it ran", () => {
    const j = s.enqueue("k");
    s.cancel(j.id);
    expect(s.claim()).toBeNull();
    expect(s.get(j.id)!.state).toBe("cancelled");
  });

  // ── the meter ─────────────────────────────────────────────────────────────
  it("accumulates spend without stopping under the ceiling", () => {
    const j = s.enqueue("k", {}, { budget: 100 });
    s.claim();
    expect(s.addCost(j.id, 40)).toEqual({ spent: 40, stopped: false });
    expect(s.get(j.id)!.state).toBe("running");
  });

  it("stops the job hard the moment the ceiling is crossed", () => {
    const j = s.enqueue("k", {}, { budget: 100 });
    s.claim();
    s.addCost(j.id, 60);
    const r = s.addCost(j.id, 60);
    expect(r.stopped).toBe(true);
    const after = s.get(j.id)!;
    expect(after.state).toBe("failed");
    expect(after.failureKind).toBe("budget");
    expect(after.lastError).toMatch(/budget of 100/);
  });

  it("never stops a job that was given no ceiling", () => {
    const j = s.enqueue("k", {}, { budget: null });
    s.claim();
    expect(s.addCost(j.id, 10_000_000).stopped).toBe(false);
    expect(s.get(j.id)!.state).toBe("running");
  });

  // ── retry ─────────────────────────────────────────────────────────────────
  it("requeues a transient failure, after a wait", () => {
    const j = s.enqueue("k");
    s.claim(1000);
    s.fail(j.id, "network went away", "transient", 2000);
    const again = s.retry(j.id, 2000)!;
    expect(again.state).toBe("queued");
    expect(again.runAfter).toBeGreaterThan(2000);
    expect(s.claim(2000)).toBeNull();               // not yet — it is waiting
    expect(s.claim(2000 + 60_000)!.id).toBe(j.id);  // later, yes
  });

  it("refuses to retry a budget stop or a permanent fault", () => {
    const a = s.enqueue("a"); s.claim(); s.fail(a.id, "over", "budget");
    expect(s.retry(a.id)).toBeNull();
    const b = s.enqueue("b"); s.claim(); s.fail(b.id, "bad payload", "permanent");
    expect(s.retry(b.id)).toBeNull();
  });

  it("gives up after the attempt cap", () => {
    const j = s.enqueue("k");
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const claimed = s.claim(1000 + i * 100_000);
      expect(claimed).not.toBeNull();
      s.fail(j.id, "flaky", "transient");
      if (i < MAX_ATTEMPTS - 1) expect(s.retry(j.id, 1000 + i * 100_000)).not.toBeNull();
    }
    expect(s.retry(j.id)).toBeNull();
    expect(s.get(j.id)!.attempts).toBe(MAX_ATTEMPTS);
  });

  it("resumes a budget stop only when given a genuinely larger ceiling", () => {
    const j = s.enqueue("k", {}, { budget: 100 });
    s.claim();
    s.addCost(j.id, 150);
    expect(s.get(j.id)!.state).toBe("failed");
    expect(s.raiseBudgetAndRequeue(j.id, 120)).toBeNull();   // below what it already spent
    const resumed = s.raiseBudgetAndRequeue(j.id, 500)!;
    expect(resumed.state).toBe("queued");
    expect(resumed.costBudget).toBe(500);
  });

  // ── recovery: the reason heartbeats exist ────────────────────────────────
  it("reaps a job whose worker died, instead of letting it haunt the queue", () => {
    const j = s.enqueue("k");
    s.claim(1000);
    s.heartbeat(j.id, 1000);
    const later = 1000 + HEARTBEAT_GRACE_MS + 5000;
    const reaped = s.reapAbandoned(later);
    expect(reaped.map((r) => r.id)).toEqual([j.id]);
    const after = s.get(j.id)!;
    expect(after.state).toBe("failed");
    expect(after.failureKind).toBe("abandoned");
    expect(after.lastError).toMatch(/stopped reporting/);
  });

  it("leaves a job alone while its worker is still reporting", () => {
    const j = s.enqueue("k");
    s.claim(1000);
    s.heartbeat(j.id, 20_000);
    expect(s.reapAbandoned(25_000)).toEqual([]);
    expect(s.get(j.id)!.state).toBe("running");
  });

  it("lets a reaped job be retried, because dying is a fault not a decision", () => {
    const j = s.enqueue("k");
    s.claim(1000);
    const later = 1000 + HEARTBEAT_GRACE_MS + 5000;
    s.reapAbandoned(later);
    expect(s.retry(j.id, later)).not.toBeNull();
  });

  it("survives a restart: a fresh store over the same file sees the same jobs", () => {
    // (in-memory stands in for the file here; the point is that state lives in the
    // table and not in the process that wrote it)
    const j = s.enqueue("k");
    s.claim(1000);
    const seen = new JobStore(":memory:");   // a genuinely separate database
    expect(seen.get(j.id)).toBeNull();
    seen.close();
    expect(s.get(j.id)!.state).toBe("running");
  });

  it("reports a summary the ops view can render", () => {
    s.enqueue("a"); s.enqueue("b");
    const running = s.claim(1000)!;
    s.addCost(running.id, 25);
    const sum = s.summary(1000);
    expect(sum.queued).toBe(1);
    expect(sum.running).toBe(1);
    expect(sum.current?.id).toBe(running.id);
    expect(sum.current?.costTokens).toBe(25);
    expect(sum.current?.stale).toBe(false);
  });
});
