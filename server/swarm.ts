// ─────────────────────────────────────────────────────────────
//  S.A.M. · CONTINUOUS SWARM
//  Long-running, asynchronous background agents. Swarms persist
//  across restarts. Agents pause when hitting risky tools and
//  wait for UI approval.
// ─────────────────────────────────────────────────────────────

import { runModel, Tier } from "./models.ts";
import { runAgent, resumeAgent, AgentResult } from "./agent.ts";
import { SPECIALISTS, NINJAS, Specialist } from "./agents.ts";
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

export function loadSwarms(): Swarm[] {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")); } catch {}
  return [];
}

function saveSwarms(swarms: Swarm[]) {
  let toSave = swarms;
  if (swarms.length > 50) {
    const active = swarms.filter((s) => s.status === "running" || s.status === "paused" || s.status === "planning");
    const finished = swarms.filter((s) => s.status === "done" || s.status === "error").sort((a, b) => b.created - a.created);
    toSave = [...active, ...finished.slice(0, Math.max(0, 50 - active.length))];
  }
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(toSave, null, 2)); } catch {}
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
  const sys = `You are SAM's orchestrator. Break the user's massive goal into 2-5 focused subtasks and assign each to the ONE best specialist. Reply with ONLY a JSON array, nothing else: [{"specialist":"<id>","task":"<clear instruction>"}].\n\nSpecialists:\n${roster}`;
  const r = await runModel(tier, sys, `Goal: ${goal}\n\nJSON plan:`);
  const m = r.text.match(/\[[\s\S]*\]/);
  if (!m) return [{ specialist: "scout", task: goal }];
  try {
    const arr = JSON.parse(m[0]);
    const plan = Array.isArray(arr) ? arr.filter((x) => x && byId(x.specialist) && x.task).map((x) => ({ specialist: x.specialist, task: String(x.task) })) : [];
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
    }
  });
  checkSwarmCompletion(swarmId);
}

// 2. The Agent Background Loop
async function runAgentLoop(swarmId: string, agentId: string) {
  const s = getSwarm(swarmId);
  if (!s) return;
  const a = s.agents.find((x) => x.id === agentId);
  if (!a || a.status !== "pending") return;

  updateSwarm(swarmId, (sw) => { sw.agents.find((x) => x.id === agentId)!.status = "running"; });
  const spec = byId(a.specialistId)!;
  const sys = `${s.system}\n\n## You are ${spec.name} ${spec.emoji} — one of SAM's specialists, channelling ${spec.modeledOn}.\nYour lane: ${spec.brief}\nDo YOUR part of the job only, brilliantly. Be concise and concrete.`;

  try {
    const result = await runAgent(sys, a.task, s.tier as Tier);
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
  if (!a || a.status !== "paused") throw new Error("Agent not paused");

  updateSwarm(swarmId, (sw) => {
    const ag = sw.agents.find((x) => x.id === agentId)!;
    ag.status = "running";
    ag.pendingTool = undefined;
  });

  const spec = byId(a.specialistId)!;
  const sys = `${s.system}\n\n## You are ${spec.name} ${spec.emoji} — one of SAM's specialists, channelling ${spec.modeledOn}.\nYour lane: ${spec.brief}\nDo YOUR part of the job only, brilliantly.`;

  try {
    const result = await resumeAgent(sys, a.transcript!, s.tier as Tier, approved, a.pendingTool!, a.pendingInput, a.trace);
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

  const allFinished = s.agents.every((a) => a.status === "done" || a.status === "error");
  const anyPaused = s.agents.some((a) => a.status === "paused");

  if (anyPaused && s.status !== "paused") {
    updateSwarm(swarmId, (sw) => { sw.status = "paused"; });
  } else if (!anyPaused && s.status === "paused" && !allFinished) {
    updateSwarm(swarmId, (sw) => { sw.status = "running"; });
  }

  if (allFinished) {
    updateSwarm(swarmId, (sw) => { sw.status = "done"; });
    const synthSys = `${s.system}\n\nYour swarm just completed the massive goal. Combine their work into ONE final, clear synthesis. Don't just list their outputs; synthesise the outcome.`;
    const brief = s.agents.map((a) => `## ${a.name} ${a.emoji} — ${a.task}\n${a.output || "Failed."}`).join("\n\n");
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
      for (const a of updated.agents) {
        if (a.status === "pending") void runAgentLoop(s.id, a.id);
      }
      checkSwarmCompletion(s.id);
    }
  }
}
