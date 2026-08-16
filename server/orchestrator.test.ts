import { describe, it, expect } from "vitest";
import { getMasterDashboard } from "./orchestrator.ts";
import { samMasterDashboardTool } from "./tools.ts";

describe("Master System Orchestrator", () => {
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
