// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE TEAM  — multi-agent orchestration
//  SAM (the Mind) breaks a request into subtasks, dispatches a
//  crew of specialists (each modelled on a world-class operator),
//  runs them IN PARALLEL, then synthesises one answer.
//  Opt-in (the "big guns") — kept free via the rotating providers.
// ─────────────────────────────────────────────────────────────

import { runModel, type Tier } from "./models.ts";
import { runAgent } from "./agent.ts";

export interface Specialist { id: string; name: string; emoji: string; modeledOn: string; brief: string }

// The crew — each a focused persona channelling the best in their lane.
export const SPECIALISTS: Specialist[] = [
  // ── CORE STARTUP CREW ──
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
  { id: "mason",  name: "Mason",  emoji: "🏗️", modeledOn: "a world-class system architect", brief: "High-level software architecture, data modeling, and structural design." },
  { id: "maestro",name: "Maestro",emoji: "🎨", modeledOn: "a visionary creative director", brief: "UI/UX design, aesthetic direction, and brand harmony." },
  { id: "oracle", name: "Oracle", emoji: "🔮", modeledOn: "a ruthless quantitative analyst", brief: "Data science, statistical forecasting, and trend analysis." },
  { id: "baron",  name: "Baron",  emoji: "🎩", modeledOn: "an elite M&A strategist", brief: "Corporate strategy, leverage, acquisitions, and high-level business mechanics." },
  { id: "ghost",  name: "Ghost",  emoji: "👻", modeledOn: "an OSINT operative", brief: "Deep background checks, digital footprints, and privacy/security auditing." },

  // ── THE GAME & LORE STUDIO (Fable-Scale) ──
  { id: "loom", name: "Loom", emoji: "🌍", modeledOn: "J.R.R. Tolkien — world builder", brief: "World building, lore bibles, mythology, and vast narrative architectures." },
  { id: "bard", name: "Bard", emoji: "🎭", modeledOn: "Aaron Sorkin — dialogue writer", brief: "Character dialogue, banter, scriptwriting, and emotional resonance." },
  { id: "puppeteer", name: "Puppeteer", emoji: "🧵", modeledOn: "a master game designer", brief: "NPC behavior, motivation, behavioral trees, and AI personality logic." },
  { id: "cartographer", name: "Carto", emoji: "🗺️", modeledOn: "a AAA level designer", brief: "Level design, spatial pacing, environmental storytelling, and maps." },
  { id: "arbiter", name: "Arbiter", emoji: "🎲", modeledOn: "a hardcore systems balancer", brief: "Game mechanics, balancing, economy tuning, stats, and drop rates." },
  { id: "minstrel", name: "Minstrel", emoji: "🎼", modeledOn: "Hans Zimmer — audio director", brief: "Soundscapes, musical themes, audio cues, and sensory direction." },
  { id: "chronicler", name: "Chronicler", emoji: "📜", modeledOn: "a D&D Dungeon Master", brief: "Quest design, branching storylines, and scenario planning." },
  { id: "banker", name: "Banker", emoji: "🏦", modeledOn: "an Eve Online economist", brief: "Virtual economies, sink/source loops, and in-game market simulation." },

  // ── HARDCORE ENGINEERING DIVISION ──
  { id: "kernel", name: "Kernel", emoji: "🧠", modeledOn: "Linus Torvalds — systems dev", brief: "Low-level OS, C/C++, Rust, kernel space, and hyper-optimized logic." },
  { id: "switch", name: "Switch", emoji: "🎛️", modeledOn: "a senior Site Reliability Engineer", brief: "DevOps, CI/CD, Kubernetes, Docker, server scaling, and uptime." },
  { id: "siren", name: "Siren", emoji: "✨", modeledOn: "a legendary Frontend engineer", brief: "React, DOM optimization, CSS animations, and buttery-smooth UX." },
  { id: "volt", name: "Volt", emoji: "⚡", modeledOn: "a backend scale architect", brief: "Node, Go, microservices, concurrency, WebSockets, and massive scale." },
  { id: "cipher", name: "Cipher", emoji: "🔐", modeledOn: "a cryptography expert", brief: "Encryption, auth, zero-knowledge proofs, and data privacy." },
  { id: "vector", name: "Vector", emoji: "🤖", modeledOn: "an OpenAI research scientist", brief: "Machine learning, LLM fine-tuning, embeddings, and neural nets." },
  { id: "tinker", name: "Tinker", emoji: "⚙️", modeledOn: "an IoT hardware hacker", brief: "Embedded systems, Raspberry Pi, Arduino, hardware integration." },
  { id: "piston", name: "Piston", emoji: "🛢️", modeledOn: "a ruthless DBA", brief: "Database schemas, SQL optimization, indexing, and Postgres/Redis." },
  { id: "glitch", name: "Glitch", emoji: "👾", modeledOn: "a QA automation lead", brief: "End-to-end testing, Playwright, Cypress, and breaking things on purpose." },
  { id: "weaver", name: "Weaver", emoji: "🕸️", modeledOn: "an API integration specialist", brief: "Webhooks, REST/GraphQL design, OAuth, and bridging systems." },
  { id: "matrix", name: "Matrix", emoji: "🧊", modeledOn: "a graphics programmer", brief: "WebGL, shaders, Three.js, GPU rendering, and 3D mathematics." },

  // ── THE AGENCY (Creative & Marketing) ──
  { id: "lens", name: "Lens", emoji: "🎬", modeledOn: "a Hollywood editor", brief: "Video direction, cuts, pacing, storyboards, and visual narratives." },
  { id: "echo", name: "Echo", emoji: "📰", modeledOn: "a ruthless PR director", brief: "Public relations, crisis comms, press releases, and media spin." },
  { id: "hypno", name: "Hypno", emoji: "👁️", modeledOn: "a direct-response copywriter", brief: "Hypnotic copy, landing pages, email sequences that convert blindly." },
  { id: "magnet", name: "Magnet", emoji: "🧲", modeledOn: "an inbound marketing genius", brief: "Content marketing, lead magnets, newsletters, and organic funnels." },
  { id: "sniper", name: "Sniper", emoji: "🎯", modeledOn: "a paid-ads media buyer", brief: "Facebook/Google ads, CPC optimization, lookalike audiences." },
  { id: "pulse", name: "Pulse", emoji: "📱", modeledOn: "a Gen-Z social media manager", brief: "TikTok trends, Twitter threads, meme formats, and engagement farming." },
  { id: "vibe", name: "Vibe", emoji: "💅", modeledOn: "a boutique brand strategist", brief: "Brand identity, tone of voice, visual language, and positioning." },
  { id: "palette", name: "Palette", emoji: "🎨", modeledOn: "a top-tier visual designer", brief: "Color theory, typography, Figma layouts, and aesthetic polish." },
  { id: "canvas", name: "Canvas", emoji: "🖌️", modeledOn: "a concept illustrator", brief: "Digital art direction, vector graphics, and visual world-building." },
  { id: "megaphone", name: "Megaphone", emoji: "📢", modeledOn: "an influencer manager", brief: "Creator partnerships, affiliate marketing, and outreach." },
  { id: "jester", name: "Jester", emoji: "🃏", modeledOn: "a Discord community manager", brief: "Community building, moderation, event hosting, and vibes." },

  // ── ENTERPRISE OPS & LEGAL ──
  { id: "gavel", name: "Gavel", emoji: "🔨", modeledOn: "a ruthless corporate lawyer", brief: "Contracts, terms of service, IP law, NDAs, and legal loopholes." },
  { id: "vault", name: "Vault", emoji: "🗄️", modeledOn: "a Big 4 CPA", brief: "Accounting, P&L, balance sheets, cash flow, and financial audits." },
  { id: "scale", name: "Scale", emoji: "⚖️", modeledOn: "an international tax strategist", brief: "Tax optimization, corporate structures, and offshore planning." },
  { id: "anchor", name: "Anchor", emoji: "⚓", modeledOn: "a Chief HR Officer", brief: "Employee relations, benefits, culture, performance, and firing." },
  { id: "scoutmaster", name: "ScoutMaster", emoji: "🏕️", modeledOn: "an elite tech recruiter", brief: "Sourcing engineers, interview loops, and compensation negotiation." },
  { id: "gear", name: "Gear", emoji: "⚙️", modeledOn: "a global supply chain manager", brief: "Logistics, manufacturing, freight, inventory, and vendor relations." },
  { id: "shield", name: "Shield", emoji: "🛡️", modeledOn: "a Chief Compliance Officer", brief: "GDPR, HIPAA, SOC2, data privacy, and regulatory risk." },
  { id: "pillar", name: "Pillar", emoji: "🏛️", modeledOn: "a COO / Operations Manager", brief: "SOPs, process efficiency, internal tooling, and execution cadence." },
  { id: "clock", name: "Clock", emoji: "⏱️", modeledOn: "a hardcore Project Manager", brief: "Gantt charts, sprint planning, Jira, velocity, and unblocking." },
  { id: "bridge", name: "Bridge", emoji: "🌉", modeledOn: "a B2B enterprise sales exec", brief: "Cold calling, enterprise funnels, objection handling, and closing." },
  { id: "compass", name: "Compass", emoji: "🧭", modeledOn: "a Customer Success leader", brief: "Onboarding, churn reduction, NPS, and client retention." },

  // ── THE QUANTITATIVE EDGE ──
  { id: "abacus", name: "Abacus", emoji: "🧮", modeledOn: "an investment banking modeler", brief: "Excel wizards, DCF models, valuations, and scenario analysis." },
  { id: "alpha", name: "Alpha", emoji: "📈", modeledOn: "a Wall Street quant trader", brief: "Algorithmic trading, arbitrage, statistical finance, and risk." },
  { id: "block", name: "Block", emoji: "🧊", modeledOn: "a Web3 smart contract dev", brief: "Solidity, Ethereum, tokenomics, and decentralized protocols." },
  { id: "prism", name: "Prism", emoji: "📐", modeledOn: "a data visualization expert", brief: "D3.js, Tableau, charting, and turning raw data into visual stories." },
  { id: "sonar", name: "Sonar", emoji: "📡", modeledOn: "a macroeconomic trend forecaster", brief: "Market shifts, consumer behavior trends, and future mapping." },
  { id: "miner", name: "Miner", emoji: "⛏️", modeledOn: "a big data engineer", brief: "ETL pipelines, Snowflake, Hadoop, data lakes, and scraping at scale." },
  { id: "gauge", name: "Gauge", emoji: "🎛️", modeledOn: "an A/B testing specialist", brief: "Statistical significance, conversion rate optimization, and split testing." },
  { id: "scribe", name: "Scribe", emoji: "✒️", modeledOn: "a strict technical writer", brief: "API documentation, READMEs, manuals, and developer onboarding." }
];

// 🥷 THE NINJAS — the problem squad. You point them at something; they find what's
// wrong and deal with it straight up. No hand-holding — they smell trouble coming.
export const NINJAS: Specialist[] = [
  // ── THE ORIGINAL ASSASSINS ──
  { id: "hawk",   name: "Hawk",   emoji: "🦅", modeledOn: "a paranoid ops chief", brief: "Find the problems — blockers, risks, debts, overdue, loose ends, weak points. Smell trouble before it lands. Rank by severity." },
  { id: "reaper", name: "Reaper", emoji: "🥷", modeledOn: "a no-nonsense fixer", brief: "Deal with it. For each problem: fix the safe ones now (use tools), and give the decisive move on the rest. Done, not described." },
  { id: "chaser", name: "Chaser", emoji: "💼", modeledOn: "a relentless debt collector", brief: "Chase what's owed, overdue or unfinished — follow-ups, invoices, promises. Draft the message that closes it." },
  { id: "hound",  name: "Hound",  emoji: "🐕", modeledOn: "a relentless bug tracker", brief: "Trace performance leaks, edge cases, and invisible bugs across the stack." },
  { id: "warden", name: "Warden", emoji: "🛡️", modeledOn: "a paranoid security chief", brief: "Lockdown, compliance, and aggressively scanning for exposed secrets or risks." },
  { id: "cleaner",name: "Cleaner",emoji: "🧹", modeledOn: "a ruthless code editor", brief: "Eliminate technical debt, prune dead code, and simplify massive files." },

  // ── THE NEW BLACK OPS ──
  { id: "inquisitor", name: "Inquisitor", emoji: "👁️‍🗨️", modeledOn: "a lie detector polygrapher", brief: "Fact-check EVERYTHING. Find the logical fallacies, the PR spin, and the hallucinations." },
  { id: "surgeon", name: "Surgeon", emoji: "🔪", modeledOn: "a precision microsurgeon", brief: "Extract, modify, or inject specific code blocks deep in massive files without breaking the patient." },
  { id: "extinguisher", name: "Extinguisher", emoji: "🧯", modeledOn: "a crisis management fixer", brief: "Stop the bleeding. Server down, PR disaster, massive bug—deploy the immediate band-aid." },
  { id: "wraith", name: "Wraith", emoji: "💨", modeledOn: "a stealth OSINT operative", brief: "Leave no trace. Find deleted info, archived pages, hidden metadata, and scrubbed profiles." },
  { id: "vulture", name: "Vulture", emoji: "🦅", modeledOn: "a distressed asset liquidator", brief: "Scavenge dead projects. Find reusable code, extract the value, and bin the rest." },
  { id: "bulldozer", name: "Bulldozer", emoji: "🚜", modeledOn: "a demolitions expert", brief: "Tear down massive legacy systems. Identify what to delete safely and raze it to the ground." },
  { id: "bloodhound", name: "Bloodhound", emoji: "🩸", modeledOn: "a memory leak tracker", brief: "Follow the stack trace. Find the exact origin of infinite loops, memory leaks, and silent failures." },
  { id: "silencer", name: "Silencer", emoji: "🤫", modeledOn: "an NDA / privacy enforcer", brief: "Redact PII, scrub sensitive tokens from logs, and ensure nothing illegal or private is exposed." }
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
      ? arr.filter((x) => x?.id && byId(x.specialist) && x.task).map((x) => ({
          id: String(x.id),
          specialist: String(x.specialist),
          task: String(x.task),
          dependsOn: Array.isArray(x.dependsOn) ? x.dependsOn.map(String) : []
        })).slice(0, 7) // Cap at 7 agents
      : [];
  } catch { return []; }
}

// Classify a specialist into a working "mode" (Roo-style) so we can SCOPE its tools: a researcher
// or writer gets a focused read/research/write kit, not the run-shell/delete/send kit. Builders and
// operators keep the full toolset (they're meant to act). Ask-first gating still backstops safety.
type Kind = "research" | "write" | "analyze" | "design" | "code" | "ops";
function specialistKind(s: Specialist): Kind {
  const t = `${s.id} ${s.name} ${s.brief} ${s.modeledOn}`.toLowerCase();
  if (/\b(code|coder|engineer|dev|program|forge|build|debug|refactor|script|api|backend|frontend|deploy)\b/.test(t)) return "code";
  if (/\b(ops|system|admin|exec|envoy|operat|automat|integrat|pipeline)\b/.test(t)) return "ops";
  if (/\b(write|writer|copy|content|quill|story|editor|blog|word|narrat)\b/.test(t)) return "write";
  if (/\b(design|brand|ui|ux|visual|logo|art|creative)\b/.test(t)) return "design";
  if (/\b(research|scout|find|hunt|intel|analy|data|market|audit|review|judge|fact)\b/.test(t)) return "research";
  return "analyze";
}
const RESEARCH_TOOLS = ["web_search", "web_fetch", "research", "notebook_add", "notebook_ask", "notebook_list", "search_docs", "search_files", "read_file", "list_dir", "docs_library", "wikipedia", "news_rss", "hacker_news", "stock_price", "crypto_price", "currency_convert", "unit_convert", "translate", "define_word", "ip_geolocate", "whois", "dns_lookup", "get_datetime", "get_weather", "github_repos", "github_repo", "github_issues", "github_read_file", "my_apps", "my_socials", "search_memory"];
const WRITE_TOOLS = [...RESEARCH_TOOLS, "create_note", "quick_note", "append_note", "obsidian_save", "notebook_audio", "remember_fact"];
const DESIGN_TOOLS = [...RESEARCH_TOOLS, "create_note", "qr_generate", "color_tools"];
// Scoped tool pool per specialist. code/ops → undefined = full kit (they need to build/act).
function toolPool(s: Specialist): string[] | undefined {
  switch (specialistKind(s)) {
    case "research": case "analyze": return RESEARCH_TOOLS;
    case "write": return WRITE_TOOLS;
    case "design": return DESIGN_TOOLS;
    default: return undefined;
  }
}

// The ~15 most relevant specialists for a request (shared by planning AND verification).
function pickRoster(request: string): Specialist[] {
  const words = request.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = SPECIALISTS.map((s) => {
    let score = 0; const text = (s.id + " " + s.name + " " + s.brief).toLowerCase();
    for (const w of words) if (text.includes(w)) score++;
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 15).map((x) => x.s);
  for (const c of ["scout", "forge", "quill", "judge", "envoy"]) {
    if (!top.some((x) => x.id === c)) { const a = SPECIALISTS.find((x) => x.id === c); if (a) top.push(a); }
  }
  return top;
}

// Orchestrator: break the request into a dynamic dependency graph.
async function makePlan(request: string, tier: Tier): Promise<PlanItem[]> {
  // DEMO/TEST override: SAM_DEMO_CREW=scout,quill,maestro pins an exact crew (parallel, no model
  // planning) so the demo recording is deterministic. Unset in normal use → falls through to the
  // model planner below. Invalid ids are ignored; an all-invalid list falls through too.
  const pinned = (process.env.SAM_DEMO_CREW || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (pinned.length) {
    const valid = pinned.filter((id) => byId(id));
    if (valid.length) return valid.map((id, i) => ({ id: `t${i + 1}`, specialist: id, task: request, dependsOn: [] }));
  }
  const roster = pickRoster(request).map((s) => `- ${s.id} (${s.name}): ${s.brief}`).join("\n");
  const sys = `You are SAM's orchestrator. Break the request into the FEWEST subtasks that fully cover it, and assign each to the ONE best-fit specialist.

Rules:
- Minimal by default. A simple request = ONE specialist, one task. Only split when the work genuinely spans different lanes. 7 is a hard ceiling, never a target — don't pad the plan.
- Best fit only: match each subtask to the specialist whose lane it lands in; never hand a coding job to a writer or vice versa.
- Use "dependsOn" ONLY when a task truly needs a prior task's output (research → then write). Independent tasks run in parallel, so leave their dependsOn empty.
- Each "task" must be a sharp, concrete instruction naming what to PRODUCE — not a vague topic.
- Output ONLY the JSON array, nothing else.

Example: [{"id":"t1","specialist":"scout","task":"Find the top 3 competitors and their pricing","dependsOn":[]},{"id":"t2","specialist":"quill","task":"Write a one-page positioning brief from t1's findings","dependsOn":["t1"]}]

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

  // Break any dependency cycle up front (a bad plan could make t1↔t2 deadlock).
  const idSet = new Set(plan.map((p) => p.id));
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    const it = plan.find((p) => p.id === from);
    return !!it && (it.dependsOn || []).some((d) => reaches(d, target, seen));
  };
  const deps = new Map<string, string[]>();
  for (const item of plan) deps.set(item.id, (item.dependsOn || []).filter((d) => d !== item.id && idSet.has(d) && !reaches(d, item.id)));

  // Create a deferred promise for EVERY task FIRST, so a task can depend on one
  // that appears later in the plan (forward reference) without silently losing it.
  const taskPromises = new Map<string, Promise<string>>();
  const settle = new Map<string, (v: string) => void>();
  for (const item of plan) taskPromises.set(item.id, new Promise<string>((r) => settle.set(item.id, r)));

  const runners = plan.map((item) => (async () => {
    // 1. Wait for dependencies (resolvable regardless of plan order)
    const depOutputs: string[] = [];
    for (const dep of deps.get(item.id)!) depOutputs.push(`=== Output from ${dep} ===\n${await taskPromises.get(dep)}`);
    const depContext = depOutputs.length ? `\n\n## DEPENDENCY OUTPUTS:\n${depOutputs.join("\n\n")}` : "";

    // 2. Run agent
    const s = byId(item.specialist)!;
    emit({ type: "agent-start", id: item.id, name: s.name, emoji: s.emoji, task: item.task });
    const sys = `${baseSystem}\n\n## You are ${s.name} ${s.emoji} — SAM's specialist, channelling ${s.modeledOn}.\nYour lane: ${s.brief}\nDo YOUR part only, at world-class level. Hand back a tight, finished deliverable — concrete, useful, no filler, no "you could…". If it needs live facts, use your tools and verify; never guess or bluff. If a dependency's output is given, build on it directly. If the task lands outside your lane, say so in one line and do the closest genuinely useful thing.${depContext}`;

    let output = "";
    try {
      const r = await runAgent(sys, item.task, tier, toolPool(s));   // scoped tools = this specialist's mode
      output = r.kind === "final" ? (r.text || "") : `(needs approval to ${r.tool})`;
    } catch (e: any) { output = `(couldn't complete: ${e?.message || e})`; }

    emit({ type: "agent-done", id: item.id, name: s.name, emoji: s.emoji, output });
    results.push({ s, task: item.task, output });
    settle.get(item.id)!(output);
    return output;
  })());

  await Promise.allSettled(runners);

  // ── Roo-style VERIFY & RE-DELEGATE (one bounded round) ──────────────────────────────
  // The orchestrator reviews the crew's combined work against the request; if it finds real gaps,
  // errors or unverified claims, it delegates up to 2 follow-up subtasks to close them. This is the
  // self-correcting "boomerang" step — each result comes back for verification before the final.
  try {
    const soFar = results.map((r) => `## ${r.s.name} — ${r.task}\n${r.output}`).join("\n\n");
    const vRoster = pickRoster(request).map((s) => `- ${s.id} (${s.name}): ${s.brief}`).join("\n");
    const vSys = `You are SAM's orchestrator VERIFYING your crew's work. Given the request and the outputs, decide if the combined result FULLY and CORRECTLY answers it. If there are GENUINE gaps, errors, or unverified claims, output up to 2 follow-up subtasks that fix them (JSON: [{"id":"f1","specialist":"<id>","task":"...","dependsOn":[]}]). If the work is complete and solid, output []. Be strict — only real gaps, never pad.\n\nSpecialists:\n${vRoster}`;
    const vr = await runModel(tier, vSys, `Request: ${request}\n\nWork so far:\n${soFar}\n\nFollow-up subtasks (JSON array, or []):`);
    const followups = parsePlan(vr.text).slice(0, 2);
    if (followups.length) {
      emit({ type: "plan", plan: followups.map((p) => { const s = byId(p.specialist)!; return { id: p.id, specialist: p.specialist, name: s.name, emoji: s.emoji, task: p.task, dependsOn: [] }; }) });
      await Promise.allSettled(followups.map(async (f) => {
        const s = byId(f.specialist)!;
        emit({ type: "agent-start", id: f.id, name: s.name, emoji: s.emoji, task: f.task });
        const fsys = `${baseSystem}\n\n## You are ${s.name} ${s.emoji} — SAM's specialist, channelling ${s.modeledOn}.\nYour lane: ${s.brief}\nThis is a FOLLOW-UP to close a gap the orchestrator found — do exactly this, tightly, and hand back a finished deliverable.\n\n## Work already done:\n${soFar}`;
        let out = "";
        try { const rr = await runAgent(fsys, f.task, tier, toolPool(s)); out = rr.kind === "final" ? (rr.text || "") : `(needs approval to ${rr.tool})`; }
        catch (e: any) { out = `(couldn't complete: ${e?.message || e})`; }
        emit({ type: "agent-done", id: f.id, name: s.name, emoji: s.emoji, output: out });
        results.push({ s, task: f.task, output: out });
      }));
    }
  } catch { /* verification is best-effort — never block the final answer */ }

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
  emit({ type: "plan", plan: NINJAS.map((n) => ({ id: n.id, specialist: n.id, name: n.name, emoji: n.emoji, task: n.id === "hawk" ? "hunt the problems" : "deal with them" })) });

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
