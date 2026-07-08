// ─────────────────────────────────────────────────────────────
//  S.A.M. · AGENT LOOP  (THE DOER)
//  Turns a request into ACTION. SAM can call tools; safe ones
//  run automatically, risky ones pause for the user's OK.
//
//  Model-agnostic protocol (works on free Ollama/Gemini/Groq):
//  the model replies with a JSON object to use a tool —
//    {"tool":"web_search","input":{"query":"..."}}
//  — or plain text when it's ready to answer the user.
// ─────────────────────────────────────────────────────────────

import { runModel, streamModel, Tier } from "./models.ts";
import { compressToolOutput } from "./compress.ts";
import { TOOLS, toolByName, toolCatalogue } from "./tools.ts";
import { mayAutoRun } from "./authz.ts";

const MAX_STEPS = 4;   // fewer, leaner steps → stays inside free-tier token limits

// Keep the running transcript small (question + most recent results) so a
// multi-step loop never blows past a free model's per-minute token budget.
function trimPrompt(p: string): string {
  return p.length > 7000 ? p.slice(0, 700) + "\n…(earlier steps trimmed)…\n" + p.slice(-5500) : p;
}


// Built per request so we can expose ONLY the relevant tools (semantic routing).
function buildProtocol(toolNames?: string[]): string {
  return `
You are not just a chatbot — you can take real actions on the user's Mac using tools.

TOOLS AVAILABLE:
${toolCatalogue(toolNames)}

HOW TO USE A TOOL — reply with ONLY a single JSON object, nothing else:
{"tool":"<name>","input":{...}}
For example: {"tool":"web_search","input":{"query":"best CRM for small business 2026"}}

After each tool runs you'll get its result, then you decide the next step.
When you have what you need, reply to the user in plain words (NOT JSON) — a clear,
tight answer that says what you did and the outcome.

RULES:
- Use tools when the request needs real action or live/current info. Don't guess if you can look it up or check.
- Tools marked [asks first] will pause for the user's approval automatically — just call them normally when needed.
- Never claim you did something unless a tool actually did it. If a tool failed, say so.
- One tool per reply. Keep going until the job is done, then give the final answer.
- UI WIDGETS: You can render native UI widgets in your final answer by outputting a markdown block labeled "widget" containing pure JSON.
  Chart: \`\`\`widget\n{"type":"chart","title":"Sales","series":[{"label":"Jan","value":10}]}\n\`\`\`
  Kanban: \`\`\`widget\n{"type":"kanban","title":"Project","columns":[{"name":"Todo","tasks":["Task 1"]},{"name":"Done","tasks":[]}]}\n\`\`\`
- PROACTIVE ENGAGEMENT: To keep the momentum flowing, optionally append 2-3 short, highly relevant follow-up questions the user might want to ask next, using the followup widget at the very bottom of your answer.
  Followups: \`\`\`widget\n{"type":"followup","questions":["Tell me more?","What's the cost?"]}\n\`\`\`
`.trim();
}

export interface AgentResult {
  kind: "final" | "pending";
  text?: string;                 // final answer to the user
  trace: string[];               // plain-language "what SAM did"
  provider?: string;
  // pending (risky action awaiting approval):
  tool?: string;
  input?: any;
  preview?: string;
  activity?: string;
  transcript?: string;           // opaque state to resume via /api/confirm
}

// Pull the first {...} that looks like a tool call out of a model reply.
// Parse a JSON candidate, strict first then a lenient pass for the malformations small
// models actually emit (trailing commas, single-quoted keys/values). The lenient pass
// is a pure fallback — if it yields nonsense it just won't have a string `tool` and we
// move on — but when it works it saves a whole model round-trip vs the repair call below.
function tryToolJson(cand: string): { tool: string; input: any } | null {
  const accept = (obj: any) => (obj && typeof obj.tool === "string") ? { tool: obj.tool, input: obj.input ?? {} } : null;
  try { return accept(JSON.parse(cand)); } catch { /* try lenient */ }
  try {
    const fixed = cand
      .replace(/,\s*([}\]])/g, "$1")                    // trailing commas
      .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3') // single-quoted keys
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3') // unquoted keys
      .replace(/:\s*'([^']*)'/g, ': "$1"');             // single-quoted values (no inner ')
    return accept(JSON.parse(fixed));
  } catch { return null; }
}
export function parseToolCall(text: string): { tool: string; input: any } | null {
  const cleaned = text.replace(/```json/gi, "```").trim();
  // scan for balanced JSON objects
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < cleaned.length; j++) {
      if (cleaned[j] === "{") depth++;
      else if (cleaned[j] === "}") { depth--; if (depth === 0) {
        const hit = tryToolJson(cleaned.slice(i, j + 1));
        if (hit) return hit;
        break;
      }}
    }
  }
  return null;
}

const CONTINUE = `\nNow either call one tool (reply with ONLY the JSON) or give the user your final plain-text answer.`;

// Core loop. `prompt` is the running transcript (the user's request + tool results).
async function loop(system: string, prompt: string, tier: Tier, trace: string[], swarm = false): Promise<AgentResult> {
  for (let step = 0; step < MAX_STEPS; step++) {
    // Tool-PLANNING (deciding the next action) routes to the deep lane — Hermes fronts it, and it's
    // elite at exactly this agentic reasoning. Still falls through every free brain, so never dark.
    let res = await runModel(tier, system, prompt + CONTINUE, "deep");
    let call = parseToolCall(res.text);

    // Retry/repair: small models often intend a tool but emit invalid JSON.
    if (!call && /["']?tool["']?\s*:/.test(res.text)) {
      const fix = await runModel(tier, system, prompt +
        `\n\nYour last reply looked like a tool call but wasn't valid JSON:\n${res.text.slice(0, 300)}\n\n` +
        `Re-emit ONLY the JSON object {"tool":"<name>","input":{...}} and nothing else.`);
      const repaired = parseToolCall(fix.text);
      if (repaired) { call = repaired; res = fix; }
    }

    if (!call) return { kind: "final", text: res.text, trace, provider: res.provider };

    const tool = toolByName(call.tool);
    if (!tool) {
      // model named a tool that doesn't exist — nudge and continue
      prompt += `\n\n[SAM tried tool "${call.tool}" — no such tool. Available: ${TOOLS.map((t) => t.name).join(", ")}]`;
      continue;
    }

    if (!tool.safe && !mayAutoRun(tool.name, swarm)) {
      // ask-first: pause and hand the decision to the user (unless pre-authorized)
      return {
        kind: "pending", trace, provider: res.provider,
        tool: tool.name, input: call.input,
        preview: tool.preview?.(call.input) || tool.description,
        activity: tool.activity(call.input),
        transcript: prompt,
      };
    }

    // safe OR pre-authorized tool → run it automatically (never let a tool crash the loop)
    trace.push(tool.activity(call.input));
    let result: string;
    try { result = await tool.run(call.input); }
    catch (e: any) { result = `that didn't work (${e?.message || e})`; }
    prompt = trimPrompt(prompt + `\n\n[ran ${tool.name}] → ${compressToolOutput(tool.name, result)}`);
  }
  // ran out of steps — ask the model to wrap up with what it has
  const wrap = await runModel(tier, system, prompt + `\n\nWrap up now: give the user your best final answer in plain words.`);
  return { kind: "final", text: wrap.text, trace, provider: wrap.provider };
}

// The fast path (skip tools) is ONLY for clearly self-contained requests:
// drafting, rewriting, explaining, opinions, maths. Everything else — anything
// about the live/current/factual world — must be able to research.
const PURE_GENERATION = /^\s*(write|draft|rewrite|reword|make|create|compose|generate|come up with|brainstorm|list|give me ideas|suggest|improve|fix the wording|translate|summari[sz]e this|explain|what does .* mean|define|how do i|help me write|turn this into|shorten|expand|polish|proofread|caption|hook|tagline|name (a|some|my)|hi\b|hey\b|hello|thanks|thank you|cheers|yo\b)/i;

// Signals that a message needs live/external info → must use tools (research).
const NEEDS_TOOLS = /\b(search|google|look up|lookup|weather|forecast|temperature|time|clock|date|today|tonight|tomorrow|yesterday|this (week|weekend|month)|now|currently|latest|recent|news|headline|update|when('?s| is| are| does| do)?|what time|who('?s| is| are| won| plays?)|where('?s| is| are)|score|result|fixture|match|game|kick[- ]?off|on tv|channel|schedule|versus|vs\b|price|cost|how much|stock|rate|open|launch|run|execute|play|call|ring|facetime|email|mail|text|imessage|remind|reminder|calendar|diary|file|files|folder|desktop|screenshot|clipboard|website|url|link|browse|download|volume|music|song|playlist|artist|album|contact|number|read my|check my|find me|near me|nearest|around here|book|order|deploy|release[ds]?|out yet|github|repo|repos|repository|repositories|commit|pull request|\bpr\b|branch|issue|codebase|clone|ingest|index|documents?|docs|library|drive)\b|https?:\/\//i;

// True when a message is clearly self-contained generation (no tools/research).
// Used to skip embedding, recall and routing work entirely — faster + cheaper.
export function isFastPath(message: string): boolean {
  return PURE_GENERATION.test(message) && !NEEDS_TOOLS.test(message);
}

// Fresh request. `toolNames` = the relevant tools to expose (semantic routing).
// `forceFast` (Turbo) forces the single-call path even for tool-shaped messages.
export function runAgent(system: string, message: string, tier: Tier, toolNames?: string[], forceFast = false, swarm = false): Promise<AgentResult> {
  // Fast path ONLY when it's clearly generation AND has no live-info signal — or Turbo.
  if (forceFast || isFastPath(message)) {
    return runModel(tier, system, `User: ${message}\n\nAnswer directly.`)
      .then((r) => ({ kind: "final" as const, text: r.text, trace: [], provider: r.provider }));
  }
  const prompt = `User: ${message}`;
  return loop(`${system}\n\n${buildProtocol(toolNames)}`, prompt, tier, [], swarm);   // swarm=true → dangerous never auto-runs (even in Elon)
}

// ── STREAMING variant — emits typed events for live token/tool UX ──
export type StreamEvent =
  | { type: "token"; t: string }
  | { type: "tool"; activity: string }
  | { type: "pending"; tool: string; input: any; preview: string; activity: string; transcript: string; trace: string[]; provider?: string }
  | { type: "done"; text: string; provider?: string; trace: string[] };

export async function runAgentStream(system: string, message: string, tier: Tier, toolNames: string[] | undefined, emit: (e: StreamEvent) => void, forceFast = false): Promise<void> {
  const trace: string[] = [];

  // Fast path — only clearly self-contained generation (no live-info signal) — or Turbo.
  if (forceFast || isFastPath(message)) {
    let full = "";
    const r = await streamModel(tier, system, `User: ${message}\n\nAnswer directly.`, (c) => { full += c; emit({ type: "token", t: c }); });
    emit({ type: "done", text: r.text || full, provider: r.provider, trace: [] });
    return;
  }

  const sys = `${system}\n\n${buildProtocol(toolNames)}`;
  let prompt = `User: ${message}`;

  for (let step = 0; step < MAX_STEPS; step++) {
    let full = "", mode: null | "answer" | "tool" = null, emitted = 0;
    // Never stream past the start of a JSON tool-call object. Small free models often write a line of
    // preamble and THEN a {"tool":…} call; without this guard the raw JSON leaked into the visible
    // answer. We hold everything from the first `{"` and only release it later if it wasn't a real call.
    const braceCut = (s: string) => { const m = s.search(/\{\s*"/); return m >= 0 ? m : s.length; };
    const res = await streamModel(tier, sys, prompt + CONTINUE, (chunk) => {   // deep lane below (Hermes-led planning)
      full += chunk;
      if (mode === null) {
        const s = full.replace(/^[\s`]+/, "");
        if (s.length > 0) mode = s[0] === "{" ? "tool" : "answer";
      }
      if (mode === "answer") {
        const cut = braceCut(full);
        if (cut > emitted) { emit({ type: "token", t: full.slice(emitted, cut) }); emitted = cut; }
      }
    }, "deep");
    const finalText = res.text || full;
    const call = parseToolCall(finalText);

    if (call) {
      const tool = toolByName(call.tool);
      if (!tool) { prompt += `\n\n[SAM tried tool "${call.tool}" — no such tool.]`; continue; }
      if (!tool.safe && !mayAutoRun(tool.name)) {
        emit({ type: "pending", tool: tool.name, input: call.input, preview: tool.preview?.(call.input) || tool.description, activity: tool.activity(call.input), transcript: prompt, trace, provider: res.provider });
        return;
      }
      trace.push(tool.activity(call.input));
      emit({ type: "tool", activity: tool.activity(call.input) });
      let result: string;
      try { result = await tool.run(call.input); } catch (e: any) { result = `that didn't work (${e?.message || e})`; }
      prompt = trimPrompt(prompt + `\n\n[ran ${tool.name}] → ${compressToolOutput(tool.name, result)}`);
      continue;
    }

    // Final answer. Release anything held back — either a full tool-mode buffer that turned out to be
    // prose, or an answer-mode `{"…` tail that wasn't actually a valid tool call.
    if (mode !== "answer") emit({ type: "token", t: finalText });
    else if (full.length > emitted) emit({ type: "token", t: full.slice(emitted) });
    emit({ type: "done", text: finalText, provider: res.provider, trace });
    return;
  }
  const wrap = await streamModel(tier, sys, prompt + `\n\nWrap up now: give the user your best final answer in plain words.`, (c) => emit({ type: "token", t: c }));
  emit({ type: "done", text: wrap.text, provider: wrap.provider, trace });
}

// Resume after the user approves (or rejects) a risky action.
export async function resumeAgent(
  system: string, transcript: string, tier: Tier,
  approved: boolean, toolName: string, input: any, trace: string[] = [], swarm = false
): Promise<AgentResult> {
  const sys = `${system}\n\n${buildProtocol()}`;   // resume exposes all tools (already mid-task)
  const tool = toolByName(toolName);
  let prompt = transcript;
  if (approved && tool) {
    trace.push(tool.activity(input));
    let result: string;
    try { result = await tool.run(input); }
    catch (e: any) { result = `that didn't work (${e?.message || e})`; }
    prompt = trimPrompt(prompt + `\n\n[ran ${tool.name}] → ${compressToolOutput(tool.name, result)}`);
  } else {
    prompt += `\n\n[The user declined to run ${toolName}. Do not do it. Continue without it or explain what you'd need.]`;
  }
  return loop(sys, prompt, tier, trace, swarm);
}
