import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore } from "./store.ts";

// playbook.run drives the real agent loop — stubbed here so its tests exercise the
// job-kind's OWN logic (the step, the cost estimate, the unattended-Ask path) without a
// real model call. handleUnattended's own decision logic already has dedicated coverage
// in ask.test.ts; this only needs it to actually be called correctly.
const agentResult: { kind: "final" | "pending"; text?: string; tool?: string; input?: any; transcript?: string; trace: string[] } =
  { kind: "final", text: "did the thing", trace: [] };
vi.mock("../agent.ts", () => ({ runAgent: async () => agentResult }));

import { runOneJob, registerHandler, HANDLERS, JobStopped, claimLock, releaseLock } from "./worker.ts";

// Every path through the worker must end in a written outcome. A worker that returns
// without recording anything leaves a job `running` for ever, which is the failure the
// heartbeat exists to catch — better still not to create it.

let dir: string;
let store: JobStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yard-test-"));
  process.env.YARD_DIR = dir;
  store = new JobStore(":memory:");
});
afterEach(() => {
  store.close();
  delete process.env.YARD_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("running one job", () => {
  it("does nothing and says so when the queue is empty", async () => {
    expect(await runOneJob(store)).toBeNull();
  });

  it("carries a job through to done", async () => {
    registerHandler("ok", async () => "finished");
    const j = store.enqueue("ok");
    await runOneJob(store);
    expect(store.get(j.id)!.state).toBe("done");
  });

  it("hands the handler its payload", async () => {
    let seen: any = null;
    registerHandler("echo", async (ctx) => { seen = ctx.payload; });
    store.enqueue("echo", { hello: "yard" });
    await runOneJob(store);
    expect(seen).toEqual({ hello: "yard" });
  });

  it("fails the job when the handler throws, and keeps the reason", async () => {
    registerHandler("boom", async () => { throw new Error("the build fell over"); });
    const j = store.enqueue("boom");
    await runOneJob(store);
    const after = store.get(j.id)!;
    expect(after.state).toBe("failed");
    expect(after.failureKind).toBe("transient");     // a fault — worth another go
    expect(after.lastError).toMatch(/fell over/);
  });

  it("treats an unknown kind as permanent, since retrying cannot help", async () => {
    const j = store.enqueue("no-such-kind");
    await runOneJob(store);
    const after = store.get(j.id)!;
    expect(after.state).toBe("failed");
    expect(after.failureKind).toBe("permanent");
    expect(after.lastError).toMatch(/no handler/);
    expect(store.retry(j.id)).toBeNull();
  });

  it("stops mid-step when the operator cancels", async () => {
    registerHandler("longish", async (ctx) => {
      store.cancel(ctx.id);      // the operator, arriving mid-job
      ctx.checkStop();
      throw new Error("should never get here");
    });
    const j = store.enqueue("longish");
    await runOneJob(store);
    expect(store.get(j.id)!.state).toBe("cancelled");
  });

  it("stops the moment spending crosses the ceiling", async () => {
    registerHandler("spendy", async (ctx) => {
      ctx.spend(60);
      ctx.spend(60);            // this is the one that crosses 100
      throw new Error("should never get here");
    });
    const j = store.enqueue("spendy", {}, { budget: 100 });
    await runOneJob(store);
    const after = store.get(j.id)!;
    expect(after.state).toBe("failed");
    expect(after.failureKind).toBe("budget");
    expect(after.costTokens).toBe(120);
  });

  it("records spend even on a job that then fails for another reason", async () => {
    registerHandler("halfway", async (ctx) => { ctx.spend(30); throw new Error("network"); });
    const j = store.enqueue("halfway", {}, { budget: 1000 });
    await runOneJob(store);
    expect(store.get(j.id)!.costTokens).toBe(30);
    expect(store.get(j.id)!.state).toBe("failed");
  });

  it("never leaves a job running, whatever the handler does", async () => {
    const outcomes = ["done", "failed", "cancelled"];
    registerHandler("t-ok", async () => "x");
    registerHandler("t-throw", async () => { throw new Error("x"); });
    registerHandler("t-cancel", async (ctx) => { store.cancel(ctx.id); ctx.checkStop(); });
    for (const kind of ["t-ok", "t-throw", "t-cancel"]) {
      const j = store.enqueue(kind);
      await runOneJob(store);
      expect(outcomes).toContain(store.get(j.id)!.state);
    }
  });

  it("writes a log for the job it ran", async () => {
    registerHandler("chatty", async (ctx) => { ctx.log("first thing"); ctx.log("second thing"); });
    const j = store.enqueue("chatty");
    await runOneJob(store);
    const path = store.get(j.id)!.logPath!;
    expect(path).toContain(j.id);
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/first thing/);
    expect(text).toMatch(/second thing/);
    expect(text).toMatch(/claimed chatty/);
  });

  it("ships a sleep handler for proving the spine under load", async () => {
    expect(typeof HANDLERS.sleep).toBe("function");
    const j = store.enqueue("sleep", { seconds: 0 });
    await runOneJob(store);
    expect(store.get(j.id)!.state).toBe("done");
  });
});

describe("single flight", () => {
  it("lets one worker hold the lock and turns the next one away", () => {
    expect(claimLock()).toBe(true);
    // A second holder with a different, living pid is refused. Simulated by writing a
    // lock owned by a pid that is definitely alive but is not us: the test runner's parent.
    const { writeFileSync } = require("node:fs");
    const { join: j } = require("node:path");
    writeFileSync(j(dir, "worker.lock"), JSON.stringify({ pid: process.ppid, at: Date.now() }));
    expect(claimLock()).toBe(false);
  });

  it("takes over a lock left behind by a process that is gone", () => {
    const { writeFileSync } = require("node:fs");
    const { join: j } = require("node:path");
    writeFileSync(j(dir, "worker.lock"), JSON.stringify({ pid: 999_999_999, at: Date.now() }));
    expect(claimLock()).toBe(true);
    releaseLock();
  });

  it("takes over a lock that is simply too old", () => {
    const { writeFileSync } = require("node:fs");
    const { join: j } = require("node:path");
    writeFileSync(j(dir, "worker.lock"), JSON.stringify({ pid: process.ppid, at: Date.now() - 10 * 60_000 }));
    expect(claimLock()).toBe(true);
    releaseLock();
  });
});

describe("the stop signal", () => {
  it("names why it stopped", () => {
    expect(new JobStopped("budget").why).toBe("budget");
    expect(new JobStopped("cancelled").message).toMatch(/cancelled/);
  });
});

// ── the two bugs the first live drive found ─────────────────────────────────
describe("a handler that pegs a core", () => {
  it("keeps its claim alive through the stop-check, not a timer", async () => {
    // A busy handler blocks this process's timers, so the interval heartbeat never
    // fires. checkStop() must renew the claim itself or the reaper kills a healthy job.
    let firstBeat: number | null = null;
    registerHandler("busy", async (ctx) => {
      firstBeat = store.get(ctx.id)!.heartbeatAt;
      await new Promise((r) => setTimeout(r, 5));
      ctx.checkStop();                       // the only renewal a blocked handler gets
      const after = store.get(ctx.id)!.heartbeatAt!;
      expect(after).toBeGreaterThanOrEqual(firstBeat!);
    });
    const j = store.enqueue("busy");
    await runOneJob(store);
    expect(store.get(j.id)!.state).toBe("done");
  });

  it("says it was lost, not over budget, when its row moved underneath it", async () => {
    registerHandler("reaped", async (ctx) => {
      // simulate the reaper taking the job while the handler works
      store.fail(ctx.id, "the worker stopped reporting", "abandoned");
      ctx.checkStop();
      throw new Error("should never get here");
    });
    const j = store.enqueue("reaped", {}, { budget: 999_999 });
    await runOneJob(store);
    const after = store.get(j.id)!;
    expect(after.failureKind).toBe("abandoned");     // NOT budget
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(after.logPath!, "utf8");
    expect(text).toMatch(/stopped: lost/);
    expect(text).not.toMatch(/stopped: budget/);
  });
});

describe("a worker whose server has gone", () => {
  // Killing a server used to leave its worker running, reparented to init — one orphan
  // per restart, each still claiming jobs and holding the lock.
  it("stands down instead of running on for ever", async () => {
    const { workerLoop } = await import("./worker.ts");
    let rounds = 0;
    await workerLoop(store, { isOrphaned: () => { rounds++; return true; } });
    expect(rounds).toBe(1);          // noticed on the very first pass
  });

  it("keeps working while its server is alive", async () => {
    const { workerLoop } = await import("./worker.ts");
    let rounds = 0;
    await workerLoop(store, { isOrphaned: () => false, stop: () => ++rounds > 2 });
    expect(rounds).toBeGreaterThan(1);
  });

  it("knows an orphan by its parent", async () => {
    const { orphaned } = await import("./worker.ts");
    expect(orphaned()).toBe(process.ppid === 1);   // this test process has a real parent
  });
});

// A3 — the live plan/checklist. Steps come from the job itself (ctx.step), never a model
// guessing after the fact; these prove the state transitions the UI's checklist depends on.
describe("the checklist (ctx.step)", () => {
  it("a step is 'running' until the next one starts, then 'done'", async () => {
    registerHandler("plan", async (ctx) => {
      ctx.step("first");
      expect(store.get(ctx.id)!.steps).toEqual([{ label: "first", state: "running", at: expect.any(Number) }]);
      ctx.step("second");
      const after = store.get(ctx.id)!.steps;
      expect(after[0]).toMatchObject({ label: "first", state: "done" });
      expect(after[1]).toMatchObject({ label: "second", state: "running" });
    });
    const j = store.enqueue("plan");
    await runOneJob(store);
    expect(store.get(j.id)!.state).toBe("done");
  });

  it("the last step is finished 'done' when the job succeeds", async () => {
    registerHandler("plan-ok", async (ctx) => { ctx.step("only step"); });
    const j = store.enqueue("plan-ok");
    await runOneJob(store);
    const steps = store.get(j.id)!.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].state).toBe("done");
  });

  it("the step in progress is marked 'failed' with the error, when the handler throws", async () => {
    registerHandler("plan-fail", async (ctx) => {
      ctx.step("the step that breaks");
      throw new Error("it broke here specifically");
    });
    const j = store.enqueue("plan-fail");
    await runOneJob(store);
    const steps = store.get(j.id)!.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].state).toBe("failed");
    expect(steps[0].error).toMatch(/broke here specifically/);
  });

  it("the step in progress is marked 'stopped', not 'failed', on a cancel", async () => {
    registerHandler("plan-cancel", async (ctx) => {
      ctx.step("about to be cancelled");
      store.cancel(ctx.id);
      ctx.checkStop();   // throws JobStopped("cancelled")
    });
    const j = store.enqueue("plan-cancel");
    await runOneJob(store);
    const steps = store.get(j.id)!.steps;
    expect(steps[0].state).toBe("stopped");
    expect(store.get(j.id)!.state).toBe("cancelled");
  });

  it("a handler that never calls ctx.step leaves an empty checklist, not an error", async () => {
    registerHandler("no-plan", async () => "fine without one");
    const j = store.enqueue("no-plan");
    await runOneJob(store);
    expect(store.get(j.id)!.steps).toEqual([]);
    expect(store.get(j.id)!.state).toBe("done");
  });

  it("a retry starts with a clean checklist, not the failed attempt's steps", async () => {
    registerHandler("plan-retry", async (ctx) => {
      ctx.step("will fail this attempt");
      throw new Error("transient hiccup");
    });
    const j = store.enqueue("plan-retry");
    await runOneJob(store);
    expect(store.get(j.id)!.steps[0].state).toBe("failed");
    const retried = store.retry(j.id);
    expect(retried!.steps).toEqual([]);
  });
});

// A4 — the Playbook. A saved, rendered prompt runs through the same agent loop the chat
// UI uses, unattended, as a yard job. runAgent is stubbed (see the vi.mock above); these
// tests are about THIS job kind's own behaviour, not the agent loop's.
describe("playbook.run", () => {
  it("refuses a run with no rendered prompt — permanent, not worth retrying", async () => {
    const j = store.enqueue("playbook.run", {});
    await runOneJob(store);
    const after = store.get(j.id)!;
    expect(after.state).toBe("failed");
    expect(after.failureKind).toBe("permanent");
    expect(after.lastError).toMatch(/needs a rendered prompt/);
  });

  it("a final answer finishes the job and logs the answer", async () => {
    agentResult.kind = "final";
    agentResult.text = "shipped the launch post";
    delete process.env.DEFAULT_TIER;   // defaults to "free" — real attribution, not a guess
    const j = store.enqueue("playbook.run", { prompt: "write a launch post" });
    await runOneJob(store);
    const after = store.get(j.id)!;
    expect(after.state).toBe("done");
    expect(after.steps[0]).toMatchObject({ label: "working", state: "done" });
    expect(after.costTokens).toBeGreaterThan(0);   // the rough estimate, not zero
    expect(after.tier).toBe("free");   // A6 — real tier attribution, not invented
    const log = readFileSync(after.logPath!, "utf8");
    expect(log).toMatch(/shipped the launch post/);
  });

  it("a pending (risky) action is deferred as an Ask, not silently dropped or falsely reported done", async () => {
    agentResult.kind = "pending";
    agentResult.text = undefined;
    agentResult.tool = "send_email";
    agentResult.input = { to: "someone@example.com" };
    agentResult.transcript = "opaque-resume-state";
    delete process.env.SAM_ASK;   // ON by default (SAM_ASK=0 is the kill switch) — ensure that default holds for this test
    const j = store.enqueue("playbook.run", { prompt: "email the investor update" });
    await runOneJob(store);
    const after = store.get(j.id)!;
    expect(after.state).toBe("done");   // deferring IS the job's legitimate outcome
    expect(after.steps.at(-1)).toMatchObject({ label: "needs your OK", state: "done" });
    const log = readFileSync(after.logPath!, "utf8");
    expect(log).toMatch(/Deferred/);
    // restore for any later test in this file
    agentResult.kind = "final"; agentResult.text = "did the thing";
    agentResult.tool = undefined; agentResult.input = undefined; agentResult.transcript = undefined;
  });

  it("records which playbook and version a run came from, in the job's own payload", async () => {
    const j = store.enqueue("playbook.run", { prompt: "x", playbookId: "pb_1", playbookName: "Ship it", playbookVersion: 3 });
    expect(j.payload).toMatchObject({ playbookId: "pb_1", playbookName: "Ship it", playbookVersion: 3 });
  });
});
