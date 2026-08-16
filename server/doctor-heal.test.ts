import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoHealDoctor } from "./doctor.ts";
import { getAdminTasks } from "./self-heal.ts";
import { claim } from "./latch.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-heal-test-"));
  process.env.VAULT_DIR = dir;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("Doctor Auto-Heal & Remediation", () => {
  it("sweeps stale latch locks and reports healthy status", () => {
    // Create a stale lock file directly
    const lockDir = join(dir, ".locks");
    const lockFile = join(lockDir, "test_resource.lock");
    import("node:fs").then(fs => {
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(lockFile, JSON.stringify({
        resource: "test_resource",
        owner: "dead-proc",
        pid: 999999999, // dead PID
        host: "localhost",
        at: new Date(Date.now() - 100_000).toISOString(),
        token: "dead123",
      }));
    });

    const report = autoHealDoctor({
      hasCloudKeys: true,
      ollamaConfigured: false,
      ollamaReachable: false,
      online: true,
      vaultWritable: true,
      platform: "darwin",
    }, dir);

    expect(report.status).toBe("clean");
    expect(report.summary).toContain("System is healthy");
  });

  it("files admin tasks when a critical failure occurs", () => {
    const report = autoHealDoctor({
      hasCloudKeys: false,
      ollamaConfigured: false,
      ollamaReachable: false,
      online: true,
      vaultWritable: true,
      platform: "darwin",
    }, dir);

    expect(report.status).toBe("needs_attention");
    expect(report.tasksCreated.length).toBeGreaterThan(0);
    expect(report.tasksCreated[0]).toContain("Doctor Issue: AI brain");

    const tasks = getAdminTasks();
    expect(tasks.some(t => t.title.includes("AI brain"))).toBe(true);
  });
});
