// ─────────────────────────────────────────────────────────────
//  S.A.M. · WORKFLOWS  (v1.8 — chain the tools into recurring value)
//
//  A named, saved, repeatable multi-step sequence (tools, brain calls, conditionals). Steps are stored
//  as portable definitions and can run on the scheduler.
//
//  HARD SAFETY RULE — the whole point: a workflow NEVER runs a dangerous action unattended. At run time
//  the engine PAUSES at the first dangerous step and hands the decision back for confirmation — it does
//  NOT execute it, even for a fully-armed, scheduled run. Autonomy in scheduling is not autonomy in
//  permissions. Arming a workflow grants it a schedule; it never grants dangerous execution. Safe steps
//  before a dangerous one run; the dangerous step waits for you.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDangerous } from "./authz.ts";

const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const DIR = join(VAULT_DIR, "workflows");

export type StepKind = "tool" | "brain" | "conditional";
export interface WorkflowStep {
  id: string;
  kind: StepKind;
  label: string;
  tool?: string;         // kind === "tool"
  input?: any;
  prompt?: string;       // kind === "brain"
  condition?: string;    // kind === "conditional" — a note; conditionals are advisory in v1.8
}
export interface RunStepResult { stepId: string; label: string; output: string; ran: boolean }
export interface RunRecord { at: string; status: "done" | "paused" | "error"; results: RunStepResult[]; pausedAtStep?: string; note?: string }
export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: number;
  steps: WorkflowStep[];
  schedule?: string;     // cron; absent ⇒ manual only
  armed: boolean;        // may run on the scheduler (still pauses on dangerous steps)
  createdAt: string;
  runs: RunRecord[];
}

const NAME_RE = /^[\w][\w -]{1,59}$/;
function fileFor(id: string) { return join(DIR, `${id}.json`); }
function ensure() { if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true }); }

// ── which steps are dangerous (for the review UI + the runtime gate) ──
export function dangerousStepsIn(wf: Workflow): WorkflowStep[] {
  return wf.steps.filter((s) => s.kind === "tool" && !!s.tool && isDangerous(s.tool));
}
export function hasDangerousStep(wf: Workflow): boolean { return dangerousStepsIn(wf).length > 0; }

// ── storage ──
export function listWorkflows(): Workflow[] {
  ensure();
  try {
    return readdirSync(DIR).filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(DIR, f), "utf8")) as Workflow; } catch { return null; } })
      .filter(Boolean) as Workflow[];
  } catch { return []; }
}
export function getWorkflow(id: string): Workflow | null { try { return JSON.parse(readFileSync(fileFor(id), "utf8")); } catch { return null; } }
export function saveWorkflow(wf: Workflow): { ok: boolean; reason?: string } {
  if (!NAME_RE.test(wf.name || "")) return { ok: false, reason: "Bad workflow name." };
  if (!Array.isArray(wf.steps) || !wf.steps.length) return { ok: false, reason: "A workflow needs at least one step." };
  ensure(); writeFileSync(fileFor(wf.id), JSON.stringify(wf, null, 2));
  return { ok: true };
}
export function deleteWorkflow(id: string): boolean { const f = fileFor(id); if (!existsSync(f)) return false; unlinkSync(f); return true; }

// ── the run engine ──
// Executes steps in order. A SAFE tool step runs via execTool; a brain step via execBrain. The FIRST
// dangerous tool step PAUSES the run (returns status:"paused", pausedAtStep) WITHOUT executing it — the
// caller then asks the user and, on approval, runs just that step through the normal gate. `now` is
// injected (the caller owns the clock) so runs are deterministic in tests.
export interface RunDeps {
  now: string;
  execTool: (tool: string, input: any) => Promise<string>;
  execBrain: (prompt: string) => Promise<string>;
}
export async function runWorkflow(wf: Workflow, deps: RunDeps): Promise<RunRecord> {
  const results: RunStepResult[] = [];
  try {
    for (const step of wf.steps) {
      if (step.kind === "tool" && step.tool && isDangerous(step.tool)) {
        // STOP. Never run a dangerous step unattended — hand it back for confirmation.
        return { at: deps.now, status: "paused", results, pausedAtStep: step.id, note: `Paused before “${step.label}” — it uses a dangerous tool (${step.tool}) and needs your OK.` };
      }
      let output = "";
      if (step.kind === "tool" && step.tool) output = await deps.execTool(step.tool, step.input);
      else if (step.kind === "brain" && step.prompt) output = await deps.execBrain(step.prompt);
      else if (step.kind === "conditional") output = `(condition: ${step.condition || ""})`;
      results.push({ stepId: step.id, label: step.label, output: String(output ?? ""), ran: step.kind !== "conditional" });
    }
    return { at: deps.now, status: "done", results };
  } catch (e: any) {
    return { at: deps.now, status: "error", results, note: String(e?.message || e) };
  }
}

// Record a run against the workflow's history (most-recent-first, bounded).
export function recordRun(id: string, run: RunRecord): void {
  const wf = getWorkflow(id); if (!wf) return;
  wf.runs = [run, ...(wf.runs || [])].slice(0, 20);
  saveWorkflow(wf);
}
