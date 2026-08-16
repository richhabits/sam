import type { Express } from "express";
import { getSavingsSummary } from "./cost-optimizer.ts";

export function registerAdminCostRoutes(app: Express) {
  app.get("/api/admin/cost-savings", (_req, res) => {
    try {
      const summary = getSavingsSummary();
      res.json(summary);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to retrieve cost savings summary" });
    }
  });
}
