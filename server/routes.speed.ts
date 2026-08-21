import type { Express } from "express";
import { getSpeedLeaderboard, probeProvider, report, _reset } from "./speed.ts";
import { isLoopback } from "./http-guards.ts";
import { runModel } from "./models.ts";

export function registerSpeedRoutes(app: Express) {
  // Speed Leaderboard & Latency Overview
  app.get("/api/models/speed-benchmark", (req, res) => {
    const leaderboard = getSpeedLeaderboard();
    const fullReport = report();
    res.json({
      leaderboard,
      report: fullReport,
    });
  });

  // Trigger Active Speed Probes Across Key Pools
  app.post("/api/models/probe-speeds", async (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "Probe triggers can only be run on loopback." });

    const { providers } = req.body || {};
    const results = [];

    // Probe standard tiers
    const sampleRunner = async (lane: "fast" | "deep" | "code") => {
      const res = await runModel("free", "Respond with one single word: READY", "Ping test", lane);
      return { text: res.text };
    };

    try {
      const probeFast = await probeProvider("free-lane-fast", () => sampleRunner("fast"));
      results.push(probeFast);
    } catch { /* best effort */ }

    try {
      const probeDeep = await probeProvider("free-lane-deep", () => sampleRunner("deep"));
      results.push(probeDeep);
    } catch { /* best effort */ }

    res.json({
      success: true,
      timestamp: Date.now(),
      probes: results,
      leaderboard: getSpeedLeaderboard(),
    });
  });
}
