// ─────────────────────────────────────────────────────────────
//  S.A.M. · WORKFLOW ROUTES — named, saved, repeatable multi-step sequences
//
//  Extracted from server/index.ts (audit finding #2). Chosen from the coupling table in
//  docs/DESIGN-AUDIT.md: this section closed over NO index.ts-local state, only `app` itself.
//
//  `registerX(app)` rather than an Express Router: a Router with a mount point would change the
//  route paths, while passing `app` keeps paths and registration order byte-identical.
//  Dangerous steps still PAUSE for approval — that behaviour lives in workflows.ts, untouched.
// ─────────────────────────────────────────────────────────────
import type { Express } from "express";
import { listWorkflows, saveWorkflow, deleteWorkflow, runWorkflow, getWorkflow, dangerousStepsIn, recordRun, type Workflow } from "./workflows.ts";
import { runModel, type Tier } from "./models.ts";
import { recordWorkflowRun } from "./analytics.ts";
import { STARTER_WORKFLOWS } from "./starter-workflows.ts";

export function registerWorkflowsRoutes(app: Express): void {
  // ── Workflows (v1.8) — named, saved, repeatable multi-step sequences. ──
  app.get("/api/workflows", (_req, res) => res.json({ workflows: listWorkflows().map((w) => ({ ...w, dangerousSteps: dangerousStepsIn(w).map((s) => s.id) })) }));
  app.post("/api/workflows", (req, res) => {
    const wf = req.body as Workflow;
    const r = saveWorkflow({ ...wf, runs: wf.runs || [], armed: !!wf.armed, createdAt: wf.createdAt || new Date().toISOString(), version: wf.version || 1 });
    return r.ok ? res.json({ ok: true }) : res.status(400).json({ error: r.reason });
  });
  app.delete("/api/workflows/:id", (req, res) => res.json({ ok: deleteWorkflow(req.params.id) }));
  app.post("/api/workflows/install-starters", (_req, res) => {
    const now = new Date().toISOString();
    let n = 0;
    for (const t of STARTER_WORKFLOWS) { if (!getWorkflow(t.id)) { saveWorkflow({ ...t, armed: false, createdAt: now, runs: [] }); n++; } }
    res.json({ installed: n, workflows: listWorkflows().length });
  });
  // Run a workflow. The engine PAUSES at any dangerous step (never runs it). The executor here auto-runs
  // only SAFE tools; a confirm-tier step defers with a note so it's run with the user present. Brain steps
  // use the free/local tier so a run stays on the cost-cutting cascade.
  app.post("/api/workflows/:id/run", async (req, res) => {
    const wf = getWorkflow(req.params.id);
    if (!wf) return res.status(404).json({ error: "no such workflow" });
    const { toolByName } = await import("./tools.ts");
    const run = await runWorkflow(wf, {
      now: new Date().toISOString(),
      execTool: async (tool, input) => {
        const t = toolByName(tool);
        if (!t) return `(no such tool: ${tool})`;
        if (!t.safe) return `(“${tool}” needs your approval — run it with SAM open)`;   // confirm-tier defers; dangerous already paused
        try { return await t.run(input); } catch (e: any) { return `(error: ${e?.message || e})`; }
      },
      execBrain: async (prompt) => (await runModel((process.env.DEFAULT_TIER as Tier) || "free", "You are SAM, running a saved workflow step. Do this step and hand back a tight result.", prompt)).text,
    });
    recordRun(wf.id, run);
    recordWorkflowRun(new Date().toISOString());   // local count only
    res.json({ run });
  });
}
