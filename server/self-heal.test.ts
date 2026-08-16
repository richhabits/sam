import { describe, it, expect, beforeEach } from "vitest";
import { rmSync, mkdirSync } from "node:fs";

const SCRATCH = "/tmp/sam-selfheal-test";

let SH: typeof import("./self-heal.ts");

beforeEach(async () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.VAULT_DIR = SCRATCH;
  SH = await import("./self-heal.ts");
});

describe("proposeTask", () => {
  it("creates a task with all fields populated", () => {
    const task = SH.proposeTask("port conflict", "EADDRINUSE on 7777", "bug", "Error at index.ts:42");
    expect(task.id).toMatch(/^task_/);
    expect(task.title).toBe("port conflict");
    expect(task.description).toContain("EADDRINUSE");
    expect(task.category).toBe("bug");
    expect(task.status).toBe("open");
    expect(task.stackTrace).toBe("Error at index.ts:42");
    expect(task.timestamp).toBeTruthy();
  });

  it("accumulates multiple tasks", () => {
    SH.proposeTask("first", "desc", "bug");
    SH.proposeTask("second", "desc", "feature");
    const tasks = SH.getAdminTasks();
    expect(tasks).toHaveLength(2);
    // Newest first (unshift)
    expect(tasks[0].title).toBe("second");
  });
});

describe("updateTaskStatus", () => {
  it("transitions open → in_progress → resolved", () => {
    const task = SH.proposeTask("fix it", "broken", "bug");
    expect(SH.updateTaskStatus(task.id, "in_progress")).toBe(true);
    expect(SH.getAdminTasks().find((t) => t.id === task.id)?.status).toBe("in_progress");
    expect(SH.updateTaskStatus(task.id, "resolved")).toBe(true);
    expect(SH.getAdminTasks().find((t) => t.id === task.id)?.status).toBe("resolved");
  });

  it("returns false for a nonexistent task ID", () => {
    expect(SH.updateTaskStatus("task_nonexistent_12345", "resolved")).toBe(false);
  });
});

describe("analyzeCrashAndProposeTask — heuristic suggestions", () => {
  it("suggests kill for EADDRINUSE", () => {
    SH.analyzeCrashAndProposeTask("server", "EADDRINUSE on port 7777");
    const tasks = SH.getAdminTasks();
    expect(tasks[0].suggestedFix).toContain("kill");
    expect(tasks[0].suggestedFix).toContain("lsof");
  });

  it("suggests npm install for missing module", () => {
    SH.analyzeCrashAndProposeTask("import", "Cannot find module 'express'");
    const tasks = SH.getAdminTasks();
    expect(tasks[0].suggestedFix).toContain("npm install");
  });

  it("suggests directory fix for ENOENT", () => {
    SH.analyzeCrashAndProposeTask("fs", "ENOENT: no such file or directory '/foo/bar'");
    const tasks = SH.getAdminTasks();
    expect(tasks[0].suggestedFix).toContain("directory");
  });

  it("falls back to generic suggestion for unknown errors", () => {
    SH.analyzeCrashAndProposeTask("unknown", "Something completely unexpected happened");
    const tasks = SH.getAdminTasks();
    expect(tasks[0].suggestedFix).toContain("error logs");
  });
});
