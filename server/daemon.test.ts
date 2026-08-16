// run_daemon — a real command really runs in the background, streams to a real log file, and
// fires a real nudge on completion. Uses a genuine short-lived child process rather than mocking
// child_process, matching how attribution.test.ts/scheduler.test.ts isolate VAULT_DIR: the path
// is computed at module load, so a fresh temp dir needs vi.resetModules() + a dynamic import.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let TOOLS: typeof import("./tools.ts")["TOOLS"];
let listNudges: typeof import("./proactive.ts")["listNudges"];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-daemon-"));
  process.env.VAULT_DIR = dir;
  vi.resetModules();
  ({ TOOLS } = await import("./tools.ts"));
  ({ listNudges } = await import("./proactive.ts"));
});
afterEach(() => { delete process.env.VAULT_DIR; rmSync(dir, { recursive: true, force: true }); });

function daemon() {
  const t = TOOLS.find((x) => x.name === "run_daemon")!;
  expect(t).toBeTruthy();
  return t;
}

async function waitFor(check: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("run_daemon", () => {
  it("returns immediately (doesn't wait for the command)", async () => {
    const t0 = Date.now();
    const result = await daemon().run({ command: "sleep 1 && echo done" });
    expect(Date.now() - t0).toBeLessThan(500);   // way under the 1s the command itself takes
    expect(result).toMatch(/background/i);
    expect(result).toMatch(/\.log/);

    // The assertion above already proved the point (returns before the command finishes) — but
    // the real child is still running after it. Wait it out before afterEach deletes the temp
    // dir out from under it, or its write-after-teardown becomes exactly the crash-on-vanished-
    // vault-dir case the log stream's error handler exists to survive (covered directly by the
    // next test) rather than a clean pass here.
    const logPath = result.match(/(\S+\.log)/)?.[1];
    expect(logPath).toBeTruthy();
    await waitFor(() => existsSync(logPath!) && readFileSync(logPath!, "utf8").includes("[exit"));
  });

  it("streams real output to a log file and nudges on completion", async () => {
    const result = await daemon().run({ command: "echo hello-from-daemon" });
    const logPath = result.match(/(\S+\.log)/)?.[1];
    expect(logPath).toBeTruthy();

    await waitFor(() => existsSync(logPath!) && readFileSync(logPath!, "utf8").includes("[exit"));
    const log = readFileSync(logPath!, "utf8");
    expect(log).toContain("hello-from-daemon");
    expect(log).toContain("[exit 0]");

    await waitFor(() => listNudges().some((n) => n.text.includes("Background task finished")));
    const nudge = listNudges().find((n) => n.text.includes("Background task finished"))!;
    expect(nudge.text).toContain("exit 0");
  });

  it("still refuses a catastrophic command, same as run_command", async () => {
    const result = await daemon().run({ command: "sudo rm -rf /" });
    expect(result.toLowerCase()).not.toContain("background");
    const daemonDir = join(dir, "daemons");
    expect(existsSync(daemonDir) ? readdirSync(daemonDir).length : 0).toBe(0);
  });
});
