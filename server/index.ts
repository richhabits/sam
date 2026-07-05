// ─────────────────────────────────────────────────────────────
//  S.A.M. · SMART ARTIFICIAL MIND
//  The brain. Ties together: skill router → model providers →
//  vault memory → project context. One endpoint runs the loop.
// ─────────────────────────────────────────────────────────────

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { setPool, poolSize, keyStatus } from "./keys.ts";
import { runModel, Tier, providersStatus, runVision } from "./models.ts";
import { runAgent, resumeAgent, runAgentStream, isFastPath } from "./agent.ts";
import { TOOLS } from "./tools.ts";
import { remember, recallWith, memoryStats, pinnedModel } from "./memory.ts";
import { searchDocsWith, docsStats } from "./ingest.ts";
import { embedOne } from "./embeddings.ts";
import { buildIndexes, selectTools, selectSkillId, routingReady } from "./routing.ts";
import { isAllowed, allow, disallow, listAllowed, setAutopilot, autopilotOn, setElonMode, isElonMode } from "./authz.ts";
import { nowText, locationText, initContext } from "./context.ts";
import { grabWorld, worldContext } from "./world.ts";
import { logSecurity, securityStatus, securityEvents } from "./security.ts";
import { startProactive, takePending, listNudges } from "./proactive.ts";
import { runTeam, runNinjas, SPECIALISTS, NINJAS } from "./agents.ts";
import { loadSwarms, startSwarm, approveAgent, resumeOrphanedSwarms } from "./swarm.ts";
import { startDropWatcher, takeDrop, dropFolderPath } from "./ios.ts";
import { startScheduler, listSchedules, addSchedule, removeSchedule, toggleSchedule } from "./scheduler.ts";
import { addPerson, listPeople, peopleContext } from "./people.ts";
import { loadSkills, routeSkill } from "./skills.ts";
import { PROJECTS, projectById, projectsContext } from "./projects.ts";
import { operatingDoctrine } from "./persona.ts";
import { extractFactsFromTranscript, saveImportedFacts } from "./importer.ts";
import {
  logExchange,
  recentLog,
  recentExchanges,
  buildGraph,
  vaultStats,
  readProjectNote,
  pruneOldLogs,
} from "./vault.ts";

const app = express();
// SECURITY: only allow same-origin + localhost (dev HUD on :5273). This stops a
// random website you visit from reaching SAM's powerful local API (CSRF-style abuse).
// Any blocked origin gets logged so SAM can call it out.
app.use(cors({
  origin: (o, cb) => {
    const ok = !o || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
    if (!ok) logSecurity("alert", "blocked-origin", `Blocked an API request from an unexpected website`, o);
    cb(null, ok);
  },
}));
app.use(express.json({ limit: "30mb" })); // room for photo/file attachments

const PORT = process.env.PORT || 8787;
const SKILLS = loadSkills();

// ── Brand ──────────────────────────────────────────────
const C = { o: "\x1b[38;5;208m", d: "\x1b[2m", b: "\x1b[1m", r: "\x1b[0m" };
console.log(`
${C.o}${C.b}   ███████╗  █████╗  ███╗   ███╗
   ██╔════╝ ██╔══██╗ ████╗ ████║
   ███████╗ ███████║ ██╔████╔██║
   ╚════██║ ██╔══██║ ██║╚██╔╝██║
   ███████║ ██║  ██║ ██║ ╚═╝ ██║
   ╚══════╝ ╚═╝  ╚═╝ ╚═╝     ╚═╝${C.r}
${C.d}   Smart Artificial Mind${C.r}  ${C.o}·${C.r}  ${C.d}it doesn't just answer, it handles it${C.r}
${C.d}   ${C.r}${C.o}◆${C.r}${C.d} by HECTIC · free · local · yours${C.r}
`);
console.log(`  ${C.b}booting…${C.r}`);
console.log(`  skills linked   · ${SKILLS.map((s) => s.id).join(", ")}`);
console.log(`  tools linked    · ${TOOLS.length} (${TOOLS.filter((t) => t.safe).length} auto, ${TOOLS.filter((t) => !t.safe).length} ask-first)`);
console.log(`  brands tracked  · ${PROJECTS.length}`);
console.log(`  vault mounted   · ${vaultStats().path}\n`);

// Build semantic tool/skill indexes + warm date-time/location context (non-blocking).
void buildIndexes(SKILLS).then(() => routingReady() && console.log("  routing ready   · semantic tool + skill selection\n"));
initContext();
// Self-containment: prune ancient daily logs so the vault stays lean forever (free).
{ const { removed } = pruneOldLogs(); if (removed) console.log(`  vault tidied    · pruned ${removed} old log${removed > 1 ? "s" : ""}\n`); }
// On startup, grab the user's whole operation (apps/repos + brands + socials) so SAM
// walks in already knowing his world. Non-blocking; details load on demand via tools.
void grabWorld().then((s) => console.log(`  ${s}\n`));
resumeOrphanedSwarms();

// Non-blocking background selfupdate — replaces the old blocking prestart hook.
// SAM launches instantly; update check happens silently 5s later.
setTimeout(async () => {
  try {
    const local = await git("rev-parse HEAD");
    await git("fetch --quiet origin", 10000);
    let remote: string;
    try { remote = await git("rev-parse @{u}"); } catch { return; }
    if (local !== remote) console.log(`\n  ✨ Update available — run 'git pull' to get the latest SAM.\n`);
  } catch { /* offline or not a clone — no drama */ }
}, 5000);

// iOS Companion — watch for iCloud Drop folder notes from the user's iPhone.
startDropWatcher(async (d) => {
  console.log(`  📱 drop received · ${d.file} (${d.kind})`);
  // Process the drop as a standard command (SAM answers it autonomously).
  try {
    const system = buildSystem("", undefined, { name: process.env.SAM_USER_NAME || "there", mode: "business" }, "");
    const r = await runAgent(system, d.content, (process.env.DEFAULT_TIER as Tier) || "free");
    if (r.kind === "final" && r.text) {
      // Queue the result for the app to show + send a notification.
      const { desktopNotify } = await import("./proactive.ts") as any;
      desktopNotify("SAM — iOS Drop Processed", r.text);
    }
  } catch {}
});

// Scheduler — Recurring background tasks
startScheduler(async (command: string) => {
  const system = buildSystem("", undefined, { name: process.env.SAM_USER_NAME || "there", mode: "business" }, "");
  const r = await runAgent(system, command, (process.env.DEFAULT_TIER as Tier) || "free");
  if (r.kind === "final" && r.text) {
    const { desktopNotify } = await import("./proactive.ts") as any;
    desktopNotify("SAM — Scheduled Task", r.text);
    return r.text;
  }
  return "Finished.";
});

// Proactive layer: SAM reaches out first — a once-a-day morning brief (composed
// with its own tools: weather + nudges) and nudge reminders. Slim: a 5-min timer.
startProactive(async () => {
  const nudges = listNudges();
  const system = buildSystem("", undefined, { name: process.env.SAM_USER_NAME || "there", mode: "business" }, "");

  // ── Jarvis Layer: gather real data from the ecosystem before composing ──
  let calendarData = "", emailData = "", weatherData = "";
  const { toolByName } = await import("./tools.ts");
  try { const cal = toolByName("read_calendar"); if (cal) calendarData = await cal.run({}); } catch {}
  try { const mail = toolByName("read_emails"); if (mail) emailData = await mail.run({}); } catch {}
  try { const wx = toolByName("get_weather"); if (wx) weatherData = await wx.run({ place: locationText() || "" }); } catch {}

  const prompt = `Give me my morning brief — short, warm, punchy (5-8 lines). It's ${nowText()}.` +
    `${locationText() ? ` I'm near ${locationText()}.` : ""}` +
    `\n\n## Today's Calendar\n${calendarData || "Nothing on the calendar today."}` +
    `\n\n## Latest Emails\n${emailData || "Inbox is quiet."}` +
    `\n\n## Weather\n${weatherData || "Couldn't get the weather."}` +
    `${nudges.length ? `\n\n## Pending Nudges\n${nudges.map((n) => `- ${n.text}${n.due ? ` (due ${n.due})` : ""}`).join("\n")}` : "\n\nNo pending nudges."}` +
    `\n\nSynthesise all of this into a single, warm, punchy morning brief. Lead with the most important thing. Don't just list — weave it into a narrative.`;
  try {
    const qvec = await embedOne(prompt, true);
    const r = await runAgent(system, prompt, (process.env.DEFAULT_TIER as Tier) || "free", selectTools(qvec, 6));
    return r.kind === "final" ? (r.text || "") : "";
  } catch { return ""; }
});

// Pull the last few exchanges from the vault so SAM actually remembers
// what was just discussed (real continuity across messages/sessions).
function recallMemory(): string {
  const recent = recentExchanges(5);
  if (!recent.length) return "";
  const clip = (s: string, n = 220) => (s.length > n ? s.slice(0, n) + "…" : s);
  const lines = recent.map((e) => `- the user: ${clip(e.user)}\n  You: ${clip(e.sam)}`).join("\n");
  return `\n## Recent conversation (remember this for continuity)\n${lines}`;
}

interface User { name?: string; about?: string; mode?: "business" | "personal"; language?: string }

// The core SAM persona — addresses whoever is actually using SAM.
// Pull the best-matching passages from the ingested document library (roadmap #93:
// SAM knows your docs). Reuses the query vector already computed for memory recall.
function recallDocs(qvec: { model: string; vec: number[] } | null): string {
  if (!qvec || !docsStats().chunks) return "";
  const clip = (s: string, n = 420) => (s.length > n ? s.slice(0, n) + "…" : s);
  return searchDocsWith(qvec, 4)
    .map((h) => `- [${h.source.split("/").pop()}] ${clip(h.text)}`)
    .join("\n");
}

function buildSystem(skillBody: string, projectId?: string, user?: User, recalled?: string, interactive = false, docs?: string): string {
  const project = projectId ? projectById(projectId) : undefined;
  const note = projectId ? readProjectNote(projectId) : "";
  const name = (user?.name || "there").trim();
  const mode = user?.mode === "personal" ? "personal" : "business";
  return [
    `You are SAM — ${name}'s personal AI assistant. Swagger + substance: confident, warm, sharp, human, a bit of flair — never robotic or corporate. Call them ${name} now and then.`,
    `Think like the OGs, always: Apple (make it simple, make it just-work), Elon (first principles, 10x, move fast), Amazon (obsess the outcome, build to scale from day one), Branson (bold but calm), Alan Sugar (blunt, numbers, no fluff) — with big-player, Microsoft-grade ethics and trust. You win on FACTS and TIMING, not noise.`,
    `And back ${name} to play in THAT league — treat them as a serious builder and operator in the making, hold them to that bar, and help them move like one. When they're winning, hype it; when they're off, straighten it with the facts.`,
    `For music, nightlife or going out, bring energy — and actually pull tracks up with the play tool.`,
    ``,
    `## Non-negotiable`,
    `- FACTS FIRST — never guess or bluff. If unsure, RESEARCH first (search web, read page, check file), then answer or act. Still don't know? Say so.`,
    `- SAVVY & MORAL: think a step ahead, protect ${name}'s interests, know right from wrong, refuse anything harmful/illegal/deceitful (say why), flag dodgy moves first.`,
    `- SMART & CHEAP: always the simplest free way that works; call out overspending. Explain the pro way in plain English (${name}'s no coder/lawyer but sharp).`,
    `- BORG MODE: always learn, adapt and evolve. Assimilate the best of what's out there and make it ours, better. FREE at all costs FIRST — exhaust every free/local option before you even consider paid; escalate to paid (X→Y→Z) only as a genuine last resort, and say why. Comprehensive, always-on.`,
    `- BUILDER'S INSTINCT (this is core): think like an ecosystem-builder. When there's a tool, app, service or workflow in play, ask "can WE build a leaner, better, cheaper IN-HOUSE version that does this 10x better instead of paying for someone else's bloat?" Default to owning it — made-to-order beats off-the-shelf. You CAN build: you have file + terminal + code tools, so when it's smart, actually scaffold the in-house thing (a mini tool, script, or app) rather than just recommending you buy one. Improve whatever's out there.`,
    `- CURRENT: factor then-vs-now, flag outdated methods, give the modern way (check the web if unsure).`,
    `- If ${name}'s ranting/gassed, be the calm head: "I hear you — here are the facts, here's the smart move," grounded in his memory + reality.`,
    ``,
    operatingDoctrine(name),
    ``,
    user?.language && !/^en|english/i.test(user.language) ? `## Language\nAlways reply to ${name} in ${user.language}, naturally and fluently — no matter what language they write in.` : ``,
    ``,
    `## Right now`,
    `- Today & current time: ${nowText()}`,
    locationText() ? `- ${name}'s location (approx): ${locationText()}` : ``,
    `Use these for anything time- or place-sensitive ("today", "tonight", "this weekend", "near me", "the weather"). For anything current, live, scheduled, or factual (news, sport fixtures, prices, who/what/when) — SEARCH THE WEB, don't answer from old training data.`,
    ``,
    user?.about ? `## About ${name}\n${user.about}` : ``,
    ``,
    mode === "personal"
      ? `## Mode: PERSONAL 🏠\n${name}'s in PERSONAL mode — life outside work: family, friends, health, home, personal admin, downtime, sorting his own stuff. Be his mate — warm, relaxed, real. Don't lead with business or brands unless ${name} brings them up.`
      : `## Mode: BUSINESS 💼\n${name}'s in BUSINESS mode — brands, work, money, growth, ops. Sharp operator energy: think about what actually moves the needle for his businesses.`,
    ``,
    mode === "business" && projectsContext() ? `## ${name}'s brands (context)\n${projectsContext()}\n${worldContext()}` : ``,
    ``,
    project
      ? `## Active brand for this request: ${project.name}\n${project.summary}`
      : `## No specific brand flagged — answer at the top level.`,
    note ? `\n## Vault note for this brand\n${note}` : ``,
    recalled ? `\n## What you KNOW about ${name} (from memory — trust these facts; they're true and specific, prefer them over general assumptions)\n${recalled}` : ``,
    docs ? `\n## From ${name}'s documents (indexed library — real excerpts; cite the file in [brackets] when you use one; use search_docs to dig deeper)\n${docs}` : ``,
    interactive ? recallMemory() : ``,   // recent-exchange context only helps live turns, not Team/swarm/background jobs
    skillBody ? `\n## Loaded skill playbook\n${skillBody}` : ``,
  ].filter(Boolean).join("\n");
}

function pickTier(message: string, tier?: Tier) {
  const skill = routeSkill(message, SKILLS);
  const chosen: Tier = tier || skill?.tier || (process.env.DEFAULT_TIER as Tier) || "local";
  return { skill, chosen };
}

// Only bother extracting facts when the message plausibly contains something
// durable — saves model calls (speed + quota) on questions/small talk.
function worthRemembering(msg: string): boolean {
  if (msg.length < 15) return false;
  return /\b(my|i'?m|i am|i like|i prefer|i want|i need|remember|always|never|favou?rite|call me|we|our|use|don'?t|supplier|client|deadline|birthday|anniversary|password|address|number is|email is|based in|live|work)\b/i.test(msg);
}

// Turn an exchange into 0-3 durable atomic facts and store them (fire-and-forget).
// Runs on LOCAL so it never eats the cloud quota that answers need. Stores FACTS
// not raw logs (avoids context poisoning).
async function learnFrom(userMsg: string, samMsg: string, name: string) {
  if (!worthRemembering(userMsg)) return;
  try {
    const sys = "You pull DURABLE, long-term facts about a person out of a conversation and return clean, atomic statements. Output ONLY a JSON array of strings, or [] when nothing is worth keeping. Be strict — most exchanges yield [].";
    const prompt =
      `From the exchange below, extract 0-3 facts worth remembering about ${name} long-term — things still true and useful next week: preferences, people in their life, projects/brands, decisions, recurring details, contacts, constraints.\n` +
      `STRICT — return [] unless something genuinely qualifies. Skip: small talk, questions, one-off tasks, transient state ("tired today"), anything ${name} didn't actually reveal, and anything obvious or already generic.\n` +
      `Each fact must stand alone — name the subject ("${name} prefers X", never just "prefers X") — and be one clean statement.\n\n` +
      `${name}: ${userMsg}\nSAM: ${samMsg}\n\nFacts (JSON array of strings, or []):`;
    const r = await runModel("local", sys, prompt);   // local first — don't spend cloud quota on background work
    const m = r.text.match(/\[[\s\S]*\]/);
    if (!m) return;
    const facts = JSON.parse(m[0]);
    if (Array.isArray(facts)) for (const f of facts) if (typeof f === "string" && f.length > 6) await remember(f, "fact");
  } catch { /* memory is best-effort */ }
}

// ── MAIN COMMAND LOOP ────────────────────────────────────────
//  Runs the AGENT: SAM can use tools. Safe tools run automatically;
//  a risky tool returns kind:"pending" for the user to approve.
app.post("/api/command", async (req, res) => {
  const { message, projectId, tier, user, attachments } = req.body as
    { message: string; projectId?: string; tier?: Tier; user?: User; attachments?: any[] };
  const atts = Array.isArray(attachments) ? attachments : [];
  const images = atts.filter((a) => a?.kind === "image" && a.data);
  const texts = atts.filter((a) => a?.kind === "text" && a.text);
  if (!message?.trim() && !atts.length) return res.status(400).json({ error: "empty message" });

  try {
  // SPEED: quick chat/drafting skips embedding, recall and routing entirely.
  const fast = !!message && isFastPath(message);
  const qvec = (!fast && message) ? await embedOne(message, true, pinnedModel()) : null;

  let { skill, chosen } = pickTier(message || "look at this", tier);
  const semanticSkillId = selectSkillId(qvec);   // no-op when qvec is null
  if (semanticSkillId) { const s = SKILLS.find((x) => x.id === semanticSkillId); if (s) { skill = s; chosen = tier || s.tier || chosen; } }

  const recalled = (!fast && memoryStats().count ? recallWith(qvec, 5) : []).map((h) => `- ${h.text}`).join("\n");
  const docs = fast ? "" : recallDocs(qvec);
  const toolNames = fast ? undefined : selectTools(qvec, 8, message);
  const system = buildSystem(skill?.body || "", projectId, user, recalled, true, docs);
  const userName = (user?.name || "the user").trim();

  // Photos → free Gemini vision (no tool loop needed to look at an image).
  if (images.length) {
    let prompt = message || "Look at this and tell me what's useful.";
    const pc = peopleContext();
    if (pc) prompt = `${pc}\n\n${prompt}`;   // so SAM recognises your people (and flags strangers)
    if (texts.length) prompt += "\n\n" + texts.map((t) => `[File: ${t.name}]\n${t.text}`).join("\n\n");
    const v = await runVision(system, prompt, images.map((im) => ({ mime: im.mime || "image/jpeg", data: String(im.data).replace(/^data:[^,]+,/, "") })));
    logExchange({ user: (message || "[photo]"), sam: v.text, skill: skill?.id, project: projectId, provider: v.provider });
    return res.json({ kind: "final", text: v.text, trace: [`Looked at your ${images.length > 1 ? images.length + " images" : "photo"}`], provider: v.provider, projectId: projectId || "", tier: v.tier, message });
  }

  // Text files → fold their contents into the request, then run the agent.
  let fullMessage = message || "";
  if (texts.length) fullMessage += "\n\n" + texts.map((t) => `[Attached file: ${t.name}]\n${t.text}`).join("\n\n");

  const r = await runAgent(system, fullMessage, chosen, toolNames);

  if (r.kind === "final") {
    logExchange({ user: message, sam: r.text || "", skill: skill?.id, project: projectId, provider: r.provider || "" });
    void learnFrom(message || "", r.text || "", userName);   // fire-and-forget: build long-term memory
  }
  res.json({ ...r, skill: skill?.id || null, projectId: projectId || "", tier: chosen, message });
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ kind: "final", text: "Something went wrong on my end — give that another go.", error: String(e?.message || e) });
  }
});

// ── STREAMING command (SSE) — tokens + tool events as they happen ──
app.post("/api/stream", async (req, res) => {
  const { message, projectId, tier, user } = req.body as { message: string; projectId?: string; tier?: Tier; user?: User };
  if (!message?.trim()) return res.status(400).json({ error: "empty message" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (e: any) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  const fast = isFastPath(message);
  const qvec = fast ? null : await embedOne(message, true, pinnedModel());
  let { skill, chosen } = pickTier(message, tier);
  const semanticSkillId = selectSkillId(qvec);
  if (semanticSkillId) { const s = SKILLS.find((x) => x.id === semanticSkillId); if (s) { skill = s; chosen = tier || s.tier || chosen; } }
  const recalled = (!fast && memoryStats().count ? recallWith(qvec, 5) : []).map((h) => `- ${h.text}`).join("\n");
  const docs = fast ? "" : recallDocs(qvec);
  const toolNames = fast ? undefined : selectTools(qvec, 8, message);
  const system = buildSystem(skill?.body || "", projectId, user, recalled, true, docs);
  const userName = (user?.name || "the user").trim();

  try {
    await runAgentStream(system, message, chosen, toolNames, (e) => {
      send(e);
      if (e.type === "done") {
        logExchange({ user: message, sam: e.text || "", skill: skill?.id, project: projectId, provider: e.provider || "" });
        void learnFrom(message, e.text || "", userName);
      }
    });
  } catch (e: any) {
    send({ type: "done", text: "Something went wrong mid-answer.", trace: [] });
  }
  send({ type: "end", projectId: projectId || "" });
  res.end();
});

// ── APPROVE / DECLINE a risky action, then continue ──────────
app.post("/api/confirm", async (req, res) => {
  const { message, projectId, tier, transcript, tool, input, approved, trace, user, always } = req.body as any;
  if (approved && always && tool) allow(tool);   // "yes, and always allow this"
  try {
    const { skill } = pickTier(message || "", tier);
    const system = buildSystem(skill?.body || "", projectId, user, undefined, true);
    const r = await resumeAgent(system, transcript || "", tier || "local", !!approved, tool, input, trace || []);
    if (r.kind === "final") {
      logExchange({ user: message || `[approved ${tool}]`, sam: r.text || "", skill: skill?.id, project: projectId, provider: r.provider || "" });
    }
    res.json({ ...r, skill: skill?.id || null, projectId: projectId || "", tier: tier || "local", message });
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ kind: "final", text: "Something went wrong finishing that — try again.", error: String(e?.message || e) });
  }
});

// What can SAM actually do? (for the UI / transparency)
app.get("/api/tools", (_req, res) => res.json(TOOLS.map((t) => ({ name: t.name, safe: t.safe, description: t.description, allowed: isAllowed(t.name) }))));

// ── STANDING AUTHORIZATIONS ("yes, always allow X") ──────────
app.get("/api/allow", (_req, res) => res.json({ allowed: listAllowed() }));
app.post("/api/allow", (req, res) => {
  const { tool, on } = req.body as { tool: string; on: boolean };
  if (!tool) return res.status(400).json({ error: "no tool" });
  on ? allow(tool) : disallow(tool);
  res.json({ ok: true, allowed: listAllowed() });
});

// ── ADMIN · manage API keys & config from inside the app ─────
// Providers → their .env variable. Rolling pools accept many keys (comma list).
const PROVIDER_ENV: Record<string, string> = {
  // Core
  nvidia: "NVIDIA_API_KEYS", cerebras: "CEREBRAS_API_KEYS", mistral: "MISTRAL_API_KEYS",
  github: "GITHUB_API_KEYS", gemini: "GEMINI_API_KEYS", groq: "GROQ_API_KEYS",
  openrouter: "OPENROUTER_API_KEYS", anthropic: "ANTHROPIC_API_KEYS", openai: "OPENAI_API_KEYS",
  // Invincible expansion
  together: "TOGETHER_API_KEYS", sambanova: "SAMBANOVA_API_KEYS", deepseek: "DEEPSEEK_API_KEYS",
  fireworks: "FIREWORKS_API_KEYS", xai: "XAI_API_KEYS", huggingface: "HUGGINGFACE_API_KEYS",
  hyperbolic: "HYPERBOLIC_API_KEYS", novita: "NOVITA_API_KEYS", siliconflow: "SILICONFLOW_API_KEYS",
  glhf: "GLHF_API_KEYS", ai21: "AI21_API_KEYS", upstage: "UPSTAGE_API_KEYS",
  nebius: "NEBIUS_API_KEYS", cohere: "COHERE_API_KEYS", perplexity: "PERPLEXITY_API_KEYS",
  // Infinite Compute — Asian Heavyweights
  alibaba: "ALIBABA_API_KEYS", volcengine: "VOLCENGINE_API_KEYS", zhipu: "ZHIPU_API_KEYS",
  moonshot: "MOONSHOT_API_KEYS", minimax: "MINIMAX_API_KEYS", stepfun: "STEPFUN_API_KEYS",
  baidu: "BAIDU_API_KEYS", tencent: "TENCENT_API_KEYS",
};
const CONFIG_ENV: Record<string, string> = {
  elevenlabs: "ELEVENLABS_API_KEY", elevenVoice: "ELEVENLABS_VOICE_ID",
  defaultTier: "DEFAULT_TIER", musicService: "MUSIC_SERVICE",
  groqModel: "GROQ_MODEL", claudeModel: "CLAUDE_MODEL",
  notion: "NOTION_API_KEY", slack: "SLACK_BOT_TOKEN",
  discord: "DISCORD_WEBHOOK_URL", twitter: "TWITTER_BEARER_TOKEN",
  linear: "LINEAR_API_KEY", linearTeam: "LINEAR_TEAM_ID",
};
const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url)); // decodes spaces (My Drive)

function writeEnv(key: string, value: string) {
  let txt = "";
  try { txt = readFileSync(ENV_PATH, "utf8"); } catch {}
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  txt = re.test(txt) ? txt.replace(re, line) : (txt.replace(/\n?$/, "\n") + line + "\n");
  writeFileSync(ENV_PATH, txt);
  process.env[key] = value; // apply live
}

// Status only — never returns key VALUES, just how many are set.
app.get("/api/admin/config", (_req, res) => {
  const pools = keyStatus();
  res.json({
    providers: Object.keys(PROVIDER_ENV).map((p) => ({ id: p, keys: poolSize(p) })),
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    elevenVoice: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
    defaultTier: process.env.DEFAULT_TIER || "free",
    musicService: process.env.MUSIC_SERVICE || "apple",
    notion: !!process.env.NOTION_API_KEY,
    slack: !!process.env.SLACK_BOT_TOKEN,
    discord: !!process.env.DISCORD_WEBHOOK_URL,
    twitter: !!process.env.TWITTER_BEARER_TOKEN,
    linear: !!process.env.LINEAR_API_KEY,
    linearTeam: process.env.LINEAR_TEAM_ID || "",
    elonMode: isElonMode(),
    pools,
  });
});

// Save keys for a provider (rolling pool — send an array or comma/newline text).
app.post("/api/admin/keys", (req, res) => {
  const { provider, keys } = req.body as { provider: string; keys: string | string[] };
  const envVar = PROVIDER_ENV[provider];
  if (!envVar) return res.status(400).json({ error: "unknown provider" });
  const list = (Array.isArray(keys) ? keys : String(keys || "").split(/[\n,]/)).map((k) => k.trim()).filter(Boolean);
  writeEnv(envVar, list.join(","));
  const count = setPool(provider, list);
  res.json({ ok: true, provider, keys: count });
});

// Save a config value (elevenlabs key, voice, default tier, music service…).
app.post("/api/admin/config", (req, res) => {
  const { key, value } = req.body as { key: string; value: string };
  const envVar = CONFIG_ENV[key];
  if (!envVar) return res.status(400).json({ error: "unknown config key" });
  writeEnv(envVar, String(value || ""));
  res.json({ ok: true, key });
});

// Ingest user context (pasted from ChatGPT/Claude/Gemini) during onboarding or settings updates.
app.post("/api/admin/import-context", async (req, res) => {
  const { name, externalContext, tier } = req.body as { name: string; externalContext?: string; tier?: Tier };
  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
  try {
    const contextText = externalContext || "";
    if (contextText.trim().length > 0) {
      const chosenTier = tier || (process.env.DEFAULT_TIER as Tier) || "free";
      const facts = await extractFactsFromTranscript(name, contextText, chosenTier);
      const savedCount = await saveImportedFacts(facts);
      res.json({ ok: true, factsExtracted: facts.length, factsSaved: savedCount });
    } else {
      res.json({ ok: true, factsExtracted: 0, factsSaved: 0 });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to process import" });
  }
});

// Toggle Elon Mode (ruthless automation override).
app.post("/api/admin/elon-mode", (req, res) => {
  const { on } = req.body as { on: boolean };
  setElonMode(on);
  res.json({ ok: true, elonMode: isElonMode() });
});

// ── ElevenLabs premium voice (optional; free browser voice used otherwise) ──
app.post("/api/speak", async (req, res) => {
  const EL_KEY = process.env.ELEVENLABS_API_KEY || "";           // read live (Admin can update it)
  const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const EL_MODEL = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
  const text = String(req.body?.text || "").slice(0, 800); // cap chars — ElevenLabs bills per character
  if (!EL_KEY) return res.status(503).json({ error: "no elevenlabs key" });
  if (!text.trim()) return res.status(400).json({ error: "no text" });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": EL_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: EL_MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } }),
    });
    if (!r.ok) return res.status(502).json({ error: `elevenlabs ${r.status}` });
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e: any) { res.status(502).json({ error: String(e?.message || e) }); }
});

// ── SAM Creative Space (Proxy to Muapi) ──────────────────────
app.all("/api/creative/*", async (req, res) => {
  const apiKey = process.env.MUAPI_API_KEY || process.env.OPENAI_API_KEY; // fallback if needed, or specific key
  if (!apiKey) return res.status(503).json({ error: "No API key configured for SAM Creative Space" });

  const targetPath = req.params[0];
  const targetUrl = `https://api.muapi.ai/api/v1/${targetPath}`;
  
  try {
    const headers: Record<string, string> = { "x-api-key": apiKey };
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"] as string;
    
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const finalUrl = query ? `${targetUrl}?${query}` : targetUrl;

    const body = ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body);

    const r = await fetch(finalUrl, { method: req.method, headers, body });
    const text = await r.text();
    res.status(r.status);
    try { res.json(JSON.parse(text)); } catch { res.send(text); }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── HUD DATA ENDPOINTS ───────────────────────────────────────
app.get("/api/projects", (_req, res) => res.json(PROJECTS));
app.get("/api/skills", (_req, res) =>
  res.json(SKILLS.map((s) => ({ id: s.id, name: s.name, tier: s.tier, triggers: s.triggers })))
);
app.get("/api/vault/log", (_req, res) => res.json(recentLog(12)));
app.get("/api/vault/graph", (_req, res) => res.json(buildGraph()));
app.get("/api/vault/stats", (_req, res) => res.json(vaultStats()));

app.get("/api/voice/token", async (_req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(401).json({ error: "No OPENAI_API_KEY" });
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "ash", // Ash is a great agent voice
      })
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    res.json(await r.json());
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
// ── Self-update: SAM keeps every user's copy in sync with the repo ──
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
async function git(cmd: string, timeout = 8000): Promise<string> {
  const { promisify } = await import("node:util");
  const { exec } = await import("node:child_process");
  const { stdout } = await promisify(exec)(`git -C ${JSON.stringify(REPO_ROOT)} ${cmd}`, { timeout });
  return stdout.trim();
}
// ── Security watchdog: what SAM has flagged/blocked (Jeeves on the door) ──
app.get("/api/security", (_req, res) => res.json({ status: securityStatus(), events: securityEvents() }));

// ── Proactive: brief / nudges SAM wants to show you (drained when read) ──
app.get("/api/proactive", (_req, res) => res.json({ items: takePending(), nudges: listNudges() }));

// ── Autopilot — lift the silly work (serious/outward actions still always ask) ──
app.get("/api/autopilot", (_req, res) => res.json({ on: autopilotOn() }));
app.post("/api/autopilot", (req, res) => { setAutopilot(!!req.body?.on); res.json({ on: autopilotOn() }); });

// ── People SAM knows by sight (local, private) ──
app.get("/api/people", (_req, res) => res.json(listPeople()));
app.post("/api/people", (req, res) => { const { name, look, relation } = req.body || {}; if (!name) return res.status(400).json({ error: "name required" }); res.json(addPerson(name, look || "", relation)); });

// ── The Team + The Ninjas: parallel specialists, synthesised (SSE) ──
app.get("/api/team/roster", (_req, res) => res.json({ crew: SPECIALISTS, ninjas: NINJAS }));
async function runSquad(kind: "team" | "ninjas", req: any, res: any) {
  const { message, projectId, user } = req.body as { message: string; projectId?: string; user?: User };
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (e: any) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    const system = buildSystem(routeSkill(message, SKILLS)?.body || "", projectId, user, "");
    const run = kind === "ninjas" ? runNinjas : runTeam;
    const text = await run(message, (process.env.DEFAULT_TIER as Tier) || "free", system, send);
    logExchange({ user: `[${kind}] ${message}`, sam: text, skill: kind, project: projectId, provider: kind });
  } catch (e: any) { send({ type: "final", text: `The ${kind} hit a snag: ` + (e?.message || e) }); }
  send({ type: "end" });
  res.end();
}
app.post("/api/team", (req, res) => runSquad("team", req, res));
app.post("/api/ninjas", (req, res) => runSquad("ninjas", req, res));

// ── The Continuous Swarm (Background Agents) ──
app.get("/api/swarms", (_req, res) => res.json(loadSwarms()));
app.post("/api/swarms", async (req, res) => {
  const { goal, projectId, tier, user } = req.body;
  if (!goal) return res.status(400).json({ error: "missing goal" });
  const system = buildSystem("", projectId, user, "");
  const swarm = await startSwarm(goal, system, tier || process.env.DEFAULT_TIER || "free");
  res.json(swarm);
});
app.post("/api/swarms/approve", async (req, res) => {
  const { swarmId, agentId, approved } = req.body;
  try {
    await approveAgent(swarmId, agentId, !!approved);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ── Scheduled Tasks ──
app.get("/api/schedules", (_req, res) => res.json(listSchedules()));
app.post("/api/schedules", (req, res) => {
  const { command, cron } = req.body;
  if (!command || !cron) return res.status(400).json({ error: "missing command or cron" });
  res.json(addSchedule(command, cron));
});
app.delete("/api/schedules/:id", (req, res) => res.json({ ok: removeSchedule(req.params.id) }));
app.post("/api/schedules/:id/toggle", (req, res) => res.json(toggleSchedule(req.params.id)));

app.get("/api/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get("/api/ios/status", (_req, res) => {
  res.json({ folder: dropFolderPath(), enabled: true });
});

app.get("/api/update-check", async (_req, res) => {
  try {
    const local = await git("rev-parse HEAD");
    const remote = (await git("ls-remote origin HEAD")).split(/\s+/)[0] || "";
    res.json({ behind: !!remote && remote !== local, current: local.slice(0, 7), latest: remote.slice(0, 7) });
  } catch { res.json({ behind: false }); }   // no git/remote → silently no updates
});
app.post("/api/update", async (_req, res) => {
  try { res.json({ ok: true, output: (await git("pull --ff-only", 45000)).slice(0, 400) }); }
  catch (e: any) { res.json({ ok: false, error: (e?.stderr || e?.message || e).toString().slice(0, 300) }); }
});
app.get("/api/status", (_req, res) =>
  res.json({
    skills: SKILLS.length,
    projects: PROJECTS.length,
    tools: TOOLS.length,
    platform: process.platform,
    defaultTier: process.env.DEFAULT_TIER || "local",
    voice: { elevenlabs: !!process.env.ELEVENLABS_API_KEY },
    memory: memoryStats(),
    docs: docsStats(),
    models: providersStatus(),
    vault: vaultStats(),
  })
);
app.get("/api/keys", (_req, res) => res.json(providersStatus()));

// ── Serve the built app from this one process (production mode) ──
// One server on :8787 — no separate Vite dev server. Leaner + faster.
const DIST = fileURLToPath(new URL("../dist", import.meta.url)); // decodes spaces (My Drive)
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(join(DIST, "index.html"));
  });
  console.log(`  app served     · http://localhost:${PORT}  (single process)`);
}

app.listen(PORT, () => console.log(`  SAM online · http://localhost:${PORT}\n`));
