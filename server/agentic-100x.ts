// ─────────────────────────────────────────────────────────────
//  S.A.M. · 100X ANTIGRAVITY AGENTIC SUPER-ENGINE
//
//  Elevates SAM to 100x Antigravity capabilities:
//   1. Autonomous DAG Task Decomposition & Parallel Wave Execution
//   2. Multi-Branch Speculative Specialist Competition
//   3. Structured Artifact Generation & Validation Hub
//   4. High-Density Unified Reduction & Synthesis
// ─────────────────────────────────────────────────────────────

import { runModel, type Tier } from "./models.ts";
import { spawnSubAgent } from "./swarm.ts";

export interface TaskNode {
  id: string;
  title: string;
  task: string;
  specialistId: string;
  dependencies: string[]; // IDs of tasks that must complete before this can run
  status: "pending" | "running" | "done" | "error" | "skipped";
  output?: string;
  durationMs?: number;
}

export interface TaskGraph {
  goal: string;
  nodes: TaskNode[];
}

export interface ExecutionWave {
  waveIndex: number;
  nodeIds: string[];
  durationMs: number;
  parallelCount: number;
}

export interface Artifact {
  id: string;
  title: string;
  type: "code" | "plan" | "report" | "walkthrough" | "dataset";
  content: string;
  metadata: Record<string, any>;
  createdAt: number;
}

export interface Agentic100xResult {
  workflowId: string;
  goal: string;
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  waves: ExecutionWave[];
  artifacts: Artifact[];
  finalSynthesis: string;
  wallClockDurationMs: number;
  sequentialEstimatedMs: number;
  speedupFactor: number;
}

/**
 * Topologically sorts nodes into parallel execution waves where all nodes
 * in Wave N have their dependencies satisfied by Waves < N.
 */
export function buildExecutionWaves(nodes: TaskNode[]): string[][] {
  const nodeMap = new Map<string, TaskNode>(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const node of nodes) {
    const validDeps = (node.dependencies || []).filter((d) => nodeMap.has(d));
    inDegree.set(node.id, validDeps.length);
    for (const dep of validDeps) {
      const list = dependents.get(dep) || [];
      list.push(node.id);
      dependents.set(dep, list);
    }
  }

  const waves: string[][] = [];
  let ready = nodes.filter((n) => (inDegree.get(n.id) || 0) === 0).map((n) => n.id);

  const processed = new Set<string>();

  while (ready.length > 0) {
    waves.push(ready);
    for (const id of ready) processed.add(id);

    const nextReady: string[] = [];
    for (const id of ready) {
      const deps = dependents.get(id) || [];
      for (const nextId of deps) {
        if (processed.has(nextId)) continue;
        const currentInDegree = inDegree.get(nextId) || 0;
        const newInDegree = Math.max(0, currentInDegree - 1);
        inDegree.set(nextId, newInDegree);
        if (newInDegree === 0 && !nextReady.includes(nextId)) {
          nextReady.push(nextId);
        }
      }
    }
    ready = nextReady;
  }

  // Any remaining cycles or unvisited nodes are grouped into a final safety wave
  const unvisited = nodes.filter((n) => !processed.has(n.id)).map((n) => n.id);
  if (unvisited.length > 0) {
    waves.push(unvisited);
  }

  return waves;
}

/**
 * Decomposes a complex high-level prompt into a structured TaskGraph (DAG).
 */
export async function planTaskGraph(prompt: string, tier: Tier = "free"): Promise<TaskGraph> {
  const system = `You are SAM's 100x Antigravity DAG Task Planner.
Decompose the operator's goal into a Directed Acyclic Graph (DAG) of modular subtasks.
Output strict JSON with this shape:
{
  "goal": "...",
  "nodes": [
    {
      "id": "task-1",
      "title": "Short title",
      "task": "Specific actionable instruction",
      "specialistId": "coder" | "architect" | "security" | "researcher" | "growth" | "quant",
      "dependencies": []
    },
    {
      "id": "task-2",
      "title": "Dependent task title",
      "task": "Actionable instruction using output from task-1",
      "specialistId": "coder",
      "dependencies": ["task-1"]
    }
  ]
}`;

  try {
    const res = await runModel(tier, system, `Goal: ${prompt}\n\nPlan DAG:`);
    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
        return {
          goal: parsed.goal || prompt,
          nodes: parsed.nodes.map((n: any, i: number) => ({
            id: n.id || `node-${i + 1}`,
            title: n.title || `Step ${i + 1}`,
            task: n.task || prompt,
            specialistId: n.specialistId || "coder",
            dependencies: Array.isArray(n.dependencies) ? n.dependencies : [],
            status: "pending" as const,
          })),
        };
      }
    }
  } catch {
    // Fallback to standard 3-stage DAG on parse blip
  }

  return {
    goal: prompt,
    nodes: [
      { id: "node-1", title: "Analyze & Architect", task: `Analyze and outline solution for: ${prompt}`, specialistId: "architect", dependencies: [], status: "pending" },
      { id: "node-2", title: "Implement Core Logic", task: `Implement the solution according to specifications for: ${prompt}`, specialistId: "coder", dependencies: ["node-1"], status: "pending" },
      { id: "node-3", title: "Verify & Polish", task: `Verify correctness, security, and edge cases for: ${prompt}`, specialistId: "security", dependencies: ["node-2"], status: "pending" },
    ],
  };
}

/**
 * ── 100X AGENTIC WORKFLOW EXECUTION ENGINE ──
 * Executes a full DAG with concurrent wave dispatching, subagent isolation,
 * artifact collection, and executive reduction.
 */
export async function execute100xAgenticWorkflow(
  goalOrGraph: string | TaskGraph,
  options: {
    tier?: Tier;
    concurrency?: number;
    synthesize?: boolean;
    generateArtifacts?: boolean;
    subAgentRunner?: (task: string, specialistId: string) => Promise<{ status: string; output: string }>;
  } = {}
): Promise<Agentic100xResult> {
  const t0 = Date.now();
  const workflowId = "100x-" + Math.random().toString(36).slice(2, 9);
  const tier = options.tier || "free";

  let graph: TaskGraph;
  if (typeof goalOrGraph === "string") {
    graph = await planTaskGraph(goalOrGraph, tier);
  } else {
    graph = goalOrGraph;
  }

  const nodes = [...graph.nodes];
  const nodeMap = new Map<string, TaskNode>(nodes.map((n) => [n.id, n]));
  const wavePlan = buildExecutionWaves(nodes);
  const executionWaves: ExecutionWave[] = [];

  let completedNodes = 0;
  let failedNodes = 0;
  let sequentialEstimatedMs = 0;

  for (let w = 0; w < wavePlan.length; w++) {
    const waveNodeIds = wavePlan[w];
    const waveT0 = Date.now();

    const promises = waveNodeIds.map(async (nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      node.status = "running";
      const nodeT0 = Date.now();

      // Gather output context from dependencies
      const depContext = node.dependencies
        .map((depId) => {
          const dep = nodeMap.get(depId);
          return dep && dep.output ? `[Output from ${dep.title} (${depId})]:\n${dep.output}` : "";
        })
        .filter(Boolean)
        .join("\n\n");

      const enrichedTask = depContext
        ? `${node.task}\n\nContext from prior dependencies:\n${depContext}`
        : node.task;

      try {
        const sub = options.subAgentRunner
          ? await options.subAgentRunner(enrichedTask, node.specialistId)
          : await spawnSubAgent({
              task: enrichedTask,
              specialistId: node.specialistId,
              tier,
            });

        node.durationMs = Date.now() - nodeT0;
        node.output = sub.output || "Completed successfully.";
        node.status = sub.status === "error" ? "error" : "done";

        if (node.status === "done") completedNodes++;
        else failedNodes++;
      } catch (e: any) {
        node.durationMs = Date.now() - nodeT0;
        node.output = `Error: ${e?.message || e}`;
        node.status = "error";
        failedNodes++;
      }

      sequentialEstimatedMs += node.durationMs || 1000;
    });

    await Promise.all(promises);

    const waveDurationMs = Date.now() - waveT0;
    executionWaves.push({
      waveIndex: w + 1,
      nodeIds: waveNodeIds,
      durationMs: waveDurationMs,
      parallelCount: waveNodeIds.length,
    });
  }

  const wallClockDurationMs = Math.max(1, Date.now() - t0);
  const speedupFactor = Number(
    Math.max(1, sequentialEstimatedMs / wallClockDurationMs).toFixed(2)
  );

  // Generate Artifacts
  const artifacts: Artifact[] = [];
  if (options.generateArtifacts !== false) {
    for (const node of nodes) {
      if (node.status === "done" && node.output && node.output.length > 50) {
        artifacts.push({
          id: `art-${node.id}`,
          title: node.title,
          type: node.specialistId === "coder" ? "code" : "report",
          content: node.output,
          metadata: {
            specialist: node.specialistId,
            durationMs: node.durationMs,
          },
          createdAt: Date.now(),
        });
      }
    }
  }

  // Executive Synthesis
  let finalSynthesis = `Completed 100x workflow across ${executionWaves.length} execution waves with ${completedNodes}/${nodes.length} nodes successful (${speedupFactor}x parallel speedup).`;
  if (options.synthesize !== false) {
    const summaryBlock = nodes
      .map(
        (n) => `### ${n.title} (${n.specialistId}) [${n.status} - ${n.durationMs}ms]:\n${(n.output || "").slice(0, 350)}`
      )
      .join("\n\n");

    try {
      const synRes = await runModel(
        tier,
        "You are SAM's 100x Executive Director. Synthesize the multi-agent DAG workflow results into a crisp, high-impact executive summary.",
        `Goal: ${graph.goal}\n\nNode Results:\n${summaryBlock}\n\nExecutive Synthesis:`
      );
      if (synRes.text) finalSynthesis = synRes.text;
    } catch {
      // Use standard synthesis
    }
  }

  return {
    workflowId,
    goal: graph.goal,
    totalNodes: nodes.length,
    completedNodes,
    failedNodes,
    waves: executionWaves,
    artifacts,
    finalSynthesis,
    wallClockDurationMs,
    sequentialEstimatedMs,
    speedupFactor,
  };
}
