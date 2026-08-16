import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMasterDashboard } from "./orchestrator.ts";
import { samMasterDashboardTool } from "./tools.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sam-orchestrator-test-"));
  process.env.VAULT_DIR = dir;
});
afterEach(() => {
  delete process.env.VAULT_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("Master System Orchestrator", () => {
  // AUDIT FIX: getMasterDashboard() used to call autoHealDoctor() directly — the same mutating
  // function doctor_auto_heal wraps (deletes stale lock files, writes to the vault directory),
  // which is safe:false specifically because of those side effects. sam_master_dashboard is
  // safe:true, so every "just show me the dashboard" call silently applied remediations with
  // zero approval. Proves the fix: a genuinely stale lock (dead pid, old timestamp — the exact
  // shape autoHealDoctor's sweep targets, per doctor-heal.test.ts) survives untouched.
  it("never mutates the filesystem, even though it's safe:true", () => {
    const lockDir = join(dir, ".locks");
    const lockFile = join(lockDir, "orchestrator_audit_test.lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(lockFile, JSON.stringify({
      resource: "orchestrator_audit_test",
      owner: "dead-proc",
      pid: 999999999,
      host: "localhost",
      at: new Date(Date.now() - 100_000).toISOString(),
      token: "dead123",
    }));

    getMasterDashboard();

    expect(existsSync(lockFile)).toBe(true);
  });

  it("compiles master dashboard telemetry across all subsystems", () => {
    const dash = getMasterDashboard();

    expect(dash.systemHealth.status).toBeDefined();
    expect(dash.systemHealth.activeToolsCount).toBeGreaterThanOrEqual(100);
    expect(dash.cacheStats.l1Entries).toBeGreaterThanOrEqual(0);
    expect(dash.costSavings.dollarsSaved).toBeGreaterThanOrEqual(0);
    expect(dash.flipitQuant.equityGbp).toBeGreaterThan(0);
    expect(dash.studioHiggsfield.cameraRigsCount).toBeGreaterThanOrEqual(10);
    expect(dash.mobileBridge.pairedDevicesCount).toBeGreaterThanOrEqual(0);
  });

  it("runs samMasterDashboardTool", async () => {
    const out = await samMasterDashboardTool();
    expect(out).toContain("SAM Master Executive Dashboard");
    expect(out).toContain("Overall System Health:");
    expect(out).toContain("Multi-Tier Cache:");
    expect(out).toContain("FlipIt 100x Quant Desk:");
    expect(out).toContain("Higgsfield AI Studio:");
    expect(out).toContain("Universal Mobile Bridge:");
  });
});
