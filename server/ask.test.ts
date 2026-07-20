// The Ask — an unattended risky action is delivered out-of-band and SAFE-DEFAULTS: on timeout,
// denial, or ambiguity it is NOT performed, recorded as deferred, and never silently dropped.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/tmp/sam-ask-test";
let A: typeof import("./ask.ts");
let LOG: typeof import("./autonomy-log.ts");
let P: typeof import("./pending.ts");

beforeAll(async () => {
  process.env.VAULT_DIR = SCRATCH;
  rmSync(SCRATCH, { recursive: true, force: true });
  A = await import("./ask.ts");
  LOG = await import("./autonomy-log.ts");
  P = await import("./pending.ts");
});
beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  process.env.SAM_ASK = "1";
  delete process.env.SAM_ASK_TIMEOUT_MS;
  A._clearAsks();
  P._clearPending();
  LOG.clearAutonomyLog();
});
afterEach(() => { delete process.env.SAM_ASK; delete process.env.SAM_ASK_TIMEOUT_MS; });

const raise = (over: any = {}) => A.raiseAsk({
  pending: { tool: "send_email", input: { to: "boss@acme.com" }, transcript: "SECRET context", trace: [], activity: "email your boss", ...over.pending },
  tier: "free", source: "scheduler", now: 1000, deliver: over.deliver || (() => undefined), ...over,
});

describe("the flag + config", () => {
  it("is ON by default; SAM_ASK=0 is the kill-switch", () => { delete process.env.SAM_ASK; expect(A.askEnabled()).toBe(true); process.env.SAM_ASK = "0"; expect(A.askEnabled()).toBe(false); });
  it("stays on with SAM_ASK=1", () => { process.env.SAM_ASK = "1"; expect(A.askEnabled()).toBe(true); });
  it("timeout is configurable, never zero", () => {
    expect(A.askTimeoutMs()).toBe(30 * 60_000);
    process.env.SAM_ASK_TIMEOUT_MS = "5000"; expect(A.askTimeoutMs()).toBe(5000);
    process.env.SAM_ASK_TIMEOUT_MS = "0"; expect(A.askTimeoutMs()).toBe(30 * 60_000);   // 0 falls back, never disables the safe default
  });
});

describe("raise — parks, surfaces, logs, and performs NOTHING", () => {
  it("opens an Ask, delivers out-of-band, classifies blast radius, logs it — and runs nothing", () => {
    const delivered: any[] = [];
    const ask = raise({ deliver: (a: any) => delivered.push(a) });
    expect(ask.status).toBe("open");
    expect(ask.blast).toBe("dangerous");                 // send_email is a dangerous tool
    expect(ask.action).toBe("email your boss");
    expect(delivered).toHaveLength(1);                   // reached a channel
    expect(A.openAsks(1000)).toHaveLength(1);
    // logged as a blocked (gate-stopped) autonomous action
    expect(LOG.readAutonomyLog().some((e) => e.behavior === "the Ask" && e.kind === "blocked" && e.tool === "send_email")).toBe(true);
    // the action is parked, not run — the module never has a way to execute it
    expect(P._pendingSize()).toBe(1);
  });

  it("a confirm-tier tool is classified 'confirm', not 'dangerous'", () => {
    const ask = raise({ pending: { tool: "write_file", input: { path: "~/n.md" }, activity: "write a file" } });
    expect(ask.blast).toBe("confirm");
  });

  it("delivery failure never changes the safe default — the Ask stays open + surfaced", () => {
    const ask = A.raiseAsk({ pending: { tool: "run_command", input: {}, activity: "run a command" }, tier: "free", source: "scheduler", now: 1000, deliver: () => { throw new Error("push offline"); } });
    expect(ask.status).toBe("open");                     // a thrown channel doesn't abort or auto-run
    expect(A.openAsks(1000)).toHaveLength(1);            // still visible locally (the Console card)
  });
});

describe("resolve — approval proceeds; denial aborts; both are logged", () => {
  it("approval hands back the parked action to run, and logs 'acted'", () => {
    const ask = raise();
    const r = A.resolveAsk(ask.id, true, 1500);
    expect(r?.ask.status).toBe("approved");
    expect(r?.action?.tool).toBe("send_email");           // the caller resumes THIS
    expect(r?.action?.input).toEqual({ to: "boss@acme.com" });
    expect(LOG.readAutonomyLog().some((e) => e.kind === "acted" && /approved/.test(e.summary))).toBe(true);
  });

  it("denial does NOT hand back the action, and logs it", () => {
    const ask = raise();
    const r = A.resolveAsk(ask.id, false, 1500);
    expect(r?.ask.status).toBe("denied");
    expect(r?.action).toBeNull();                          // never performed
    expect(P.takePending(ask.pendingId)).toBeUndefined();  // parked action was dropped
    expect(LOG.readAutonomyLog().some((e) => e.kind === "blocked" && /declined/.test(e.summary))).toBe(true);
  });
});

describe("SAFE DEFAULT — timeout and ambiguity never perform the action", () => {
  it("TIMEOUT via sweep → deferred, action dropped, never auto-approved", () => {
    const ask = raise();
    const expired = A.sweepAsks(ask.expiresAt + 1);
    expect(expired).toHaveLength(1);
    expect(A.getAsk(ask.id)?.status).toBe("deferred");
    expect(A.openAsks(ask.expiresAt + 1)).toHaveLength(0);
    expect(P.takePending(ask.pendingId)).toBeUndefined();  // parked action gone — not performed
    // and approving AFTER expiry still never runs it
    const r = A.resolveAsk(ask.id, true, ask.expiresAt + 2);
    expect(r?.action).toBeNull();
    expect(LOG.readAutonomyLog().some((e) => /DEFERRED|no answer in time/.test(e.summary))).toBe(true);
  });

  it("resolve() past the deadline safe-defaults even without a prior sweep", () => {
    const ask = raise();
    const r = A.resolveAsk(ask.id, true, ask.expiresAt + 1);   // approve, but too late
    expect(r?.ask.status).toBe("deferred");
    expect(r?.action).toBeNull();                              // never silently auto-approves a stale Ask
  });

  it("ambiguity — unknown id or double-resolve — never runs anything", () => {
    expect(A.resolveAsk("no-such-id", true, 1500)).toBeNull();
    const ask = raise();
    A.resolveAsk(ask.id, true, 1500);
    const again = A.resolveAsk(ask.id, true, 1600);
    expect(again?.action).toBeNull();                          // already resolved — never re-runs
  });
});

describe("REGRESSION — the active bug: a scheduled risky action no longer reports a false 'Finished.'", () => {
  const pending = { kind: "pending", tool: "send_email", input: { to: "x" }, activity: "email x", transcript: "", trace: [] };

  it("with the Ask ON: a pending background result becomes a DEFERRED Ask, never 'Finished.'", () => {
    const out = A.handleUnattended(pending, { tier: "free", source: "scheduler", deliver: () => undefined });
    expect(out.kind).toBe("deferred");
    expect(out.text).toMatch(/Deferred/);
    expect(out.text).not.toBe("Finished.");
    expect(A.openAsks().length).toBe(1);                 // it's surfaced, not dropped
  });

  it("a final answer still passes straight through", () => {
    const out = A.handleUnattended({ kind: "final", text: "done" } as any, { tier: "free", source: "scheduler" });
    expect(out).toEqual({ kind: "final", text: "done" });
  });

  it("with the Ask kill-switched (SAM_ASK=0): returns 'none' so the caller keeps its old fallback", () => {
    process.env.SAM_ASK = "0";
    const out = A.handleUnattended(pending, { tier: "free", source: "scheduler" });
    expect(out.kind).toBe("none");
    expect(A.openAsks().length).toBe(0);                 // nothing raised when the kill-switch is set
  });
});

describe("swarm — no longer hangs forever: the sweep surfaces it to be pinged/closed", () => {
  it("an expired swarm Ask is returned with its swarmRef so the caller can approveAgent(false)", () => {
    const ask = raise({ source: "swarm", swarmRef: { swarmId: "s1", agentId: "a1" } });
    const expired = A.sweepAsks(ask.expiresAt + 1);
    expect(expired).toHaveLength(1);
    expect(expired[0].swarmRef).toEqual({ swarmId: "s1", agentId: "a1" });   // driver uses this to finish the paused agent
    expect(expired[0].status).toBe("deferred");
  });
});
