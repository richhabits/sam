// The Standing Crew — arm a specialist to run in the background on a trigger, surface the result,
// and NEVER auto-run a dangerous action unattended. Uses a scratch VAULT_DIR + injected runner so
// no model, quota, OS notifier, or network is touched.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRATCH = "/tmp/sam-standing-test";

let S: typeof import("./standing.ts");
let L: typeof import("./autonomy-log.ts");
let AgentResultOf: (over: Partial<import("./agent.ts").AgentResult>) => import("./agent.ts").AgentResult;

beforeAll(async () => {
  // Set the vault BEFORE importing — autonomy-log captures VAULT_DIR at module load.
  process.env.VAULT_DIR = SCRATCH;
  rmSync(SCRATCH, { recursive: true, force: true });
  S = await import("./standing.ts");
  L = await import("./autonomy-log.ts");
  AgentResultOf = (over) => ({ kind: "final", trace: [], ...over }) as import("./agent.ts").AgentResult;
});

beforeEach(() => {
  for (const a of S.list()) S.remove(a.id);
  L.clearAutonomyLog();
  delete process.env.SAM_STANDING;   // flag OFF unless a test opts in
});

type Runner = import("./standing.ts").SpecialistRunner;

const finalRunner = (text: string): Runner =>
  async () => AgentResultOf({ kind: "final", text });

const dangerousRunner = (): Runner =>
  async () => AgentResultOf({ kind: "pending", tool: "shell.run", input: { cmd: "rm -rf /" }, activity: "delete the vault", transcript: "t" });

const allow = () => true;   // stand in for the consent grant (real gate is consent.isEnabled)

describe("the Standing Crew", () => {
  it("arms, lists, and disarms a specialist", () => {
    const a = S.arm("scout", "scan the market for AI news", "hourly");
    expect(a.id).toMatch(/^std-/);
    expect(a.specialistId).toBe("scout");
    expect(a.armed).toBe(true);
    expect(a.createdAt).toBeTruthy();

    expect(S.list().map((x) => x.id)).toContain(a.id);

    const off = S.disarm(a.id);
    expect(off?.armed).toBe(false);
    // Still in the list (can be re-armed) but stood down.
    expect(S.list().find((x) => x.id === a.id)?.armed).toBe(false);
  });

  it("rejects an unknown specialist and an invalid cron — never silently", () => {
    expect(() => S.arm("not-a-real-specialist", "do stuff", "hourly")).toThrow();
    expect(() => S.arm("scout", "do stuff", "every 0m")).toThrow();
    expect(() => S.arm("scout", "", "hourly")).toThrow();
    expect(S.list().length).toBe(0);
  });

  it("fires a due armed agent and records lastResult", async () => {
    process.env.SAM_STANDING = "1";
    const a = S.arm("ledger", "summarise today's spend", "hourly");
    const notes: string[] = [];
    const out = await S.runDue(new Date(), {
      runner: finalRunner("Spend is £4.20, under budget."),
      notify: (_t, m) => { notes.push(m); },
      push: () => {},
      consentOk: allow,
    });
    expect(out.length).toBe(1);
    expect(out[0].outcome).toBe("ran");
    expect(out[0].result).toContain("£4.20");
    // Persisted result on the agent.
    expect(S.list().find((x) => x.id === a.id)?.lastResult).toContain("£4.20");
    // Notified.
    expect(notes.join(" ")).toContain("£4.20");
    // Logged as `acted` under the standing-crew behavior.
    const log = L.readAutonomyLog();
    expect(log.some((e) => e.behavior === S.STANDING_BEHAVIOR && e.kind === "acted")).toBe(true);
  });

  it("does NOT fire when the flag is OFF", async () => {
    // flag deleted in beforeEach
    S.arm("scout", "watch the news", "hourly");
    const out = await S.runDue(new Date(), { runner: finalRunner("x"), consentOk: allow });
    expect(out).toEqual([]);
  });

  it("does NOT fire when consent is OFF", async () => {
    process.env.SAM_STANDING = "1";
    S.arm("scout", "watch the news", "hourly");
    const out = await S.runDue(new Date(), { runner: finalRunner("x"), consentOk: () => false });
    expect(out).toEqual([]);
  });

  it("does NOT fire a disarmed agent", async () => {
    process.env.SAM_STANDING = "1";
    const a = S.arm("scout", "watch the news", "hourly");
    S.disarm(a.id);
    let ran = false;
    const out = await S.runDue(new Date(), {
      runner: async () => { ran = true; return AgentResultOf({ kind: "final", text: "x" }); },
      consentOk: allow,
    });
    expect(out).toEqual([]);
    expect(ran).toBe(false);
  });

  it("DEFERS a dangerous action — never auto-runs it", async () => {
    process.env.SAM_STANDING = "1";
    const a = S.arm("hacker", "clean up old files", "hourly");
    const notes: string[] = [];
    const out = await S.runDue(new Date(), {
      runner: dangerousRunner(),
      notify: (_t, m) => { notes.push(m); },
      push: () => {},
      consentOk: allow,
    });
    expect(out.length).toBe(1);
    expect(out[0].outcome).toBe("deferred");
    // No success notification for a deferred, un-run action.
    expect(notes.length).toBe(0);
    // Recorded as blocked (nothing performed) under the standing-crew behavior.
    const log = L.readAutonomyLog();
    const blocked = log.find((e) => e.behavior === S.STANDING_BEHAVIOR && e.kind === "blocked");
    expect(blocked).toBeTruthy();
    expect(blocked!.summary).toMatch(/DEFERRED|not performed/i);
    // lastResult reflects the deferral, not a fake success.
    expect(S.list().find((x) => x.id === a.id)?.lastResult || "").toMatch(/[Dd]eferred|approval|nothing/);
  });

  it("claims a fired slot so it does not double-fire on the next tick", async () => {
    process.env.SAM_STANDING = "1";
    S.arm("scout", "hourly scan", "hourly");
    const first = await S.runDue(new Date(), { runner: finalRunner("done"), notify: () => {}, push: () => {}, consentOk: allow });
    expect(first.length).toBe(1);
    // Immediately again — "hourly" is not due again yet (lastRunAt was just claimed).
    const second = await S.runDue(new Date(), { runner: finalRunner("done"), notify: () => {}, push: () => {}, consentOk: allow });
    expect(second).toEqual([]);
  });

  it("persists the armed crew to vault/standing.json (survives a reload)", () => {
    const a = S.arm("quill", "draft the weekly note", "daily 09:00");
    const f = join(SCRATCH, "standing.json");
    expect(existsSync(f)).toBe(true);
    // Read the raw file — proves it's on disk, not just in memory.
    const onDisk = JSON.parse(readFileSync(f, "utf8"));
    expect(onDisk.find((x: any) => x.id === a.id)?.task).toBe("draft the weekly note");
    // load() reads fresh from disk every call, so list() reflects a "reloaded" state.
    expect(S.list().find((x) => x.id === a.id)?.cron).toBe("daily 09:00");
  });
});
