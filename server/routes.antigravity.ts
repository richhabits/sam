import type { Express, Request, Response } from "express";
import {
  executeAntigravityCognition,
  verifyFactualGrounding,
  verifySymbolDeclaration,
  runCognitiveReflectionLoop,
  getCognitiveTelemetry,
  generatePremiumDesignSystem,
} from "./antigravity-brain.ts";
import { isLoopback } from "./http-guards.ts";

export function registerAntigravityRoutes(app: Express) {
  // 1. Execute Antigravity speculative multi-branch cognition
  app.post("/api/brain/cognition/execute", (req: Request, res: Response) => {
    const { taskPrompt, maxBranches } = req.body || {};
    if (!taskPrompt || typeof taskPrompt !== "string") {
      return res.status(400).json({ error: "taskPrompt (string) is required." });
    }

    const result = executeAntigravityCognition(taskPrompt, {
      maxBranches: typeof maxBranches === "number" ? maxBranches : 3,
    });

    res.json(result);
  });

  // 2. Perform deep factual grounding verification on text / plan
  app.post("/api/brain/cognition/ground", (req: Request, res: Response) => {
    const { text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text (string) is required." });
    }

    const report = verifyFactualGrounding(text);
    res.json(report);
  });

  // 3. Inspect a specific symbol declaration in a workspace file
  app.post("/api/brain/cognition/symbol", (req: Request, res: Response) => {
    const { filePath, symbolName } = req.body || {};
    if (!filePath || !symbolName) {
      return res.status(400).json({ error: "filePath and symbolName are required." });
    }

    const result = verifySymbolDeclaration(String(filePath), String(symbolName));
    res.json(result);
  });

  // 4. Run autonomous self-correction reflection loop
  app.post("/api/brain/cognition/reflect", (req: Request, res: Response) => {
    const { text, maxIterations, autoFixMath } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text (string) is required." });
    }

    const outcome = runCognitiveReflectionLoop(text, {
      maxIterations: typeof maxIterations === "number" ? maxIterations : 3,
      autoFixMath: autoFixMath !== false,
    });

    res.json(outcome);
  });

  // 5. Compile 100x Ultra-Premium UI Design System & Blueprints
  app.post("/api/brain/ui/compile", (req: Request, res: Response) => {
    const { brandName, theme, fontDisplay } = req.body || {};
    const result = generatePremiumDesignSystem({
      brandName: typeof brandName === "string" ? brandName : "Alpha",
      theme,
      fontDisplay,
    });
    res.json(result);
  });

  // 6. Get real-time cognitive brain telemetry
  app.get("/api/brain/cognition/telemetry", (_req: Request, res: Response) => {
    const telemetry = getCognitiveTelemetry();
    res.json(telemetry);
  });
}
