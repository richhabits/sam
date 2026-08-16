import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sam-test-")); process.env.VAULT_DIR = dir; activeTasks.clear(); });
afterEach(() => { delete process.env.VAULT_DIR; rmSync(dir, { recursive: true, force: true }); });

vi.mock("./proactive.ts", () => ({ addNudge: vi.fn() }));

import { manageTaskTool, activeTasks } from "./tools.ts";

describe("manageTaskTool", () => {
  beforeEach(() => {
    activeTasks.clear();
  });
  afterEach(async () => {
    for (const [id, t] of activeTasks.entries()) {
      t.child.kill();
    }
    activeTasks.clear();
  });

  it("can spawn and list tasks", async () => {
    const listBefore = await manageTaskTool({ action: "list" });
    expect(listBefore).toBe("No active tasks.");

    const res = await manageTaskTool({ action: "spawn", command: "sleep 2" });
    expect(res).toContain("Started in the background");
    
    const listAfter = await manageTaskTool({ action: "list" });
    expect(listAfter).toContain("sleep 2");
    expect(activeTasks.size).toBe(1);
  });

  it("can kill a task", async () => {
    const res = await manageTaskTool({ action: "spawn", command: "sleep 10" });
    const match = res.match(/as (d-[a-z0-9]+)/);
    expect(match).toBeTruthy();
    const id = match![1];

    const killRes = await manageTaskTool({ action: "kill", taskId: id });
    expect(killRes).toContain("Sent SIGTERM");
    expect(activeTasks.has(id)).toBe(false);
  });

  it("can get status and send input", async () => {
    const res = await manageTaskTool({ action: "spawn", command: "cat" });
    const match = res.match(/as (d-[a-z0-9]+)/);
    const id = match![1];

    const inputRes = await manageTaskTool({ action: "send_input", taskId: id, input: "hello world" });
    expect(inputRes).toContain("Sent input");

    // Give it a moment to process stdout
    await new Promise(r => setTimeout(r, 100));

    const statusRes = await manageTaskTool({ action: "status", taskId: id });
    expect(statusRes).toContain("hello world");
    expect(statusRes).toContain("RUNNING");
  });
});
