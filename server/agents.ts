// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE TEAM  — multi-agent orchestration
//  SAM (the Mind) breaks a request into subtasks, dispatches a
//  crew of specialists (each modelled on a world-class operator),
//  runs them IN PARALLEL, then synthesises one answer.
//  Opt-in (the "big guns") — kept free via the rotating providers.
// ─────────────────────────────────────────────────────────────

import { runModel, Tier } from "./models.ts";
import { runAgent } from "./agent.ts";

export interface Specialist { id: string; name: string; emoji: string; modeledOn: string; brief: string }

// The crew — each a focused persona channelling the best in their lane.
export const SPECIALISTS: Specialist[] = [
  { id: "scout",  name: "Scout",  emoji: "🔬", modeledOn: "a world-class investigative analyst", brief: "Research, fact-finding, competitive intel. Dig, verify with the web, cite. Never guess." },
  { id: "forge",  name: "Forge",  emoji: "🛠️", modeledOn: "John Carmack — first-principles engineer", brief: "Code, repos, build & fix. Reason from first principles, ship clean, no bloat." },
  { id: "quill",  name: "Quill",  emoji: "✍️", modeledOn: "David Ogilvy — the ad legend", brief: "Writing & content. Sharp, persuasive, on-brand copy that sells." },
  { id: "ledger", name: "Ledger", emoji: "📊", modeledOn: "Warren Buffett & Alan Sugar", brief: "Money, numbers, strategy. Margins, risk, what actually pays — blunt and real." },
  { id: "spark",  name: "Spark",  emoji: "📣", modeledOn: "a viral growth marketer", brief: "Marketing & growth. Hooks, distribution, what spreads and why." },
  { id: "envoy",  name: "Envoy",  emoji: "🤝", modeledOn: "Chris Voss & Richard Branson", brief: "Deals, outreach, negotiation. Calm, persuasive, gets the yes." },
  { id: "judge",  name: "Judge",  emoji: "⚖️", modeledOn: "a ruthless editor & fact-checker", brief: "Review & verify. Catch errors, hallucinations and weak logic; sharpen it before it ships. The quality gate." },
  { id: "surfer", name: "Surfer", emoji: "🏄‍♂️", modeledOn: "a hardcore web scraper", brief: "Web automation & UI navigation. Launch browsers, click, type, and extract data directly from the DOM." },
  { id: "scholar", name: "Scholar", emoji: "📚", modeledOn: "an archival researcher", brief: "Document ingestion. Read, extract, and synthesize massive PDFs, Word documents, and offline files." },
  { id: "hacker", name: "Hacker", emoji: "💻", modeledOn: "a chaotic-good red teamer", brief: "Terminal, network, & cyber. Ping, scan ports, check vulnerabilities, debug raw system logic." },
];

// 🥷 THE NINJAS — the problem squad. You point them at something; they find what's
// wrong and deal with it straight up. No hand-holding — they smell trouble coming.
export const NINJAS: Specialist[] = [
  { id: "hawk",   name: "Hawk",   emoji: "🦅", modeledOn: "a paranoid ops chief", brief: "Find the problems — blockers, risks, debts, overdue, loose ends, weak points. Smell trouble before it lands. Rank by severity." },
  { id: "reaper", name: "Reaper", emoji: "🥷", modeledOn: "a no-nonsense fixer", brief: "Deal with it. For each problem: fix the safe ones now (use tools), and give the decisive move on the rest. Done, not described." },
  { id: "chaser", name: "Chaser", emoji: "💼", modeledOn: "a relentless debt collector", brief: "Chase what's owed, overdue or unfinished — follow-ups, invoices, promises. Draft the message that closes it." },
];

const byId = (id: string) => [...SPECIALISTS, ...NINJAS].find((s) => s.id === id);

export type PlanItem = { id: string; specialist: string; task: string; dependsOn: string[] };

// Pull a JSON array of {id, specialist, task, dependsOn} out of a model reply.
function parsePlan(text: string): PlanItem[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr)
      ? arr.filter((x) => x && x.id && byId(x.specialist) && x.task).map((x) => ({
          id: String(x.id),
          specialist: String(x.specialist),
          task: String(x.task),
          dependsOn: Array.isArray(x.dependsOn) ? x.dependsOn.map(String) : []
        })).slice(0, 7) // Cap at 7 agents
      : [];
  } catch { return []; }
}

// Orchestrator: break the request into a dynamic dependency graph.
async function makePlan(request: string, tier: Tier): Promise<PlanItem[]> {
  const roster = SPECIALISTS.map((s) => `- ${s.id} (${s.name}): ${s.brief}`).join("\n");
  const sys = `You are SAM's orchestrator. Break the user's request into up to 7 focused subtasks and assign each to the ONE best specialist. 
You MUST provide a JSON array of tasks. Each task needs an 'id' (e.g. 't1'), a 'specialist', a 'task' description, and an array of 'dependsOn' task IDs if it needs the output of prior tasks. 
Example: [{"id":"t1","specialist":"scout","task":"search web","dependsOn":[]}, {"id":"t2","specialist":"quill","task":"write report","dependsOn":["t1"]}]
Reply with ONLY the JSON array.

Specialists:
${roster}`;
  const r = await runModel(tier, sys, `Request: ${request}\n\nJSON plan:`);
  const plan = parsePlan(r.text);
  return plan.length ? plan : [{ id: "t1", specialist: "scout", task: request, dependsOn: [] }];
}

export type TeamEvent =
  | { type: "plan"; plan: { id?: string; specialist: string; name: string; emoji: string; task: string; dependsOn?: string[] }[] }
  | { type: "agent-start"; id: string; name: string; emoji: string; task: string }
  | { type: "agent-done"; id: string; name: string; emoji: string; output: string }
  | { type: "final"; text: string; provider?: string };

// Run the whole team on a request using topological dependency execution.
export async function runTeam(request: string, tier: Tier, baseSystem: string, emit: (e: TeamEvent) => void): Promise<string> {
  const plan = await makePlan(request, tier);
  emit({ type: "plan", plan: plan.map((p) => { const s = byId(p.specialist)!; return { id: p.id, specialist: p.specialist, name: s.name, emoji: s.emoji, task: p.task, dependsOn: p.dependsOn }; }) });

  const results: { s: Specialist; task: string; output: string }[] = [];
  const taskPromises = new Map<string, Promise<string>>();

  for (const item of plan) {
    const runner = async () => {
      // 1. Wait for dependencies
      const depOutputs: string[] = [];
      for (const dep of item.dependsOn) {
        if (taskPromises.has(dep)) {
          depOutputs.push(`=== Output from ${dep} ===\n${await taskPromises.get(dep)}`);
        }
      }
      const depContext = depOutputs.length ? `\n\n## DEPENDENCY OUTPUTS:\n${depOutputs.join("\n\n")}` : "";

      // 2. Run agent
      const s = byId(item.specialist)!;
      emit({ type: "agent-start", id: s.id, name: s.name, emoji: s.emoji, task: item.task });
      const sys = `${baseSystem}\n\n## You are ${s.name} ${s.emoji} — one of SAM's specialists, channelling ${s.modeledOn}.\nYour lane: ${s.brief}\nDo YOUR part of the job only, brilliantly. Be concise and concrete. If you need live info, use your tools.${depContext}`;
      
      let output = "";
      try { 
        const r = await runAgent(sys, item.task, tier); 
        output = r.kind === "final" ? (r.text || "") : `(needs approval to ${r.tool})`; 
      }
      catch (e: any) { output = `(couldn't complete: ${e?.message || e})`; }
      
      emit({ type: "agent-done", id: s.id, name: s.name, emoji: s.emoji, output });
      results.push({ s, task: item.task, output });
      return output;
    };
    taskPromises.set(item.id, runner());
  }

  await Promise.allSettled(Array.from(taskPromises.values()));

  // SAM synthesises the crew's work into one answer.
  const synthSys = `${baseSystem}\n\nYour specialists just did the work below. Combine it into ONE clear, punchy answer for the user — lead with the outcome, weave the pieces together, briefly credit the crew. Don't just list their outputs; synthesise.`;
  const brief = results.map((r) => `## ${r.s.name} ${r.s.emoji} — ${r.task}\n${r.output}`).join("\n\n");
  const r = await runModel(tier, synthSys, `Original request: ${request}\n\n${brief}\n\nSAM's final answer:`);
  emit({ type: "final", text: r.text, provider: r.provider });
  return r.text;
}

// 🥷 Deploy the Ninjas: Hawk hunts problems → Reaper & Chaser deal with them → hit-list.
export async function runNinjas(target: string, tier: Tier, baseSystem: string, emit: (e: TeamEvent) => void): Promise<string> {
  const hawk = NINJAS[0];
  emit({ type: "plan", plan: NINJAS.map((n) => ({ specialist: n.id, name: n.name, emoji: n.emoji, task: n.id === "hawk" ? "hunt the problems" : "deal with them" })) });

  // 1) Hawk hunts.
  emit({ type: "agent-start", id: hawk.id, name: hawk.name, emoji: hawk.emoji, task: "hunting problems" });
  const hawkSys = `${baseSystem}\n\n## You are Hawk 🦅 — ${hawk.modeledOn}. ${hawk.brief}\nUse your tools to check reality (files, repos, calendar, etc.) where it helps. Return a tight, ranked list of the REAL problems.`;
  let found = "";
  try { const r = await runAgent(hawkSys, `Hunt down every problem, risk, blocker, overdue item, loose end or weak point in: ${target}`, tier); found = r.kind === "final" ? (r.text || "") : "(paused for approval)"; }
  catch (e: any) { found = `(couldn't complete: ${e?.message || e})`; }
  emit({ type: "agent-done", id: hawk.id, name: hawk.name, emoji: hawk.emoji, output: found });

  // 2) Reaper + Chaser deal with what Hawk found — in parallel.
  const closers = [NINJAS[1], NINJAS[2]];
  const dealt = await Promise.all(closers.map(async (n) => {
    emit({ type: "agent-start", id: n.id, name: n.name, emoji: n.emoji, task: n.id === "reaper" ? "fixing what can be fixed" : "chasing what's owed" });
    const sys = `${baseSystem}\n\n## You are ${n.name} ${n.emoji} — ${n.modeledOn}. ${n.brief}\nWork ONLY from the problems Hawk found below. Be decisive and concrete — fix/act where safe, draft what closes it. No waffle.`;
    let out = "";
    try { const r = await runAgent(sys, `Problems Hawk found:\n${found}\n\nTarget: ${target}\n\nYour move:`, tier); out = r.kind === "final" ? (r.text || "") : "(paused for approval)"; }
    catch (e: any) { out = `(couldn't complete: ${e?.message || e})`; }
    emit({ type: "agent-done", id: n.id, name: n.name, emoji: n.emoji, output: out });
    return { n, out };
  }));

  // 3) SAM's hit-list.
  const synthSys = `${baseSystem}\n\nThe Ninjas just ran. Give the user a straight HIT-LIST: the problems found, what got dealt with, and the decisive next moves. Blunt, ranked, no fluff.`;
  const brief = `Hawk 🦅 found:\n${found}\n\n${dealt.map((d) => `${d.n.name} ${d.n.emoji}:\n${d.out}`).join("\n\n")}`;
  const r = await runModel(tier, synthSys, `Target: ${target}\n\n${brief}\n\nThe hit-list:`);
  emit({ type: "final", text: r.text, provider: r.provider });
  return r.text;
}
