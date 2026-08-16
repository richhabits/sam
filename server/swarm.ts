// ─────────────────────────────────────────────────────────────
//  S.A.M. · CONTINUOUS SWARM
//  Long-running, asynchronous background agents. Swarms persist
//  across restarts. Agents pause when hitting risky tools and
//  wait for UI approval.
// ─────────────────────────────────────────────────────────────

import { runModel, type Tier } from "./models.ts";
import { runAgent, resumeAgent, type AgentResult } from "./agent.ts";
import { askEnabled, raiseAsk, resolveAsk } from "./ask.ts";
import { SPECIALISTS, NINJAS, } from "./agents.ts";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(process.env.VAULT_DIR || join(ROOT, "vault"), "swarms.json");

export interface SwarmAgent {
  id: string;
  specialistId: string;
  name: string;
  emoji: string;
  task: string;
  status: "pending" | "running" | "paused" | "done" | "error";
  output?: string;
  pendingActivity?: string;
  pendingTool?: string;
  pendingInput?: any;
  pendingPreview?: string;
  askId?: string;             // set when the Ask surfaced this pause out-of-band (SAM_ASK)
  transcript?: string;
  trace?: string[];
}

export interface Swarm {
  id: string;
  goal: string;
  status: "planning" | "running" | "paused" | "done" | "error";
  agents: SwarmAgent[];
  synthesis?: string;
  created: number;
  system: string;
  tier: string;
}

// In-memory authoritative store. Concurrent agents all mutate the SAME live
// objects (single source of truth) instead of each read-modify-writing a fresh
// disk copy — which is what let one agent's status overwrite another's (the
// lost-update race that hung multi-agent swarms). Disk is a write-only mirror.
let CACHE: Swarm[] | null = null;

export function loadSwarms(): Swarm[] {
  if (CACHE) return CACHE;
  try { if (existsSync(FILE)) CACHE = JSON.parse(readFileSync(FILE, "utf8")); } catch { /* no state file yet, or corrupt — start from the default */ }
  if (!CACHE) CACHE = [];
  return CACHE;
}

function saveSwarms(swarms: Swarm[]) {
  let toSave = swarms;
  if (swarms.length > 50) {
    const active = swarms.filter((s) => s.status === "running" || s.status === "paused" || s.status === "planning");
    const finished = swarms.filter((s) => s.status === "done" || s.status === "error").sort((a, b) => b.created - a.created);
    toSave = [...active, ...finished.slice(0, Math.max(0, 50 - active.length))];
  }
  CACHE = toSave;   // keep the in-memory store authoritative
  // CACHE above stays authoritative in memory, so a failed write costs persistence across a
  // restart, not correctness now. Still worth seeing in the log.
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(toSave, null, 2)); }
  catch (e: any) { console.error("[SAM] swarm: FAILED to persist swarm state —", e?.message || e); }
}

function getSwarm(id: string): Swarm | undefined {
  return loadSwarms().find((s) => s.id === id);
}

function updateSwarm(id: string, fn: (s: Swarm) => void) {
  const swarms = loadSwarms();
  const s = swarms.find((x) => x.id === id);
  if (s) { fn(s); saveSwarms(swarms); }
}

const byId = (id: string) => [...SPECIALISTS, ...NINJAS].find((s) => s.id === id);

// Orchestrator: break goal into subtasks
async function makePlan(goal: string, tier: Tier): Promise<{ specialist: string; task: string }[]> {
  const roster = SPECIALISTS.map((s) => `- ${s.id} (${s.name}): ${s.brief}`).join("\n");
  const sys = `You are SAM's orchestrator. Break the user's massive goal into up to 7 focused subtasks and assign each to the ONE best specialist. Reply with ONLY a JSON array, nothing else: [{"specialist":"<id>","task":"<clear instruction>"}].\n\nSpecialists:\n${roster}`;
  const r = await runModel(tier, sys, `Goal: ${goal}\n\nJSON plan:`);
  const m = r.text.match(/\[[\s\S]*\]/);
  if (!m) return [{ specialist: "scout", task: goal }];
  try {
    const arr = JSON.parse(m[0]);
    const plan = Array.isArray(arr) ? arr.filter((x) => x && byId(x.specialist) && x.task).map((x) => ({ specialist: x.specialist, task: String(x.task) })).slice(0, 7) : [];
    return plan.length ? plan : [{ specialist: "scout", task: goal }];
  } catch { return [{ specialist: "scout", task: goal }]; }
}

// 1. Kick off a new swarm
export async function startSwarm(goal: string, system: string, tier: Tier): Promise<Swarm> {
  const swarm: Swarm = {
    id: "swm-" + Math.random().toString(36).slice(2, 9),
    goal,
    status: "planning",
    agents: [],
    created: Date.now(),
    system,
    tier,
  };
  const swarms = loadSwarms();
  swarms.push(swarm);
  saveSwarms(swarms);

  // Background orchestration
  void (async () => {
    try {
      const plan = await makePlan(goal, tier);
      updateSwarm(swarm.id, (s) => {
        s.status = "running";
        s.agents = plan.map((p) => {
          const spec = byId(p.specialist)!;
          return {
            id: "agt-" + Math.random().toString(36).slice(2, 9),
            specialistId: p.specialist,
            name: spec.name,
            emoji: spec.emoji,
            task: p.task,
            status: "pending",
          };
        });
      });
      // Start each agent loop
      const s = getSwarm(swarm.id)!;
      for (const a of s.agents) void runAgentLoop(swarm.id, a.id);
    } catch (e: any) {
      updateSwarm(swarm.id, (s) => { s.status = "error"; s.synthesis = "Failed to plan swarm: " + e.message; });
    }
  })();

  return swarm;
}

// Process an agent result (final or pending)
function handleAgentResult(swarmId: string, agentId: string, result: AgentResult) {
  updateSwarm(swarmId, (s) => {
    const a = s.agents.find((x) => x.id === agentId);
    if (!a) return;
    if (result.kind === "final") {
      a.status = "done";
      a.output = result.text;
      a.trace = result.trace;
    } else {
      a.status = "paused";
      a.pendingTool = result.tool;
      a.pendingInput = result.input;
      a.pendingPreview = result.preview;
      a.pendingActivity = result.activity;
      a.transcript = result.transcript;
      a.trace = result.trace;
      // The Ask: a paused swarm agent used to hang forever with no ping. Surface it out-of-band and
      // let the timeout sweep (index.ts) safe-default it via approveAgent(false) if unanswered.
      if (askEnabled() && result.tool) {
        a.askId = raiseAsk({ pending: { tool: result.tool, input: result.input, transcript: result.transcript, trace: result.trace, activity: result.activity },
          tier: s.tier, source: "swarm", why: `a background specialist (${a.name}) needs this to continue`,
          swarmRef: { swarmId, agentId } }).id;
      }
    }
  });
  checkSwarmCompletion(swarmId);
}

// 2. The Agent Background Loop
async function runAgentLoop(swarmId: string, agentId: string) {
  const s = getSwarm(swarmId);
  if (!s) return;
  const a = s.agents.find((x) => x.id === agentId);
  if (a?.status !== "pending") return;

  updateSwarm(swarmId, (sw) => { sw.agents.find((x) => x.id === agentId)!.status = "running"; });
  const spec = byId(a.specialistId)!;
  const sys = `${s.system}\n\n## You are ${spec.name} ${spec.emoji} — one of SAM's specialists, channelling ${spec.modeledOn}.\nYour lane: ${spec.brief}\nDo YOUR part of the job only, brilliantly. Be concise and concrete.`;

  try {
    const result = await runAgent(sys, a.task, s.tier as Tier, undefined, false, /* swarm */ true);
    handleAgentResult(swarmId, agentId, result);
  } catch (e: any) {
    updateSwarm(swarmId, (sw) => {
      const ag = sw.agents.find((x) => x.id === agentId);
      if (ag) { ag.status = "error"; ag.output = e?.message || "Error"; }
    });
    checkSwarmCompletion(swarmId);
  }
}

// 3. User Approves/Declines a paused agent
export async function approveAgent(swarmId: string, agentId: string, approved: boolean) {
  const s = getSwarm(swarmId);
  if (!s) throw new Error("Swarm not found");
  const a = s.agents.find((x) => x.id === agentId);
  if (a?.status !== "paused") throw new Error("Agent not paused");

  if (a.askId) resolveAsk(a.askId, approved);   // keep the Ask record in sync (no double-handling by the sweep)

  updateSwarm(swarmId, (sw) => {
    const ag = sw.agents.find((x) => x.id === agentId)!;
    ag.status = "running";
    ag.pendingTool = undefined;
    ag.askId = undefined;
  });

  const spec = byId(a.specialistId)!;
  const sys = `${s.system}\n\n## You are ${spec.name} ${spec.emoji} — one of SAM's specialists, channelling ${spec.modeledOn}.\nYour lane: ${spec.brief}\nDo YOUR part of the job only, brilliantly.`;

  try {
    const result = await resumeAgent(sys, a.transcript!, s.tier as Tier, approved, a.pendingTool!, a.pendingInput, a.trace, /* swarm */ true);
    handleAgentResult(swarmId, agentId, result);
  } catch (e: any) {
    updateSwarm(swarmId, (sw) => {
      const ag = sw.agents.find((x) => x.id === agentId);
      if (ag) { ag.status = "error"; ag.output = e?.message || "Error"; }
    });
    checkSwarmCompletion(swarmId);
  }
}

// Check if all agents are done/error, and synthesise
async function checkSwarmCompletion(swarmId: string) {
  const s = getSwarm(swarmId);
  if (!s || s.status === "done" || s.status === "error") return;
  // AUDIT FIX: `[].every()` is vacuously TRUE, so a swarm with NO agents (crashed while still
  // planning, before makePlan populated it) would read as "all finished" → get flipped to 'done'
  // and a synthesis fabricated over zero real work. A swarm that hasn't started is not complete.
  if (s.status === "planning" || s.agents.length === 0) return;

  const allFinished = s.agents.every((a) => a.status === "done" || a.status === "error");
  const anyPaused = s.agents.some((a) => a.status === "paused");

  if (anyPaused && s.status !== "paused") {
    updateSwarm(swarmId, (sw) => { sw.status = "paused"; });
  } else if (!anyPaused && s.status === "paused" && !allFinished) {
    updateSwarm(swarmId, (sw) => { sw.status = "running"; });
  }

  if (allFinished) {
    updateSwarm(swarmId, (sw) => { sw.status = "done"; });

    // ── VERIFIER PASS (V2): before synthesis, independently validate each agent's
    // output. Hollow outputs ("Failed.", empty strings, one-liners for a multi-step
    // task) are flagged so they don't corrupt the final synthesis. A swarm that passes
    // random noise to the synthesiser looks done but delivers garbage — this gate catches it.
    const verifiedOutputs = await Promise.all(
      s.agents.map(async (a) => {
        if (a.status === "error" || !a.output || a.output.trim().length < 20) {
          return { name: a.name, emoji: a.emoji, task: a.task, output: "(agent did not produce a usable output)", verified: false };
        }
        // Lightweight verifier: ask the model if this output meaningfully answers the task.
        // Uses the free tier — a small/fast model is perfectly capable of this binary judgement.
        try {
          const vSys = `You are a strict verifier. Given a task and the agent's output, reply with ONLY "PASS" if the output meaningfully addresses the task, or "FAIL: <one-line reason>" if it doesn't. No other text.`;
          const vPrompt = `Task: ${a.task}\n\nAgent output:\n${a.output.slice(0, 800)}`;
          const vr = await runModel(s.tier as Tier, vSys, vPrompt);
          const verdict = vr.text.trim();
          if (verdict.startsWith("FAIL")) {
            console.warn(`[SAM] swarm verifier: agent "${a.name}" flagged — ${verdict}`);
            return { name: a.name, emoji: a.emoji, task: a.task, output: a.output, verified: false, flag: verdict };
          }
        } catch { /* verifier hiccup — treat as passed rather than blocking synthesis */ }
        return { name: a.name, emoji: a.emoji, task: a.task, output: a.output, verified: true };
      })
    );

    const passCount = verifiedOutputs.filter((v) => v.verified).length;
    const synthSys = `${s.system}\n\nYour swarm just completed the massive goal. ${passCount < verifiedOutputs.length ? `Note: ${verifiedOutputs.length - passCount} agent(s) did not fully complete their task — synthesise from what you have, honestly noting any gaps.` : "All agents passed verification."}\n\nCombine their work into ONE final, clear synthesis. Don't just list their outputs; synthesise the outcome.`;
    const brief = verifiedOutputs.map((a) => `## ${a.name} ${a.emoji} — ${a.task}\n${a.output}${a.verified === false && (a as any).flag ? `\n⚠️ Verifier note: ${(a as any).flag}` : ""}`).join("\n\n");
    try {
      const r = await runModel(s.tier as Tier, synthSys, `Goal: ${s.goal}\n\n${brief}\n\nFinal outcome:`);
      updateSwarm(swarmId, (sw) => { sw.synthesis = r.text; });
    } catch {
      updateSwarm(swarmId, (sw) => { sw.synthesis = "The swarm finished, but failed to write the final synthesis."; });
    }
  }

}

// Boot loop: pick up any "running" or "pending" agents that died during an app restart
export function resumeOrphanedSwarms() {
  const swarms = loadSwarms();
  for (const s of swarms) {
    if (s.status === "running" || s.status === "planning") {
      // Re-fire pending/running agents.
      // (Actually, 'running' ones might need their transcript re-run if they crashed mid-step, 
      // but for V1 we can just re-run them from scratch if they have no transcript,
      // or if we had fine-grained checkpoints we'd resume. For now, we'll mark 'running' as 'error' 
      // if they crashed, and only fire 'pending' ones).
      updateSwarm(s.id, (sw) => {
        for (const a of sw.agents) {
          if (a.status === "running") {
            a.status = "error";
            a.output = "Agent was interrupted during an app restart.";
          }
        }
      });
      const updated = getSwarm(s.id)!;
      // AUDIT FIX: a swarm that died while still 'planning' (agents never populated) can't be
      // resumed — mark it honestly as errored rather than letting it linger or be fabricated 'done'.
      if (updated.status === "planning" || updated.agents.length === 0) {
        updateSwarm(s.id, (sw) => { sw.status = "error"; sw.synthesis = "Interrupted during planning by an app restart — start it again."; });
        continue;
      }
      for (const a of updated.agents) {
        if (a.status === "pending") void runAgentLoop(s.id, a.id);
      }
      checkSwarmCompletion(s.id);
    }
  }
}

export function stopSwarm(id: string): boolean {
  const s = getSwarm(id);
  if (!s) return false;
  updateSwarm(id, (sw) => {
    sw.status = "error";
    sw.synthesis = "Swarm was manually killed by admin.";
    for (const a of sw.agents) {
      if (a.status === "running" || a.status === "pending" || a.status === "paused") {
        a.status = "error";
        a.output = "Killed by admin.";
      }
    }
  });
  return true;
}

export async function spawnSubAgent(opts: {
  task: string;
  specialistId?: string;
  tier?: Tier;
}): Promise<{ id: string; status: string; output: string }> {
  const specId = opts.specialistId && byId(opts.specialistId) ? opts.specialistId : "coder";
  const spec = byId(specId) || SPECIALISTS[0];
  const tier: Tier = opts.tier || "free";
  const agentId = "sub-" + Math.random().toString(36).slice(2, 9);
  
  const systemPrompt = `You are ${spec.name} (${spec.emoji}). ${spec.brief}\nGoal: ${opts.task}\nComplete this subtask autonomously using the provided tools. Be thorough and verify your changes.`;
  
  try {
    // swarm=true ensures risky/mutating tools always pause for human approval
    const res = await runAgent(systemPrompt, opts.task, tier, undefined, false, true);
    return {
      id: agentId,
      status: res.kind === "final" ? "done" : "paused",
      output: res.kind === "final" ? (res.text || "Task completed.") : (res.preview || "Subagent paused waiting for tool authorization."),
    };
  } catch (e: any) {
    return {
      id: agentId,
      status: "error",
      output: `Subagent failed: ${e.message}`,
    };
  }
}

export interface FanoutTask {
  id?: string;
  task: string;
  specialistId?: string;
  tier?: Tier;
}

export interface FanoutResult {
  total: number;
  completed: number;
  failed: number;
  results: { id: string; task: string; specialist: string; status: "done" | "paused" | "error"; output: string; durationMs: number }[];
  synthesis?: string;
}

/**
 * 50x SWARM FAN-OUT — Dispatches up to 50 specialist subagents concurrently
 * across partitioned subtasks with bounded pool concurrency and automatic synthesis.
 */
export async function swarmFanout(
  tasks: (string | FanoutTask)[],
  options: {
    concurrency?: number;
    synthesize?: boolean;
    system?: string;
    tier?: Tier;
    goal?: string;
  } = {}
): Promise<FanoutResult> {
  const normalizedTasks: FanoutTask[] = tasks.map((t, idx) => {
    if (typeof t === "string") return { id: `task-${idx + 1}`, task: t, specialistId: "coder" };
    return {
      id: t.id || `task-${idx + 1}`,
      task: t.task,
      specialistId: t.specialistId || (t as any).specialist || "coder",
      tier: t.tier,
    };
  }).slice(0, 50); // Cap at 50 for 50x scaling safely

  const concurrency = Math.min(Math.max(1, options.concurrency || 8), 50);
  const results: FanoutResult["results"] = [];
  let completed = 0;
  let failed = 0;

  // Bounded concurrency pool
  const queue = [...normalizedTasks];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const t0 = Date.now();
      try {
        const res = await spawnSubAgent({
          task: item.task,
          specialistId: item.specialistId,
          tier: item.tier || options.tier,
        });
        const durationMs = Date.now() - t0;
        if (res.status === "done") completed++;
        else if (res.status === "error") failed++;
        results.push({
          id: item.id || res.id,
          task: item.task,
          specialist: item.specialistId || "coder",
          status: res.status as any,
          output: res.output,
          durationMs,
        });
      } catch (e: any) {
        failed++;
        results.push({
          id: item.id || `err-${Math.random().toString(36).slice(2, 7)}`,
          task: item.task,
          specialist: item.specialistId || "coder",
          status: "error",
          output: e?.message || "Task failed",
          durationMs: Date.now() - t0,
        });
      }
    }
  });

  await Promise.all(workers);

  // Optional reduction / synthesis pass
  let synthesis: string | undefined;
  if (options.synthesize && results.length > 0) {
    const tier = options.tier || "free";
    const synthSys = options.system || "You are SAM's swarm synthesizer. Combine the parallel task outputs into ONE concise, structured, high-density summary report highlighting accomplishments, key data, and any issues.";
    const summaryList = results.map((r, i) => `### Subtask ${i + 1} (${r.specialist}) [${r.status}]: ${r.task}\n${r.output}`).join("\n\n");
    try {
      const sr = await runModel(tier, synthSys, `Goal: ${options.goal || "50x Parallel Swarm Execution"}\n\n${summaryList}\n\nSynthesis:`);
      synthesis = sr.text;
    } catch {
      synthesis = `Completed ${completed} of ${results.length} tasks in parallel.`;
    }
  }

  return {
    total: normalizedTasks.length,
    completed,
    failed,
    results,
    synthesis,
  };
}

export interface PipelineStage {
  id?: string;
  name: string;
  specialistId: string;
  taskTemplate: string; // supports {{previous}} and {{stages.<id|name>.output}}
  tier?: Tier;
  optional?: boolean; // if true, failure does not abort the pipeline
}

export interface PipelineResult {
  pipelineId: string;
  status: "done" | "aborted" | "error";
  stages: {
    id: string;
    name: string;
    specialist: string;
    status: "done" | "paused" | "error" | "skipped";
    input: string;
    output: string;
    durationMs: number;
  }[];
  finalOutput: string;
  synthesis?: string;
}

/**
 * ── MULTI-STAGE SWARM PIPELINE ──
 * Chains specialist subagents sequentially where each stage receives
 * outputs from previous stages with validation gates and synthesis.
 */
export async function swarmPipeline(
  stages: PipelineStage[],
  options: {
    initialInput?: string;
    synthesize?: boolean;
    goal?: string;
    tier?: Tier;
  } = {}
): Promise<PipelineResult> {
  const pipelineId = "pip-" + Math.random().toString(36).slice(2, 9);
  const stageOutputs: Record<string, string> = {};
  const results: PipelineResult["stages"] = [];
  let previousOutput = options.initialInput || "";
  let aborted = false;

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const stageId = stage.id || `stage-${i + 1}`;
    
    if (aborted) {
      results.push({
        id: stageId,
        name: stage.name,
        specialist: stage.specialistId,
        status: "skipped",
        input: "",
        output: "Skipped due to earlier pipeline failure.",
        durationMs: 0,
      });
      continue;
    }

    // Interpolate {{previous}} and {{stages.<key>.output}}
    let resolvedTask = stage.taskTemplate.replace(/\{\{previous\}\}/gi, previousOutput);
    for (const [k, v] of Object.entries(stageOutputs)) {
      resolvedTask = resolvedTask.replace(new RegExp(`\\{\\{stages\\.${k}\\.output\\}\\}`, "gi"), v);
    }

    const t0 = Date.now();
    try {
      const res = await spawnSubAgent({
        task: resolvedTask,
        specialistId: stage.specialistId,
        tier: stage.tier || options.tier,
      });
      const durationMs = Date.now() - t0;
      const isSuccess = res.status === "done";
      
      results.push({
        id: stageId,
        name: stage.name,
        specialist: stage.specialistId,
        status: res.status as any,
        input: resolvedTask,
        output: res.output,
        durationMs,
      });

      if (isSuccess) {
        previousOutput = res.output;
        stageOutputs[stageId] = res.output;
        stageOutputs[stage.name] = res.output;
      } else if (!stage.optional) {
        aborted = true;
      }
    } catch (e: any) {
      results.push({
        id: stageId,
        name: stage.name,
        specialist: stage.specialistId,
        status: "error",
        input: resolvedTask,
        output: e?.message || "Stage execution failed",
        durationMs: Date.now() - t0,
      });
      if (!stage.optional) aborted = true;
    }
  }

  const finalOutput = previousOutput || (results[results.length - 1]?.output || "Pipeline finished with no output.");
  let synthesis: string | undefined;

  if (options.synthesize && results.length > 0) {
    const tier = options.tier || "free";
    const synthSys = "You are SAM's pipeline synthesizer. Given a multi-stage specialist pipeline run, produce a clean end-to-end summary of what was accomplished and the final result.";
    const report = results.map((r, i) => `### Step ${i + 1}: ${r.name} (${r.specialist}) [${r.status}]\n${r.output}`).join("\n\n");
    try {
      const sr = await runModel(tier, synthSys, `Pipeline Goal: ${options.goal || "Multi-stage Execution"}\n\n${report}\n\nSynthesis:`);
      synthesis = sr.text;
    } catch {
      synthesis = finalOutput;
    }
  }

  return {
    pipelineId,
    status: aborted ? "aborted" : "done",
    stages: results,
    finalOutput,
    synthesis,
  };
}



