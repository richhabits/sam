// ─────────────────────────────────────────────────────────────
//  BEHAVIORAL tests — prove SAM actually DOES the right thing, not
//  just that the shapes are right. Complements the schema/smoke
//  suites: the safety gate really blocks, destructive tools really
//  ask first, recall math really ranks, the cron really fires.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { toolByName } from "./tools.ts";
import { cosine } from "./embeddings.ts";
import { parseCron } from "./scheduler.ts";

// ── SAFETY: the catastrophic-command gate must actually block ──
describe("HARD_DENY catastrophic-command gate (behavioral)", () => {
  const run = (cmd: string) => toolByName("run_command")!.run(cmd);

  it("blocks catastrophic commands WITHOUT running them", async () => {
    const bad = ["rm -rf ~", "rm -rf /", "sudo rm foo", "mkfs.ext4 /dev/sda",
      "dd if=/dev/zero of=/dev/sda", ":(){ :|:& };:", "shutdown -h now", "reboot", "killall -9 Finder"];
    for (const cmd of bad) {
      const out = String(await run(cmd));
      expect(out, `should have blocked: ${cmd}`).toMatch(/blocked for safety|catastrophic/i);
    }
  });

  it("lets an ordinary command run", async () => {
    const out = String(await run("echo hello-sam-behavioral-test"));
    expect(out).toContain("hello-sam-behavioral-test");
  });
});

// ── SAFETY: destructive / standing-side-effect tools must ask first ──
describe("destructive tools require confirmation (locks in the audit fix)", () => {
  it.each(["forget_memory", "clear_all_memories", "remove_schedule", "add_schedule",
    "run_command", "write_file", "send_imessage"])("%s is safe:false (ask-first)", (name) => {
    const t = toolByName(name);
    expect(t, `${name} should exist`).toBeTruthy();
    expect(t!.safe, `${name} must be ask-first`).toBe(false);
  });
});

// ── MEMORY: cosine drives semantic recall — it must rank correctly ──
describe("cosine similarity — the core of memory recall", () => {
  it("identical → 1, orthogonal → 0", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });
  it("ranks a closer vector higher (so recall returns the RIGHT fact)", () => {
    const q = [1, 1, 0];
    expect(cosine(q, [1, 1, 0.1])).toBeGreaterThan(cosine(q, [1, 0, 0]));
    expect(cosine(q, [1, 0, 0])).toBeGreaterThan(cosine(q, [-1, -1, 0]));
  });
});

// ── SCHEDULER: cron parsing + shouldRun timing (BUG#6 area) ──
describe("scheduler cron parsing + shouldRun", () => {
  it("daily fires at the exact minute, once per day", () => {
    const p = parseCron("daily 09:00")!;
    expect(p).toBeTruthy();
    const at9 = new Date(2026, 0, 1, 9, 0, 30);     // local 09:00:30
    const at10 = new Date(2026, 0, 1, 10, 0, 0);
    expect(p.shouldRun(at9, null)).toBe(true);       // due, never ran
    expect(p.shouldRun(at10, null)).toBe(false);     // wrong minute
    expect(p.shouldRun(at9, at9)).toBe(false);       // already ran today
  });
  it("weekly fires only on its day", () => {
    const p = parseCron("weekly mon 09:00")!;
    const mon = new Date(2026, 0, 5, 9, 0, 0);        // 2026-01-05 is a Monday
    const tue = new Date(2026, 0, 6, 9, 0, 0);
    expect(p.shouldRun(mon, null)).toBe(true);
    expect(p.shouldRun(tue, null)).toBe(false);
  });
  it("hourly / every parse; junk rejected", () => {
    expect(parseCron("hourly")).toBeTruthy();
    expect(parseCron("every 30m")).toBeTruthy();
    expect(parseCron("every 2h")).toBeTruthy();
    expect(parseCron("not a cron")).toBeNull();
    expect(parseCron("")).toBeNull();
  });
});
