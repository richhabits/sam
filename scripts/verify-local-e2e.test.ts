import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Mock environment for testing locally to save money
process.env.POLYMARKET_ADDRESS = "0xMockAddress";
process.env.POLYMARKET_API_KEY = "MockApiKey";

// We import the modules strictly after the environment override
import { getSharedExecutionEngine, submitPolymarketClobOrder } from "../server/flipit-execution.ts";
import { calculatePortfolioRebalance } from "../server/flipit-auto.ts";
import { compileProductionTimeline } from "../server/studio-master-timeline.ts";
import { compileHiggsfieldMotionPrompt } from "../server/studio-higgsfield.ts";
import { FlipItLocalSimulator } from "../server/flipit-local-simulator.ts";

describe("Local Zero-Cost System Validation (SAM + FlipIt + Studio)", () => {

  it("FlipIt Execution avoids real API calls with local simulator", async () => {
    const sim = new FlipItLocalSimulator();
    
    // Pass the simulator's fetcher to bypass actual polymarket
    const res = await submitPolymarketClobOrder(
      { tokenId: "MOCK", price: 0.5, size: 100, side: "BUY" },
      { address: "0xMock", apiKey: "MockKey" },
      { fetcher: sim.getMockFetcher() as any }
    );
    
    expect(res.success).toBe(true);
    expect(res.orderId).toContain("sim_");
  });

  it("FlipIt Auto Rebalancer handles standard target drift safely", () => {
    const report = calculatePortfolioRebalance(
      [
        { id: "A", ticker: "BTC", name: "Bitcoin", currentValueGbp: 60, currentWeight: 0.6 },
        { id: "B", ticker: "ETH", name: "Ethereum", currentValueGbp: 40, currentWeight: 0.4 },
      ],
      [
        { id: "A", targetWeight: 0.5 },
        { id: "B", targetWeight: 0.5 },
      ]
    );

    expect(report.isRebalanceNeeded).toBe(true);
    expect(report.trades).toHaveLength(2);
    expect(report.trades.find(t => t.id === "A")?.action).toBe("SELL");
    expect(report.trades.find(t => t.id === "B")?.action).toBe("BUY");
  });

  it("Studio Timeline Compiler builds fully mocked timeline without GPUs", () => {
    const timeline = compileProductionTimeline({
      conceptPrompt: "A cyberpunk city at night with neon lights",
      sceneCount: 4,
      aspectRatio: "16:9",
    });

    expect(timeline.totalFrames).toBeGreaterThan(10);
    expect(timeline.videoShots).toHaveLength(4); // Or 3 if it fell back to deterministic
    expect(timeline.audioTracks.length).toBeGreaterThanOrEqual(1);
  });

  it("Studio Higgsfield motion compiler builds correct zero-cost prompts", () => {
    const p = compileHiggsfieldMotionPrompt({
      basePrompt: "A cat sleeping",
      cameraRigId: "dolly_in_rapid",
      motionIntensity: 2.0
    });

    expect(p.compiledPrompt).toContain("A cat sleeping");
    expect(p.cameraTrajectory.intensity).toBe(2.0);
    expect(p.cameraTrajectory.rig).toBe("dolly_in_rapid");
  });

});
