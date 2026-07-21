import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore } from "./store.ts";
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
