// ─────────────────────────────────────────────────────────────
//  S.A.M. · SMART ARTIFICIAL MIND
//  The brain. Ties together: skill router → model providers →
//  vault memory → project context. One endpoint runs the loop.
// ─────────────────────────────────────────────────────────────

import "dotenv/config";
import os from "node:os";
import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { withPending, takePending as takePendingApproval, type PendingCtx } from "./pending.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { setPool, poolSize, keyStatus, getKey } from "./keys.ts";
import { capacityReport, capacityNudge } from "./capacity.ts";
import { sendMail, mailerConfigured, ownerEmail, resetMailer } from "./mailer.ts";
import { runModel, type Tier, providersStatus, runVision, warmBrain, GATEWAY_URL, deviceId } from "./models.ts";
import { drainMetrics, peekMetrics, recordModelCall } from "./metrics.ts";
import { cacheable, fingerprint, lookup as cacheLookup, store as cacheStore, cacheStats, clearCache } from "./cache.ts";
import { addFolder, removeFolder, listFolders, reindexAll, setWatching, startWatching, lifeIndexStats } from "./lifeindex.ts";
import { listForged, setForgedEnabled, deleteForged, syncForgedRegistry, forgedStats } from "./forge.ts";
import { verifyToken as verifyRemoteToken, createToken, revokeToken, listTokens, SCOPES } from "./remote-tokens.ts";
import { encryptionStatus, setupEncryption, unlockWithPassphrase, unlockFromKeychain, lock as lockVault, isEncryptionEnabled } from "./vault-crypto.ts";
import { installCrashHandlers, crashStats, diagnosticBundle } from "./crashlog.ts";
import { previousRelease } from "./rollback.ts";
import { exportPack, planImport, applyPack, myPackKey } from "./packs.ts";
import { recordSuccess, nextMoment, dismiss as dismissMoment, momentStats } from "./moments.ts";
import { runAgent, resumeAgent, runAgentStream, isFastPath } from "./agent.ts";
import { route, selfCheckFailed, nextTierUp } from "./classify.ts";
import { TOOLS } from "./tools.ts";
import { remember, recallWith, memoryStats, pinnedModel } from "./memory.ts";
import { searchDocsWith, docsStats } from "./ingest.ts";
import { embedOne } from "./embeddings.ts";
import { buildIndexes, selectTools, selectSkillId, routingReady } from "./routing.ts";
import { isAllowed, allow, disallow, listAllowed, setAutopilot, autopilotOn, setElonMode, isElonMode, toolTier, isDangerous } from "./authz.ts";
import { nowText, locationText, initContext } from "./context.ts";
import { grabWorld, worldContext } from "./world.ts";
import { logSecurity, securityStatus, securityEvents } from "./security.ts";
import { startProactive, takePending, listNudges, desktopNotify } from "./proactive.ts";
import { runTeam, runNinjas, SPECIALISTS, NINJAS } from "./agents.ts";
import { loadSwarms, startSwarm, approveAgent, resumeOrphanedSwarms } from "./swarm.ts";
import { startDropWatcher, dropFolderPath } from "./ios.ts";
import { startScheduler, listSchedules, addSchedule, removeSchedule, toggleSchedule } from "./scheduler.ts";
import { addPerson, listPeople, peopleContext, faceRoster } from "./people.ts";
import { vapidPublicKey, addSubscription, pushNotify, subscriberCount } from "./push.ts";
import { loadSkills, routeSkill } from "./skills.ts";
import { PROJECTS, projectById, projectsContext } from "./projects.ts";
import { MCP_PRESETS, presetById } from "./mcp-presets.ts";
import * as notebook from "./notebook.ts";
import { signingStatus, generateAndroidKeystore } from "./signing.ts";
import { operatingDoctrine } from "./persona.ts";
import { extractFactsFromTranscript, saveImportedFacts } from "./importer.ts";
import { startP2PDiscovery, startP2PServer, getActivePeers, getNodeId, broadcastToSwarm, P2P_ENABLED } from "./p2p.ts";
import {
  logExchange,
  recentLog,
  recentExchanges,
  buildGraph,
  vaultStats,
  readProjectNote,
  pruneOldLogs,
} from "./vault.ts";

// RESILIENCE: a single unhandled async error must never take SAM down. Log it and stay up —
// an always-on personal assistant that dies on one bad request/response is worse than useless.
process.on("unhandledRejection", (reason) => { try { console.error("[SAM] unhandledRejection:", reason instanceof Error ? reason.message : reason); } catch {} });
process.on("uncaughtException", (err) => { try { console.error("[SAM] uncaughtException:", err?.message || err); } catch {} });

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

// SECURITY · anti-DNS-rebinding. CORS blocks a cross-origin site from READING our responses, but
// a DNS-rebinding attack (attacker.com re-pointed to 127.0.0.1) reaches us as "same-origin" — its
// only tell is the Host header, which is still the ATTACKER'S DOMAIN. Legit requests always carry a
// localhost/LAN-IP Host. So: allow loopback + private-LAN IP hosts (covers phone access), reject any
// domain-name Host outright. This closes the classic local-server takeover from a malicious webpage.
function hostAllowed(hostHeader: string): boolean {
  const h = (hostHeader || "").split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1") return true;
  return /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h);
}
app.use((req, res, next) => {
  if (!hostAllowed(req.headers.host || "")) {
    logSecurity("alert", "blocked-host", `Blocked a request with an unexpected Host header (possible DNS-rebinding)`, req.headers.host || "");
    return res.status(403).json({ error: "bad host" });
  }
  next();
});

// SECURITY headers (defense-in-depth for the served browser/phone HUD — Electron loads file://
// and is unaffected). script-src 'self' blocks any injected inline script; frame-ancestors 'none'
// stops clickjacking; nosniff + no-referrer are free wins. img/media stay open for generated
// pictures/video; the app only ever talks back to itself, so connect-src is locked to 'self'.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https:; " +
    "connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});

// ── REMOTE-MODE token gate (phone access) ─────────────────────
// Active only when SAM_REMOTE=1 + a strong SAM_REMOTE_TOKEN are set (see listen() below).
// Every non-loopback request must present the token — via ?token= once (sets a cookie),
// the cookie afterwards, or an Authorization: Bearer header. Loopback stays open as ever.
{
  // Per-IP brute-force protection: after a few bad tokens from one IP, lock THAT IP with growing
  // backoff — so a real attacker is throttled without a fat-fingered typo locking everyone out.
  const fails = new Map<string, { n: number; until: number }>();
  app.use((req, res, next) => {
    if (!(process.env.SAM_REMOTE === "1" && (process.env.SAM_REMOTE_TOKEN || "").length >= 16)) return next();   // remote off → no gate
    const LIVE = process.env.SAM_REMOTE_TOKEN || "";   // read live so regenerate/disable takes effect without restart
    const liveOk = (t: string) => { if (!t || t.length !== LIVE.length) return false; try { return timingSafeEqual(Buffer.from(t), Buffer.from(LIVE)); } catch { return false; } };
    const ip = req.socket.remoteAddress || "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return next();   // loopback always fine
    const now = Date.now();
    const rec = fails.get(ip);
    if (rec && rec.until > now) { res.status(429).json({ error: "too many attempts — try again shortly" }); return; }
    const q = typeof req.query.token === "string" ? req.query.token : "";
    const cookie = (req.headers.cookie || "").match(/(?:^|;\s*)sam_token=([^;]+)/)?.[1] || "";
    const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const t = q || decodeURIComponent(cookie) || bearer;
    // Credential = the legacy owner token (⇒ full scope) OR a scoped per-device token (v1.5).
    let scope: import("./remote-tokens.ts").Scope | null = liveOk(t) ? "full" : null;
    if (!scope) { const s = verifyRemoteToken(t); if (s) scope = s.scope; }
    if (!scope) {
      const n = (rec?.n || 0) + 1;
      const until = n >= 5 ? now + Math.min(15 * 60_000, 1000 * 2 ** (n - 5)) : 0;   // exp backoff after 5 bad tries
      if (fails.size > 2000) fails.clear();   // bound memory
      fails.set(ip, { n, until });
      logSecurity("alert", "remote-denied", `Blocked a remote request with a bad/missing token (attempt ${n} from this device)`, ip);
      res.status(401).json({ error: "unauthorized" }); return;
    }
    fails.delete(ip);   // good token → clear this IP's record
    (req as any).remoteScope = scope;
    // READ-ONLY tokens can view but never mutate — block every non-GET API call.
    if (scope === "read-only" && req.method !== "GET" && req.method !== "HEAD" && req.path.startsWith("/api/")) {
      res.status(403).json({ error: "read-only token — this device can view but not run tasks or change anything" }); return;
    }
    if (q) {
      res.setHeader("Set-Cookie", `sam_token=${encodeURIComponent(q)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
      // Strip the token from the URL (it lingers in history/address bar otherwise) — redirect the
      // page navigation to the clean path; the cookie now carries auth.
      if (req.method === "GET" && !req.path.startsWith("/api/")) { res.redirect(302, req.path || "/"); return; }
    }
    next();
  });
}

// Local-machine-only check (used to fence off the most dangerous / owner-only actions even
// when phone/remote access is on). Uses the socket address — not a spoofable header.
function isLoopback(req: { socket: { remoteAddress?: string | null } }): boolean {
  const ip = req.socket.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const PORT = process.env.PORT || 8787;
// BENCH MODE (scripts/bench.ts) — deterministic mock brain + no background side-effects
// (no scheduler timers, LAN, world-grab, self-update, drop-watcher). Keeps the benchmarked
// pipeline clean, offline and reproducible. Never set in a real install.
const BENCH_MODE = process.env.SAM_BENCH_MOCK === "1";
if (BENCH_MODE) clearCache();   // every benchmark run starts from an empty cache (reproducible)
if (!BENCH_MODE) installCrashHandlers();   // local-only rotating crash log (never uploaded)
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

// MCP — link any configured Model Context Protocol servers (vault/mcp.json), then build
// the semantic tool/skill indexes over the FULL toolset (non-blocking; index is SHA-cached).
import { loadMcpTools } from "./mcp.ts";
void loadMcpTools()
  .then((mcpTools) => { if (mcpTools.length) TOOLS.push(...mcpTools); })
  .catch(() => {})
  .then(() => { const n = syncForgedRegistry(); if (n) console.log(`  forged tools    · ${n} enabled (SAM-built)\n`); })   // hot-load user-enabled forged tools
  .then(() => buildIndexes(SKILLS))
  .then(() => routingReady() && console.log("  routing ready   · semantic tool + skill selection\n"))
  .catch(() => {});   // never let boot indexing reject unhandled
// Pre-load the local brain into RAM so the FIRST message is instant (no cold model-load).
// Local Ollama only — never a cloud call, so it costs nothing.
if (!BENCH_MODE) void warmBrain().then((m) => m && console.log(`  brain warmed    · ${m} resident (first reply is instant)\n`)).catch(() => {});
initContext();
// Self-containment: prune ancient daily logs so the vault stays lean forever (free).
{ const { removed } = pruneOldLogs(); if (removed) console.log(`  vault tidied    · pruned ${removed} old log${removed > 1 ? "s" : ""}\n`); }
// On startup, grab the user's whole operation (apps/repos + brands + socials) so SAM
// walks in already knowing his world. Non-blocking; details load on demand via tools.
if (!BENCH_MODE) void grabWorld().then((s) => console.log(`  ${s}\n`)).catch(() => {});
if (!BENCH_MODE) resumeOrphanedSwarms();
// Vault encryption — auto-unlock from the OS keychain if the user enabled it; else it stays locked
// until they unlock in Settings (remote tokens + other sealed secrets are unreadable while locked).
if (!BENCH_MODE && isEncryptionEnabled()) {
  if (unlockFromKeychain()) console.log("  vault           · 🔓 unlocked from keychain\n");
  else console.log("  vault           · 🔒 encrypted + locked — unlock in Settings\n");
}
// Life index — start watching the folders the user chose (auto-refresh on change; paused on battery).
if (!BENCH_MODE) { try { startWatching(); const li = lifeIndexStats(); if (li.folders) console.log(`  life index      · ${li.folders} folder(s) watched\n`); } catch { /* no folders yet */ } }

// ── P2P Swarm: discover other SAM instances on the LAN ──────
// Off unless SAM_P2P=1 — it binds to the LAN and lets authenticated peers drive
// this SAM's agent, so it's opt-in and token-gated (see p2p.ts). The main API
// stays on 127.0.0.1 regardless.
if (P2P_ENABLED) {
  startP2PDiscovery();
  startP2PServer(async (message, from, project) => {
    // A trusted LAN peer's task runs through our agent loop. We expose ONLY safe
    // (read-only/benign) tools to a P2P turn, so risky actions aren't offered to a remote
    // peer. Under normal/Autopilot mode any risky tool the model still names is skipped for
    // lack of an approver; the ONE exception is Elon Mode (the owner's explicit global
    // "bypass all gates" override) — don't run P2P with Elon Mode on.
    const safeTools = TOOLS.filter((t) => t.safe).map((t) => t.name);
    const system = buildSystem("", project, { name: from, mode: "business" }, "");
    const r = await runAgent(system, message, (process.env.DEFAULT_TIER as Tier) || "free", safeTools);
    return r.kind === "final" ? (r.text || "Done.") : "That needs a risky action — not allowed over P2P.";
  });
} else {
  console.log("  🌐 P2P swarm    · disabled (set SAM_P2P=1 + SAM_P2P_TOKEN to enable)");
}

// Non-blocking background selfupdate — replaces the old blocking prestart hook.
// SAM launches instantly; update check happens silently 5s later.
if (!BENCH_MODE) setTimeout(async () => {
  try {
    const local = await git("rev-parse HEAD");
    await git("fetch --quiet origin", 10000);
    let remote: string;
    try { remote = await git("rev-parse @{u}"); } catch { return; }
    if (local !== remote) console.log(`\n  ✨ Update available — run 'git pull' to get the latest SAM.\n`);
  } catch { /* offline or not a clone — no drama */ }
}, 5000);

// iOS Companion — watch for iCloud Drop folder notes from the user's iPhone.
if (!BENCH_MODE) startDropWatcher(async (d) => {
  console.log(`  📱 drop received · ${d.file} (${d.kind})`);
  // Process the drop as a standard command (SAM answers it autonomously).
  try {
    const system = buildSystem("", undefined, { name: process.env.SAM_USER_NAME || "there", mode: "business" }, "");
    // iOS companion defaults to NO-DANGEROUS (swarm=true) — an unattended phone drop can never
    // trigger a dangerous tool (send/delete/push/shell) without the owner at the machine.
    const r = await runAgent(system, d.content, (process.env.DEFAULT_TIER as Tier) || "free", undefined, false, true);
    if (r.kind === "final" && r.text) {
      // Queue the result for the app to show + send a notification.
      desktopNotify("SAM — iOS Drop Processed", r.text); void pushNotify("SAM", r.text);
    }
  } catch {}
});

// Scheduler — Recurring background tasks
if (!BENCH_MODE) startScheduler(async (command: string) => {
  const system = buildSystem("", undefined, { name: process.env.SAM_USER_NAME || "there", mode: "business" }, "");
  const r = await runAgent(system, command, (process.env.DEFAULT_TIER as Tier) || "free");
  if (r.kind === "final" && r.text) {
    desktopNotify("SAM — Scheduled Task", r.text); void pushNotify("SAM — scheduled task", r.text);
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
  // Run the three independent lookups in PARALLEL — they don't depend on each other,
  // so this is ~max(latency) instead of the sum (saves 1-3s on the brief).
  const { toolByName } = await import("./tools.ts");
  const runTool = (n: string, i: any) => { const t = toolByName(n); return t ? t.run(i).catch(() => "") : Promise.resolve(""); };
  const [calendarData, emailData, weatherData] = await Promise.all([
    runTool("read_calendar", {}),
    runTool("read_emails", {}),
    runTool("get_weather", { place: locationText() || "" }),
  ]);

  const prompt = `Give me my morning brief — short, warm, punchy (5-8 lines). It's ${nowText()}.` +
    `${locationText() ? ` I'm near ${locationText()}.` : ""}` +
    `\n\n## Today's Calendar\n${calendarData || "Nothing on the calendar today."}` +
    `\n\n## Latest Emails\n${emailData || "Inbox is quiet."}` +
    `\n\n## Weather\n${weatherData || "Couldn't get the weather."}` +
    `${nudges.length ? `\n\n## Pending Nudges\n${nudges.map((n) => `- ${n.text}${n.due ? ` (due ${n.due})` : ""}`).join("\n")}` : "\n\nNo pending nudges."}` +
    `${capacityNudge() ? `\n\n## Free AI capacity\n${capacityNudge()}` : ""}` +
    `\n\nSynthesise all of this into a single, warm, punchy morning brief. Lead with the most important thing. Don't just list — weave it into a narrative. If free AI capacity is thin, mention it and the one key to add.`;
  try {
    const qvec = await embedOne(prompt, true);
    const r = await runAgent(system, prompt, (process.env.DEFAULT_TIER as Tier) || "free", selectTools(qvec, 6));
    const brief = r.kind === "final" ? (r.text || "") : "";
    // Email the brief to the owner too, if SAM's email is set up (fire-and-forget).
    if (brief && mailerConfigured() && ownerEmail()) void sendMail(ownerEmail(), "☀️ SAM — your morning brief", brief);
    return brief;
  } catch { return ""; }
});

// Pull the last few exchanges from the vault so SAM actually remembers
// what was just discussed (real continuity across messages/sessions).
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function recallMemory(): string {
  const recent = recentExchanges(5);
  if (!recent.length) return "";
  const lines = recent.map((e) => `- the user: ${clip(e.user, 220)}\n  You: ${clip(e.sam, 220)}`).join("\n");
  return `\n## Recent conversation (remember this for continuity)\n${lines}`;
}

interface User { name?: string; about?: string; mode?: "business" | "personal"; language?: string }

// The core SAM persona — addresses whoever is actually using SAM.
// Pull the best-matching passages from the ingested document library (roadmap #93:
// SAM knows your docs). Reuses the query vector already computed for memory recall.
function recallDocs(qvec: { model: string; vec: number[] } | null): string {
  if (!qvec || !docsStats().chunks) return "";
  return searchDocsWith(qvec, 4)
    .map((h) => `- [${h.source.split("/").pop()}] ${clip(h.text, 420)}`)
    .join("\n");
}

function buildSystem(skillBody: string, projectId?: string, user?: User, recalled?: string, interactive = false, docs?: string, lean = false): string {
  const project = projectId ? projectById(projectId) : undefined;
  const note = projectId ? readProjectNote(projectId) : "";
  const name = (user?.name || "there").trim();
  const mode = user?.mode === "personal" ? "personal" : "business";

  // TOKEN DIET (Phase 1): trivial requests (greetings, tiny maths, one-liners) get a LEAN
  // prompt — persona + date only, none of the heavy doctrine/brands/world/skill blocks.
  // Cuts the prompt from ~3.5k tokens to ~60 with zero quality loss on these requests.
  if (lean) {
    return [
      `You are SAM — ${name}'s personal AI assistant. Confident, warm, sharp, a little flair — never robotic. Call them ${name} now and then.`,
      `Keep it tight and correct. Never bluff; if you're unsure, say so.`,
      user?.language && !/^en|english/i.test(user.language) ? `Always reply to ${name} in ${user.language}.` : ``,
      `Today & current time: ${nowText()}`,
      // Keep the routed skill's playbook (it's small + relevant) but drop the heavy persona/doctrine.
      skillBody ? `\n## Playbook\n${skillBody}` : ``,
    ].filter(Boolean).join("\n");
  }
  const pctx = mode === "business" ? projectsContext() : "";   // compute once (was called twice)
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
    `- If ${name}'s ranting/gassed, be the calm head: "I hear you — here are the facts, here's the smart move," grounded in their memory + reality.`,
    `- YOUR OWN SETUP (know this about yourself): you run FREE out of the box — no keys, no setup. Extra keys are OPTIONAL and are added in Settings (the 🔑 button up top), NEVER by editing files. So NEVER tell ${name} to edit a .env or any file, never say where a config file lives, and never ask them to paste an API key into the chat (you can't take keys safely there — they go in Settings). If you ever hit a "couldn't reach a brain" blip, it's a brief free-lane hiccup — just tell them to try again in a moment; restarting is NOT required and never loses their settings.`,
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
      ? `## Mode: PERSONAL 🏠\n${name}'s in PERSONAL mode — life outside work: family, friends, health, home, personal admin, downtime, sorting their own stuff. Be a mate — warm, relaxed, real. Don't lead with business or brands unless ${name} brings them up.`
      : `## Mode: BUSINESS 💼\n${name}'s in BUSINESS mode — brands, work, money, growth, ops. Sharp operator energy: think about what actually moves the needle for their businesses.`,
    ``,
    mode === "business" && pctx ? `## ${name}'s brands (context)\n${pctx}\n${worldContext()}` : ``,
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

// FREE-FIRST: premium is auto-reachable ONLY when the operator opted in (DEFAULT_TIER=premium
// or SAM_AUTO_PREMIUM=1). Otherwise the cascade tops out at the strong free "deep" lane and the
// wrong-tier self-check never spends real money without the user's say-so.
function autoPremiumAllowed(): boolean {
  return process.env.SAM_AUTO_PREMIUM === "1" || (process.env.DEFAULT_TIER as Tier) === "premium";
}

// The cascade router: classify → tier + lane + lean + a human reason for the badge.
// A skill match can PIN local (cheaper) but never silently upgrades the tier to premium.
function pickTier(message: string, tier?: Tier) {
  const skill = routeSkill(message, SKILLS);
  const r = route(message, { userTier: tier, allowPremium: autoPremiumAllowed() });
  // Honour an explicit env default only when the classifier said "free" and nothing stronger was asked.
  const envDefault = (process.env.DEFAULT_TIER as Tier) || null;
  let chosen: Tier = r.tier;
  if (!tier && envDefault === "local" && r.tier === "free" && r.klass !== "needs-tools") chosen = "local";
  return { skill, chosen, lane: r.lane, klass: r.klass, reason: r.reason, lean: r.lean };
}

// TOKEN DIET: only memory chunks that clear a higher relevance floor, capped and de-duplicated,
// so the prompt carries the few facts that matter — not five loosely-related ones.
function dietRecall(qvec: { model: string; vec: number[] } | null, name?: string): string {
  if (!qvec || !memoryStats().count) return "";
  const seen = new Set<string>();
  return recallWith(qvec, 4, 0.42, name)
    .filter((h) => { const k = h.text.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((h) => `- ${h.text}`).join("\n");
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
    if (Array.isArray(facts)) for (const f of facts) if (typeof f === "string" && f.length > 6) await remember(f, "fact", name);
  } catch { /* memory is best-effort */ }
}

// ── MAIN COMMAND LOOP ────────────────────────────────────────
//  Runs the AGENT: SAM can use tools. Safe tools run automatically;
//  a risky tool returns kind:"pending" for the user to approve.
app.post("/api/command", async (req, res) => {
  const { message, projectId, tier: rawTier, user, attachments, noCache } = req.body as
    { message: string; projectId?: string; tier?: string; user?: User; attachments?: any[]; noCache?: boolean };
  const atts = Array.isArray(attachments) ? attachments : [];
  const images = atts.filter((a) => a?.kind === "image" && a.data);
  const texts = atts.filter((a) => a?.kind === "text" && a.text);
  if (!message?.trim() && !atts.length) return res.status(400).json({ error: "empty message" });

  // TURBO: one fast model call on the quickest free provider — skip tools, embedding,
  // recall and routing entirely. Trades the tool loop for raw speed.
  const turbo = rawTier === "turbo";
  const tier = (turbo ? "free" : rawTier) as Tier | undefined;

  try {
  // SPEED: quick chat/drafting skips embedding, recall and routing entirely.
  const fast = turbo || (!!message && isFastPath(message));
  const qvec = (!fast && message) ? await embedOne(message, true, pinnedModel()) : null;

  let { skill, chosen, reason, lean, klass } = pickTier(message || "look at this", tier);
  const semanticSkillId = selectSkillId(qvec);   // no-op when qvec is null
  if (semanticSkillId) { const s = SKILLS.find((x) => x.id === semanticSkillId); if (s) { skill = s; if (s.tier === "local") chosen = tier || "local"; } }
  const recalled = (!fast && !lean) ? dietRecall(qvec, user?.name) : "";
  const docs = (fast || lean) ? "" : recallDocs(qvec);
  let toolNames = fast ? undefined : selectTools(qvec, 8, message);
  // SCOPED REMOTE TOKENS: a non-`full` remote device (e.g. the iOS companion on `no-dangerous`)
  // never even sees dangerous tools, and dangerous can't auto-run (swarm=true).
  const remoteScope = (req as any).remoteScope as string | undefined;
  const restricted = !!remoteScope && remoteScope !== "full";
  if (restricted && toolNames) toolNames = toolNames.filter((n) => !isDangerous(n));
  const system = buildSystem(skill?.body || "", projectId, user, recalled, true, docs, lean);
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

  // ── SEMANTIC CACHE (Phase 2) — same question, same context → instant + 0 tokens ──
  // Only for plain-text messages (no attachments) that are safe to cache. The fingerprint
  // pins the exact context so a changed fact/file misses. `noCache` (the re-ask-fresh tap) skips it.
  const canCache = !atts.length && !!message && cacheable(message);
  const fp = canCache ? fingerprint({ skillId: skill?.id, userName: user?.name, mode: user?.mode, lean, recalled, docs }) : "";
  if (canCache && !noCache) {
    const t0 = Date.now();
    const hit = cacheLookup(message, fp, qvec);
    if (hit) {
      recordModelCall({ tier: hit.tier, provider: hit.provider, promptTokens: 0, outputTokens: 0, ms: Date.now() - t0, cached: true, reason: "cache hit" });
      recordSuccess("cache-hit");
      return res.json({
        kind: "final", text: hit.answer, trace: [], provider: hit.provider,
        projectId: projectId || "", tier: hit.tier, message, cached: true,
        route: { tier: hit.tier, klass, reason: "from memory · 0 tokens", cached: true, escalated: false },
      });
    }
  }

  // Text files → fold their contents into the request, then run the agent.
  let fullMessage = message || "";
  if (texts.length) fullMessage += "\n\n" + texts.map((t) => `[Attached file: ${t.name}]\n${t.text}`).join("\n\n");

  let r = await runAgent(system, fullMessage, chosen, toolNames, turbo, restricted, reason);   // restricted ⇒ swarm-mode: dangerous never auto-runs
  let escalated = false, answeredTier = chosen, badgeReason = reason;

  // WRONG-TIER SELF-CHECK: if a cheap answer that used NO tools looks truncated/refused/empty,
  // escalate ONE tier and serve the better answer — the user sees one good reply, not the retry.
  // Gated to tool-free finals so we never re-run a side-effecting action.
  if (r.kind === "final" && !turbo && r.trace.length === 0 && selfCheckFailed(r.text || "", message)) {
    const up = nextTierUp(chosen, autoPremiumAllowed());
    if (up) {
      const up2 = await runAgent(system, fullMessage, up, toolNames, turbo, restricted, `escalated ${chosen}→${up}`);
      if (up2.kind === "final" && !selfCheckFailed(up2.text || "", message)) {
        r = up2; escalated = true; answeredTier = up; badgeReason = `${reason} · escalated → ${up}`;
      }
    }
  }

  if (r.kind === "final") {
    logExchange({ user: message, sam: r.text || "", skill: skill?.id, project: projectId, provider: r.provider || "" });
    void learnFrom(message || "", r.text || "", userName);   // fire-and-forget: build long-term memory
    // Cache only tool-FREE finals (no tool ran → reproducible, and dangerous-tool runs are never cached).
    if (canCache && r.trace.length === 0 && r.text) cacheStore({ message, fp, answer: r.text, provider: r.provider || "", tier: answeredTier, qvec });
    recordSuccess(answeredTier === "local" ? "local" : "task");   // for the (opt-in, dismissible) share moments
  }
  const ctx: PendingCtx = { tier: answeredTier, projectId, skillBody: skill?.body || "", skillId: skill?.id, user };
  res.json({ ...withPending(r, ctx), skill: skill?.id || null, projectId: projectId || "", tier: answeredTier, message,
    route: { tier: answeredTier, klass, reason: badgeReason, escalated } });
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ kind: "final", text: "Something went wrong on my end — give that another go.", error: String(e?.message || e) });
  }
});

// ── STREAMING command (SSE) — tokens + tool events as they happen ──
app.post("/api/stream", async (req, res) => {
  const { message, projectId, tier: rawTier, user, noCache } = req.body as { message: string; projectId?: string; tier?: string; user?: User; noCache?: boolean };
  if (!message?.trim()) return res.status(400).json({ error: "empty message" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (e: any) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  try {
    // Setup (embed/recall/routing) is INSIDE the try — a throw here (e.g. an embed
    // provider blowing up) must still send done+end, or the client's SSE reader hangs.
    const turbo = rawTier === "turbo";              // one fast call, no tools
    const tier = (turbo ? "free" : rawTier) as Tier | undefined;
    const fast = turbo || isFastPath(message);
    const qvec = fast ? null : await embedOne(message, true, pinnedModel());
    let { skill, chosen, reason, lean, klass } = pickTier(message, tier);
    const semanticSkillId = selectSkillId(qvec);
    if (semanticSkillId) { const s = SKILLS.find((x) => x.id === semanticSkillId); if (s) { skill = s; if (s.tier === "local") chosen = tier || "local"; } }
    const recalled = (!fast && !lean) ? dietRecall(qvec, user?.name) : "";
    const docs = (fast || lean) ? "" : recallDocs(qvec);
    let toolNames = fast ? undefined : selectTools(qvec, 8, message);
    const restricted = !!(req as any).remoteScope && (req as any).remoteScope !== "full";   // scoped remote token
    if (restricted && toolNames) toolNames = toolNames.filter((n) => !isDangerous(n));
    const system = buildSystem(skill?.body || "", projectId, user, recalled, true, docs, lean);
    const userName = (user?.name || "the user").trim();

    // ── SEMANTIC CACHE — same question, same context → replay instantly, 0 tokens ──
    const canCache = !!message && cacheable(message);
    const fp = canCache ? fingerprint({ skillId: skill?.id, userName: user?.name, mode: user?.mode, lean, recalled, docs }) : "";
    if (canCache && !noCache) {
      const t0 = Date.now();
      const hit = cacheLookup(message, fp, qvec);
      if (hit) {
        recordModelCall({ tier: hit.tier, provider: hit.provider, promptTokens: 0, outputTokens: 0, ms: Date.now() - t0, cached: true, reason: "cache hit" });
        send({ type: "route", tier: hit.tier, klass, reason: "from memory · 0 tokens", cached: true });
        send({ type: "token", t: hit.answer });
        send({ type: "done", text: hit.answer, provider: hit.provider, trace: [], cached: true });
        send({ type: "end", projectId: projectId || "" });
        return res.end();
      }
    }

    // Router badge — tell the client which tier is answering and why, before tokens flow.
    send({ type: "route", tier: chosen, klass, reason });
    const ctx: PendingCtx = { tier: chosen, projectId, skillBody: skill?.body || "", skillId: skill?.id, user };
    await runAgentStream(system, message, chosen, toolNames, (e) => {
      send(e.type === "pending" ? withPending(e, ctx) : e);
      if (e.type === "done") {
        logExchange({ user: message, sam: e.text || "", skill: skill?.id, project: projectId, provider: e.provider || "" });
        void learnFrom(message, e.text || "", userName);
        // Cache tool-free finals only (reproducible; never a dangerous-tool run).
        if (canCache && (e.trace?.length ?? 0) === 0 && e.text) cacheStore({ message, fp, answer: e.text, provider: e.provider || "", tier: chosen, qvec });
      }
    }, turbo);
  } catch (e: any) {
    send({ type: "done", text: "Something went wrong mid-answer.", trace: [] });
  }
  send({ type: "end", projectId: projectId || "" });
  res.end();
});

// ── APPROVE / DECLINE a risky action, then continue ──────────
app.post("/api/confirm", async (req, res) => {
  // Client sends only {pendingId, approved, always} — everything else comes from
  // the server-held record, so a caller can't approve a tool/input we never proposed.
  const { pendingId, approved, always } = req.body as { pendingId?: string; approved?: boolean; always?: boolean };
  const p = takePendingApproval(pendingId ? String(pendingId) : undefined);
  if (!p) return res.status(410).json({ kind: "final", text: "That approval expired — ask me again and I'll re-propose it.", trace: [] });
  if (approved && always && p.tool) allow(p.tool);   // "yes, and always allow this"
  try {
    const system = buildSystem(p.skillBody, p.projectId, p.user, undefined, true);
    const r = await resumeAgent(system, p.transcript, p.tier as Tier, !!approved, p.tool, p.input, p.trace);
    if (r.kind === "final") {
      logExchange({ user: `[${approved ? "approved" : "declined"} ${p.tool}]`, sam: r.text || "", skill: p.skillId, project: p.projectId, provider: r.provider || "" });
    }
    const ctx: PendingCtx = { tier: p.tier, projectId: p.projectId, skillBody: p.skillBody, skillId: p.skillId, user: p.user };
    res.json({ ...withPending(r, ctx), skill: p.skillId || null, projectId: p.projectId || "", tier: p.tier });
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ kind: "final", text: "Something went wrong finishing that — try again.", error: String(e?.message || e) });
  }
});

// What can SAM actually do? (for the UI / transparency)
app.get("/api/tools", (_req, res) => res.json(TOOLS.map((t) => ({ name: t.name, safe: t.safe, tier: toolTier(t.name, t.safe), description: t.description, allowed: isAllowed(t.name) }))));

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
  ai21: "AI21_API_KEYS", upstage: "UPSTAGE_API_KEYS",
  nebius: "NEBIUS_API_KEYS", cohere: "COHERE_API_KEYS", perplexity: "PERPLEXITY_API_KEYS",
  // Infinite Compute — Asian Heavyweights
  alibaba: "ALIBABA_API_KEYS", volcengine: "VOLCENGINE_API_KEYS", zhipu: "ZHIPU_API_KEYS",
  moonshot: "MOONSHOT_API_KEYS", minimax: "MINIMAX_API_KEYS", stepfun: "STEPFUN_API_KEYS",
  baidu: "BAIDU_API_KEYS", tencent: "TENCENT_API_KEYS",
  // Bonus free/free-credit providers
  deepinfra: "DEEPINFRA_API_KEYS", scaleway: "SCALEWAY_API_KEYS",
  chutes: "CHUTES_API_KEYS", friendli: "FRIENDLI_API_KEYS", codestral: "CODESTRAL_API_KEYS",
  inference: "INFERENCE_API_KEYS", gmi: "GMI_API_KEYS", vercel: "VERCEL_API_KEYS", ovh: "OVH_API_KEYS",
  fal: "FAL_API_KEYS",
};
const CONFIG_ENV: Record<string, string> = {
  cloudflareAccount: "CLOUDFLARE_ACCOUNT_ID", cloudflareToken: "CLOUDFLARE_API_TOKEN", leonardo: "LEONARDO_API_KEY",
  pexels: "PEXELS_API_KEY", pixabay: "PIXABAY_API_KEY", giphy: "GIPHY_API_KEY", tmdb: "TMDB_API_KEY", omdb: "OMDB_API_KEY",
  obsidianVault: "OBSIDIAN_VAULT",
  elevenlabs: "ELEVENLABS_API_KEY", elevenVoice: "ELEVENLABS_VOICE_ID",
  defaultTier: "DEFAULT_TIER", musicService: "MUSIC_SERVICE",
  groqModel: "GROQ_MODEL", claudeModel: "CLAUDE_MODEL",
  notion: "NOTION_API_KEY", slack: "SLACK_BOT_TOKEN",
  discord: "DISCORD_WEBHOOK_URL", twitter: "TWITTER_BEARER_TOKEN", slackChannel: "SLACK_CHANNEL",
  linear: "LINEAR_API_KEY", linearTeam: "LINEAR_TEAM_ID",
  // SAM's own email (SMTP) — set from Settings, saved to .env
  smtpHost: "SMTP_HOST", smtpPort: "SMTP_PORT", smtpUser: "SMTP_USER",
  smtpPass: "SMTP_PASS", smtpFrom: "SMTP_FROM", ownerEmail: "SAM_OWNER_EMAIL",
  // Apple signed releases (owner-only, BUILD-time creds — used by npm run release:app)
  appleId: "APPLE_ID", appleTeam: "APPLE_TEAM_ID", applePass: "APPLE_APP_SPECIFIC_PASSWORD",
};
// Packaged app sets DOTENV_CONFIG_PATH to a writable per-user .env; dev/CLI falls back to the
// repo .env next to the source (../.env, decoded for spaces in the install path).
const ENV_PATH = process.env.DOTENV_CONFIG_PATH || fileURLToPath(new URL("../.env", import.meta.url));

function writeEnv(key: string, value: string) {
  let txt = "";
  try { txt = readFileSync(ENV_PATH, "utf8"); } catch {}
  value = value.replace(/[\r\n]/g, " ");   // one value = one line — no .env line injection
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
    // Apple signing (owner) — non-secret fields + whether the app-specific password is set
    media: { pexels: !!process.env.PEXELS_API_KEY, pixabay: !!process.env.PIXABAY_API_KEY, giphy: !!process.env.GIPHY_API_KEY, tmdb: !!process.env.TMDB_API_KEY, omdb: !!process.env.OMDB_API_KEY },
    apple: {
      appleId: process.env.APPLE_ID || "",
      appleTeam: process.env.APPLE_TEAM_ID || "",
      applePassSet: !!process.env.APPLE_APP_SPECIFIC_PASSWORD,
    },
    // SAM email — non-secret fields + whether a password is set (never the password itself)
    email: {
      configured: mailerConfigured(),
      smtpHost: process.env.SMTP_HOST || "",
      smtpPort: process.env.SMTP_PORT || "",
      smtpUser: process.env.SMTP_USER || "",
      smtpFrom: process.env.SMTP_FROM || "",
      ownerEmail: process.env.SAM_OWNER_EMAIL || "",
      smtpPassSet: !!process.env.SMTP_PASS,
    },
    elonMode: isElonMode(),
    pools,
  });
});

// Live-validate a key by making one cheap test call to the provider. The key is used + discarded
// (never logged, never stored here) — only saved if the user then hits Save.
const testGet = (url: string, key: string) => fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false);
const KEY_TEST: Record<string, (k: string) => Promise<boolean>> = {
  groq: (k) => testGet("https://api.groq.com/openai/v1/models", k),
  gemini: (k) => fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false),
  openrouter: (k) => testGet("https://openrouter.ai/api/v1/models", k),
  mistral: (k) => testGet("https://api.mistral.ai/v1/models", k),
  nvidia: (k) => testGet("https://integrate.api.nvidia.com/v1/models", k),
  cerebras: (k) => testGet("https://api.cerebras.ai/v1/models", k),
  together: (k) => testGet("https://api.together.xyz/v1/models", k),
};
app.post("/api/admin/validate-key", async (req, res) => {
  const { provider, key } = (req.body || {}) as { provider?: string; key?: string };
  if (!provider || !key) return res.json({ valid: false });
  const tester = KEY_TEST[provider];
  if (!tester) return res.json({ valid: null });   // can't test this one — save it and it rotates in
  try { res.json({ valid: await tester(String(key).trim()) }); } catch { res.json({ valid: false }); }
});

// SAM Cloud gateway quota (only meaningful if SAM_GATEWAY_URL is set at build) — the UI shows the
// remaining daily free allowance + nudges the user to add their own key for unlimited use.
app.get("/api/gateway/quota", async (_req, res) => {
  if (!GATEWAY_URL) return res.json({ enabled: false });
  try {
    const r = await fetch(`${GATEWAY_URL}/v1/quota?device=${encodeURIComponent(deviceId())}`, { signal: AbortSignal.timeout(6000) });
    res.json({ enabled: true, ...(await r.json()) });
  } catch { res.json({ enabled: true, error: "unreachable" }); }
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
  if (envVar.startsWith("SMTP_") || envVar === "SAM_OWNER_EMAIL") resetMailer();   // pick up the new email config
  res.json({ ok: true, key });
});

// Send a test email to confirm SAM's email is wired up.
app.post("/api/admin/test-email", async (_req, res) => {
  const r = await sendMail(ownerEmail(), "✅ SAM email test", "This is SAM — your email is set up. I can now send your morning brief and nudges here.");
  res.json(r);
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
  // Elon Mode bypasses EVERY ask-first safety gate — never flippable from a remote device
  // (a phone with the shared token). Only the owner, at the machine itself, can enable it.
  if (!isLoopback(req)) return res.status(403).json({ error: "Elon Mode can only be toggled on this computer, not remotely." });
  const { on } = req.body as { on: boolean };
  setElonMode(on);
  res.json({ ok: true, elonMode: isElonMode() });
});

// ── ElevenLabs premium voice (optional; free browser voice used otherwise) ──
// TTS — rotating free-first lanes, works OUT OF THE BOX with zero keys:
//   1. ElevenLabs (premium voice — only if you added a key; bills per char, so capped)
//   2. Groq TTS (free tier, if a Groq key is set)
//   3. Pollinations openai-audio (FREE, NO key — the out-of-the-box voice)
// Client falls back to the browser's built-in voice if all lanes miss.
app.post("/api/speak", async (req, res) => {
  const text = String(req.body?.text || "").slice(0, 800); // cap chars (premium bills per char)
  if (!text.trim()) return res.status(400).json({ error: "no text" });
  const sendAudio = (buf: ArrayBuffer, type = "audio/mpeg") => { res.setHeader("Content-Type", type); res.send(Buffer.from(buf)); };
  // LANE 1 · ElevenLabs (premium)
  const EL_KEY = process.env.ELEVENLABS_API_KEY || "";           // read live (Admin can update it)
  if (EL_KEY) {
    try {
      const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
      const EL_MODEL = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": EL_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: EL_MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } }),
      });
      if (r.ok) return sendAudio(await r.arrayBuffer());
    } catch { /* fall through */ }
  }
  // LANE 2 · Groq TTS (free tier)
  const gk = getKey("groq");
  if (gk) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/audio/speech", {
        method: "POST", headers: { Authorization: `Bearer ${gk}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "playai-tts", voice: "Fritz-PlayAI", input: text, response_format: "mp3" }),
      });
      if (r.ok) return sendAudio(await r.arrayBuffer());
    } catch { /* fall through */ }
  }
  // LANE 3 · Pollinations (FREE, no key — out-of-the-box voice)
  try {
    const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=nova`, { signal: AbortSignal.timeout(30000) });
    if (r.ok && (r.headers.get("content-type") || "").includes("audio")) return sendAudio(await r.arrayBuffer(), r.headers.get("content-type") || "audio/mpeg");
  } catch { /* nothing left */ }
  res.status(503).json({ error: "no tts lane available" });
});

// ── SAM Creative Space (Proxy to Muapi) ──────────────────────
app.all("/api/creative/*", async (req, res) => {
  // ONLY the muapi key — no OpenAI fallback: an OpenAI key isn't valid at muapi anyway,
  // so the old fallback just leaked the user's OpenAI credential to a third party.
  const apiKey = process.env.MUAPI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "No MUAPI_API_KEY configured for SAM Creative Space" });

  // Sanitize the wildcard path so it can only address muapi's own API surface — no
  // "..", scheme, host, credentials or backslashes that could redirect the request
  // elsewhere (SSRF). Only plain path segments are allowed.
  const targetPath = String((req.params as unknown as Record<string, string | undefined>)["0"] ?? "");
  if (!/^[a-zA-Z0-9._~/-]*$/.test(targetPath) || targetPath.includes("..")) {
    return res.status(400).json({ error: "Invalid creative path" });
  }
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
app.post("/api/people", (req, res) => { const { name, look, relation, face } = req.body || {}; if (!name) return res.status(400).json({ error: "name required" }); res.json(addPerson(name, look || "", relation, Array.isArray(face) ? face : undefined)); });
// Face descriptors (128-float vectors, computed on-device) the HUD matches against — no images.
app.get("/api/faces", (_req, res) => res.json({ faces: faceRoster() }));

// 🔌 MCP presets — one-tap connect to business tools (Stripe, RevenueCat, Metricool, Meta Ads…).
// Config (with keys) is loopback-only; keys are written to vault/mcp.json (gitignored) and NEVER
// returned by the API. Takes effect on the next restart (MCP servers load at boot).
const MCP_CONFIG = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "mcp.json");
function readMcpConfig(): { servers: any[] } { try { const c = JSON.parse(readFileSync(MCP_CONFIG, "utf8")); return { servers: Array.isArray(c?.servers) ? c.servers : [] }; } catch { return { servers: [] }; } }
function writeMcpConfig(cfg: { servers: any[] }) { mkdirSync(dirname(MCP_CONFIG), { recursive: true }); writeFileSync(MCP_CONFIG, JSON.stringify(cfg, null, 2)); }
app.get("/api/mcp/presets", (_req, res) => {
  const configured = new Set(readMcpConfig().servers.map((s: any) => s?.name));
  // never leak env VALUES — only the catalog + which ids are connected
  res.json({ presets: MCP_PRESETS.map((p) => ({ id: p.id, label: p.label, emoji: p.emoji, note: p.note, official: p.official, fields: p.fields, docs: p.docs, connected: configured.has(p.id) })) });
});
app.post("/api/mcp/configure", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "configure MCP on this computer only" });
  const { id, env } = req.body || {};
  const preset = presetById(String(id || ""));
  if (!preset) return res.status(400).json({ error: "unknown preset" });
  if (!env || typeof env !== "object" || preset.fields.some((f) => !String(env[f.env] || "").trim())) return res.status(400).json({ error: "missing key(s)" });
  const cleanEnv: Record<string, string> = {};
  for (const f of preset.fields) cleanEnv[f.env] = String(env[f.env]).trim();
  const cfg = readMcpConfig();
  const server = { name: preset.id, command: preset.command, args: preset.args, env: cleanEnv };
  const i = cfg.servers.findIndex((s: any) => s?.name === preset.id);
  if (i >= 0) cfg.servers[i] = server; else cfg.servers.push(server);
  writeMcpConfig(cfg);
  res.json({ ok: true, needsRestart: true });
});
app.post("/api/mcp/remove", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const id = String(req.body?.id || "");
  const cfg = readMcpConfig();
  const before = cfg.servers.length;
  cfg.servers = cfg.servers.filter((s: any) => s?.name !== id);
  writeMcpConfig(cfg);
  res.json({ ok: cfg.servers.length < before, needsRestart: true });
});

// 🔔 Web Push — SAM reaches your phone even when the app is closed.
app.get("/api/push/key", (_req, res) => res.json({ key: vapidPublicKey(), subscribers: subscriberCount() }));
app.post("/api/push/subscribe", (req, res) => { const ok = addSubscription(req.body); res.json({ ok }); });


// 📱 Phone link — loopback-only. Returns the scan-me URL (with token) so Settings can show a
// QR the phone camera reads → lands authenticated. Only reveals the token to a local request.
function lanIP(): string | null {
  const nets = os.networkInterfaces();
  const n = Object.values(nets).flat().find((x) => x && x.family === "IPv4" && !x.internal);
  return n?.address || null;
}
app.get("/api/phone-link", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const remoteOn = process.env.SAM_REMOTE === "1" && (process.env.SAM_REMOTE_TOKEN || "").length >= 16;
  const lan = lanIP();
  const url = remoteOn && lan ? `http://${lan}:${PORT}/?token=${encodeURIComponent(process.env.SAM_REMOTE_TOKEN!)}` : null;
  res.json({ remoteOn, lan, url });
});
// One-click enable: generate a strong token, persist SAM_REMOTE=1 + token (takes effect on restart).
app.post("/api/phone-enable", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const token = randomBytes(32).toString("base64url");   // 256-bit — quantum-safe symmetric secret (128-bit effective under Grover)
  writeEnv("SAM_REMOTE", "1");
  writeEnv("SAM_REMOTE_TOKEN", token);
  process.env.SAM_REMOTE = "1"; process.env.SAM_REMOTE_TOKEN = token;
  res.json({ ok: true, needsRestart: true });
});
// 🔁 Rotate the token — instantly revokes every device (they must re-scan). No restart needed; the
// gate reads SAM_REMOTE_TOKEN live. Loopback-only so a remote device can never rotate you out.
app.post("/api/phone-regenerate", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const token = randomBytes(32).toString("base64url");   // 256-bit, quantum-safe
  writeEnv("SAM_REMOTE_TOKEN", token);
  process.env.SAM_REMOTE_TOKEN = token;
  logSecurity("info", "phone-token-rotated", "Phone access token regenerated — all devices must re-connect", "owner");
  res.json({ ok: true, rotated: true });
});
// 🔴 Turn phone access OFF — closes the LAN entirely (binds back to loopback on next restart) and
// invalidates the token now.
// 🚀 Sign & ship — SAM checks your signing readiness and does the mechanical bits (owner-only).
app.get("/api/signing/status", async (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  try { res.json(await signingStatus()); } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post("/api/signing/android-keystore", async (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  res.json(await generateAndroidKeystore());
});

app.post("/api/phone-disable", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  writeEnv("SAM_REMOTE", "0");
  process.env.SAM_REMOTE = "0";
  logSecurity("info", "phone-disabled", "Phone/remote access turned off", "owner");
  res.json({ ok: true, needsRestart: true });
});

// 📸 Save a camera snapshot into the vault (local only — vault/photos is gitignored).
app.post("/api/photo", (req, res) => {
  try {
    const data = String(req.body?.data || "");
    const b64 = data.replace(/^data:image\/\w+;base64,/, "");
    if (!b64 || b64.length > 14_000_000) return res.status(400).json({ error: "no/oversized image" });
    const dir = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(new URL(import.meta.url))), "..", "vault"), "photos");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const file = join(dir, `photo-${stamp}.jpg`);
    writeFileSync(file, Buffer.from(b64, "base64"));
    res.json({ ok: true, path: file });
  } catch (e: any) { res.status(500).json({ error: String(e?.message || e).slice(0, 120) }); }
});

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

// ── 📓 NOTEBOOKS (NotebookLM UI backend) — grounded Q&A + audio overview over YOUR sources ──
// ── 🎨 STUDIO — free-first image/video generation (Pollinations → keyed lanes), no MUAPI needed ──
const urlFromMarkdown = (md: string) => { const m = String(md||"").match(/\((https?:\/\/[^)\s]+)\)/); return m ? m[1] : ""; };
// A generated image is a http URL (Pollinations/Together/…) or a data: URI (Cloudflare/HF/NVIDIA base64 lanes).
const mediaFromMarkdown = (md: string) => { const m = String(md||"").match(/\((data:image\/[^)\s]+|https?:\/\/[^)\s]+)\)/); return m ? m[1] : ""; };

// ── Generated images are cached to the vault and served SAME-ORIGIN (/api/studio/media/…) so no
//    service-worker or CSP cross-origin quirk can ever break them. The `ref` always comes from SAM's
//    own media matrix (never user input), so this is not an open proxy.
const GEN_DIR = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "studio-gen");
async function cacheStudioMedia(ref: string): Promise<string | null> {
  try {
    let buf: Buffer = Buffer.alloc(0), ext = "jpg";
    if (ref.startsWith("data:")) {
      const m = ref.match(/^data:image\/(\w+);base64,(.*)$/); if (!m) return null;
      ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
      buf = Buffer.from(m[2], "base64");
    } else {
      // Retry until we get real bytes — Pollinations can 200 with an EMPTY body on the GET that
      // immediately follows the tool's HEAD probe; a moment later it returns the actual image.
      let ct = "";
      for (let attempt = 0; attempt < 4 && !buf.length; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1500));
        const r = await fetch(ref, { signal: AbortSignal.timeout(45000) });
        if (!r.ok) continue;
        buf = Buffer.from(await r.arrayBuffer());
        ct = r.headers.get("content-type") || "";
      }
      ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    }
    if (!buf.length) return null;
    const name = createHash("sha1").update(ref).digest("hex").slice(0, 16) + "." + ext;
    mkdirSync(GEN_DIR, { recursive: true });
    writeFileSync(join(GEN_DIR, name), buf);
    // keep the 60 most-recent generations, prune the rest so the vault never balloons
    try { readdirSync(GEN_DIR).map((f) => ({ f, t: statSync(join(GEN_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(60).forEach(({ f }) => { try { unlinkSync(join(GEN_DIR, f)); } catch {} }); } catch {}
    return name;
  } catch (e: any) { console.error("[studio] cacheStudioMedia failed:", e?.message || e); return null; }
}
app.get("/api/studio/media/:id", (req, res) => {
  const id = String(req.params.id).replace(/[^a-zA-Z0-9._-]/g, "");   // strip any path-traversal
  const file = join(GEN_DIR, id);
  if (!id || !existsSync(file)) return res.status(404).end();
  const ext = id.split(".").pop();
  res.type(ext === "png" ? "png" : ext === "webp" ? "webp" : "jpeg").send(readFileSync(file));
});
app.post("/api/studio/image", async (req, res) => {
  const { prompt, width, height } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "no prompt" });
  const w = Math.min(Number(width) || 1024, 1440), h = Math.min(Number(height) || 1024, 1440);
  // FREE no-key lane first: build the Pollinations URL ourselves and fetch the bytes directly (no HEAD
  // probe → avoids the empty-body quirk the generate_image tool hits), then cache same-origin.
  try {
    const seed = randomBytes(4).readUInt32BE(0);
    const purl = `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0, 900))}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
    const name = await cacheStudioMedia(purl);
    if (name) return res.json({ url: `/api/studio/media/${name}` });
  } catch {}
  // Fall back to the keyed matrix (Cloudflare/HF/NVIDIA/… → http URL or data URI) and cache that too.
  const t = TOOLS.find((x) => x.name === "generate_image");
  if (t) {
    try {
      const out = await t.run({ prompt, width, height });
      const ref = mediaFromMarkdown(out);
      if (ref) { const name = await cacheStudioMedia(ref); return res.json({ url: name ? `/api/studio/media/${name}` : ref }); }
      return res.json({ error: out });
    } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
  }
  res.status(500).json({ error: "image tool missing" });
});
app.post("/api/studio/video", async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "no prompt" });
  const t = TOOLS.find((x) => x.name === "generate_video");
  if (!t) return res.status(500).json({ error: "video tool missing" });
  try { const out = await t.run({ prompt }); const url = urlFromMarkdown(out); res.json(url ? { url } : { error: out }); }
  catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
});
// Style-card preview thumbnails — generated ONCE via Pollinations, cached to the vault, served
// locally (instant after first boot). Same-origin so no CSP/SW issues, and only 12 ever generated.
const STUDIO_PREVIEWS: Record<string, string> = {
  cinematic: "cinematic portrait, dramatic rim lighting, film grain, moody",
  photoreal: "photorealistic landscape, golden hour, ultra detailed, 8k",
  anime: "anime girl, cel shaded, vibrant colours, studio ghibli",
  "3d": "cute 3d character render, octane, soft lighting, pixar",
  product: "luxury perfume bottle product shot, studio lighting, clean",
  logo: "minimal geometric vector logo mark, flat, bold",
  neon: "cyberpunk city street, neon signs, rain, night, blade runner",
  oil: "classical oil painting portrait, thick brushstrokes, renaissance",
  water: "watercolour floral illustration, soft, delicate washes",
  pixel: "16-bit pixel art fantasy village, retro game scene",
  comic: "comic book superhero, bold ink, halftone, dynamic action",
  fantasy: "epic fantasy castle, dragons, magic, dramatic sky, concept art",
};
const PREVIEW_DIR = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "studio-previews");
async function genPreview(id: string): Promise<Buffer | null> {
  const prompt = STUDIO_PREVIEWS[id]; if (!prompt) return null;
  try {
    const u = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=220&height=150&nologo=true&seed=${id.length + 3}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(45000) });
    if (r.ok) { const buf = Buffer.from(await r.arrayBuffer()); mkdirSync(PREVIEW_DIR, { recursive: true }); writeFileSync(join(PREVIEW_DIR, `${id}.jpg`), buf); return buf; }
  } catch {}
  return null;
}
app.get("/api/studio/preview/:style", async (req, res) => {
  const id = String(req.params.style); if (!STUDIO_PREVIEWS[id]) return res.status(404).end();
  const file = join(PREVIEW_DIR, `${id}.jpg`);
  if (existsSync(file)) return res.type("jpeg").send(readFileSync(file));
  const buf = await genPreview(id);
  if (buf) return res.type("jpeg").send(buf);
  res.status(503).end();
});
// Pre-warm the 12 previews in the background at boot (once) so the Studio is snappy.
setTimeout(async () => { for (const id of Object.keys(STUDIO_PREVIEWS)) { if (!existsSync(join(PREVIEW_DIR, `${id}.jpg`))) await genPreview(id).catch(() => {}); } }, 4000);

app.post("/api/studio/enhance", async (req, res) => {
  const p = String(req.body?.prompt || "").trim();
  if (!p) return res.status(400).json({ error: "no prompt" });
  const sys = "You are a prompt engineer for AI image/video generation. Rewrite the user's idea into ONE vivid, specific, cinematic prompt (subject, setting, lighting, mood, lens, detail). Output ONLY the improved prompt, no quotes, no preamble, under 60 words.";
  try { const r = await runModel("free", sys, p); res.json({ prompt: (r.text || p).replace(/^["']|["']$/g, "").trim() }); }
  catch { res.json({ prompt: p }); }
});
app.get("/api/notebooks", (_req, res) => res.json({ notebooks: notebook.listNotebooks() }));
app.post("/api/notebooks", (req, res) => res.json(notebook.ensureNotebook(String(req.body?.title || "Notebook"))));
app.get("/api/notebooks/:id/sources", (req, res) => res.json({ sources: notebook.notebookSources(req.params.id) }));
app.delete("/api/notebooks/:id", (req, res) => res.json({ ok: notebook.deleteNotebook(req.params.id) }));
app.post("/api/notebooks/:id/source", async (req, res) => {
  const { url, file, text, title } = req.body || {};
  try {
    if (url) { const r = await notebook.addUrl(req.params.id, String(url)); return res.json({ ok: true, chunks: r.chunks, title: r.title }); }
    if (file) { const c = await notebook.addFile(req.params.id, String(file).replace(/^~/, os.homedir())); return res.json({ ok: true, chunks: c }); }
    if (text) { const c = await notebook.addText(req.params.id, String(title || "note"), String(text)); return res.json({ ok: true, chunks: c }); }
    res.status(400).json({ error: "need url, file, or text" });
  } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.post("/api/notebooks/:id/ask", async (req, res) => {
  const q = String(req.body?.question || "").trim();
  if (!q) return res.status(400).json({ error: "no question" });
  const passages = await notebook.retrieve(req.params.id, q, 8);
  if (!passages.length) return res.json({ answer: "This notebook has nothing on that yet — add sources first.", citations: [] });
  const ctx = passages.map((p, n) => `[${n + 1}] (${p.title})\n${p.text}`).join("\n\n");
  const sys = "You answer STRICTLY from the provided sources — a grounded research assistant. Never use outside knowledge. Cite each claim with its [n] number. If the sources don't cover it, say so plainly. Be clear and well-organised.";
  const r = await runModel("free", sys, `SOURCES:\n${ctx}\n\nQUESTION: ${q}\n\nAnswer using ONLY the sources above, citing [n]:`);
  res.json({ answer: r.text, citations: [...new Set(passages.map((p) => p.title))], provider: r.provider });
});
app.post("/api/notebooks/:id/audio", async (req, res) => {
  const chunks = notebook.overviewChunks(req.params.id, 12);
  if (!chunks.length) return res.json({ script: "" });
  const material = chunks.map((c) => `• (${c.title}) ${c.text.slice(0, 600)}`).join("\n");
  const sys = "You are a producer writing a short, engaging two-host podcast (hosts: Alex and Sam) that explains the user's material in an accessible, curious way. Natural dialogue, hand-offs, a few 'oh interesting' beats — no fluff, all grounded in the material. 8-14 exchanges. Format each line as 'Alex: …' / 'Sam: …'.";
  const r = await runModel("free", sys, `MATERIAL:\n${material}\n\nWrite the audio-overview script:`);
  res.json({ script: r.text });
});
app.post("/api/schedules/:id/toggle", (req, res) => res.json(toggleSchedule(req.params.id)));

// ── P2P Network — expose peer list to frontend ──
app.get("/api/p2p/peers", (_req, res) => res.json({ self: getNodeId(), peers: getActivePeers() }));
app.post("/api/p2p/broadcast", async (req, res) => {
  const { message, project } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: "empty" });
  const results = await broadcastToSwarm(message, project);
  res.json({ ok: true, sent: results.length, results });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, uptime: process.uptime(), routing: peekMetrics(8), cache: cacheStats() }));

// ── THE LIFE INDEX (Phase 3) — the settings screen drives these ──
app.get("/api/life-index", (_req, res) => res.json({ ...lifeIndexStats(), folders: listFolders() }));
app.post("/api/life-index", async (req, res) => {
  const { path } = req.body as { path?: string };
  if (!path?.trim()) return res.status(400).json({ error: "path required" });
  try { const r = await addFolder(path); res.json({ ok: true, ...r }); }
  catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
});
app.delete("/api/life-index", (req, res) => {
  const path = (req.query.path as string) || (req.body as any)?.path;
  if (!path) return res.status(400).json({ error: "path required" });
  res.json(removeFolder(path));
});
app.post("/api/life-index/reindex", async (_req, res) => { const reports = await reindexAll(); res.json({ ok: true, reports }); });
app.post("/api/life-index/watch", (req, res) => { const on = !!(req.body as any)?.on; setWatching(on); res.json({ ok: true, ...lifeIndexStats() }); });

// ── THE FORGE (Phase 5) — settings screen: review, enable/disable, delete SAM-forged tools ──
app.get("/api/forged", (_req, res) => res.json({ ...forgedStats(), tools: listForged() }));
app.post("/api/forged/:name/enable", (req, res) => {
  const on = !!(req.body as any)?.enabled;
  res.json({ ok: setForgedEnabled(req.params.name, on), ...forgedStats() });
});
app.delete("/api/forged/:name", (req, res) => res.json({ ok: deleteForged(req.params.name), ...forgedStats() }));

// ── SCOPED REMOTE TOKENS (v1.5) — Settings manages per-device phone tokens. Loopback-only:
// tokens can only be minted/revoked at the machine itself, never from a phone.
app.get("/api/remote-tokens", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "manage tokens on this computer only" });
  res.json({ tokens: listTokens(), scopes: SCOPES });
});
app.post("/api/remote-tokens", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "manage tokens on this computer only" });
  const { label, scope, ttlDays } = req.body as { label?: string; scope?: any; ttlDays?: number };
  if (!SCOPES.includes(scope)) return res.status(400).json({ error: `scope must be one of ${SCOPES.join(", ")}` });
  // Returns the plaintext token ONCE — the client shows it (QR / copy); we only ever store the hash.
  res.json(createToken(label || "device", scope, Number(ttlDays) || undefined));
});
app.delete("/api/remote-tokens/:id", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "manage tokens on this computer only" });
  res.json({ ok: revokeToken(req.params.id) });
});

// ── VAULT ENCRYPTION AT REST (v1.5) — loopback-only; the passphrase never leaves the machine. ──
app.get("/api/encryption", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "manage encryption on this computer only" });
  res.json(encryptionStatus());
});
app.post("/api/encryption/setup", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "set up encryption on this computer only" });
  const { passphrase, useKeychain } = req.body as { passphrase?: string; useKeychain?: boolean };
  const r = setupEncryption(String(passphrase || ""), useKeychain !== false);
  res.status(r.ok ? 200 : 400).json(r);
});
app.post("/api/encryption/unlock", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "unlock on this computer only" });
  const ok = unlockWithPassphrase(String((req.body as any)?.passphrase || ""));
  res.status(ok ? 200 : 401).json({ ok, ...encryptionStatus() });
});
app.post("/api/encryption/lock", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  lockVault(); res.json({ ok: true, ...encryptionStatus() });
});

// ── CRASH SAFETY NET (v1.5) — local-only; the bundle is redacted + copied by the USER, never uploaded. ──
app.get("/api/diagnostics", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  res.json({ ...crashStats(), bundle: diagnosticBundle(process.env.SAM_APP_VERSION || "dev", new Date().toISOString()) });
});

// ── UPDATE CHANNEL (v1.5) — stable (default) or beta. Beta opts into -beta.N prereleases so risky
// features canary to volunteers first. Takes effect on the next launch (electron-updater reads it). ──
app.get("/api/update-channel", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  res.json({ channel: process.env.SAM_UPDATE_CHANNEL === "beta" ? "beta" : "stable" });
});
app.post("/api/update-channel", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const channel = (req.body as any)?.channel === "beta" ? "beta" : "stable";
  writeEnv("SAM_UPDATE_CHANNEL", channel);
  process.env.SAM_UPDATE_CHANNEL = channel;
  res.json({ ok: true, channel, note: "Takes effect on the next launch." });
});

// ── SAM PACKS (v1.5) — export/import shareable bundles. Import NEVER auto-installs. ──
app.get("/api/packs/key", (req, res) => { if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" }); res.json({ publicKey: myPackKey() }); });
app.post("/api/packs/export", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const { meta, contents } = req.body as { meta?: any; contents?: any };
  if (!meta?.name || !contents) return res.status(400).json({ error: "meta.name + contents required" });
  res.json({ pack: exportPack(meta, contents, Date.now()) });
});
app.post("/api/packs/import", async (req, res) => {
  // Returns a PLAN of what's inside + safety-scan results. Installs nothing.
  const plan = await planImport(String((req.body as any)?.pack || ""));
  res.status(plan.ok ? 200 : 400).json(plan);
});
app.post("/api/packs/apply", async (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "install packs on this computer only" });
  const { pack, choices } = req.body as { pack?: string; choices?: any };
  const r = await applyPack(String(pack || ""), choices || {}, Date.now());
  if (r.installedTools.length) syncForgedRegistry();   // registers nothing new (all disabled) — refresh view
  res.status(r.ok ? 200 : 400).json(r);
});
app.get("/api/packs/community", async (_req, res) => {
  // Read-only index pulled from the public richhabits/sam-packs repo — no server of our own needed.
  try {
    const r = await fetch("https://raw.githubusercontent.com/richhabits/sam-packs/main/index.json", { signal: AbortSignal.timeout(8000) });
    res.json(r.ok ? await r.json() : { packs: [], note: "community index unavailable" });
  } catch { res.json({ packs: [], note: "offline" }); }
});

// ── SHARE MOMENTS (v1.5) — subtle, opt-in, dismissible-forever. No telemetry (local counters). ──
app.get("/api/moments", (_req, res) => res.json({ moment: nextMoment(), stats: momentStats() }));
app.post("/api/moments/dismiss", (req, res) => { const id = (req.body as any)?.id; if (id) dismissMoment(String(id)); res.json({ ok: true }); });

// ── ROLLBACK (v1.5) — if an update breaks something, get the previous release's installer. ──
app.get("/api/rollback", async (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const current = process.env.SAM_APP_VERSION || "999.0.0";   // dev: nothing is older, returns null
  const target = await previousRelease(current, process.env.SAM_UPDATE_CHANNEL === "beta");
  res.json({ current, target, note: target ? `Reinstall SAM ${target.version} — your data stays put.` : "No earlier release found." });
});

// BENCH ONLY — drain the model-call metrics recorded since the last drain. Registered only in
// bench mode so it's never exposed in a real install. scripts/bench.ts drains between tasks.
if (BENCH_MODE) app.get("/api/bench/drain", (_req, res) => res.json({ calls: drainMetrics() }));
app.get("/api/ios/status", (_req, res) => {
  res.json({ folder: dropFolderPath(), enabled: true });
});

const isNewerVer = (a: string, b: string) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; } return false; };
app.get("/api/update-check", async (_req, res) => {
  // Packaged app (version injected by Electron): compare against the latest GitHub RELEASE, since
  // there's no git to diff. Returns a download URL so the banner can offer a one-click download.
  const appVer = process.env.SAM_APP_VERSION;
  if (appVer) {
    try {
      const r = await fetch("https://api.github.com/repos/richhabits/sam/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "SAM-app" }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const rel: any = await r.json();
        const latest = String(rel.tag_name || "").replace(/^v/, "");
        return res.json({ behind: !!latest && isNewerVer(latest, appVer), current: appVer, latest, url: rel.html_url || "https://github.com/richhabits/sam/releases/latest" });
      }
    } catch { /* offline — no drama */ }
    return res.json({ behind: false, current: appVer });
  }
  // Source install: git-based check (git pull updates it).
  try {
    const local = await git("rev-parse HEAD");
    const remote = (await git("ls-remote origin HEAD")).split(/\s+/)[0] || "";
    res.json({ behind: !!remote && remote !== local, current: local.slice(0, 7), latest: remote.slice(0, 7) });
  } catch { res.json({ behind: false }); }   // no git/remote → silently no updates
});
app.post("/api/update", async (_req, res) => {
  try {
    // Refuse gracefully on a dirty tree — never silently overwrite the user's local edits.
    const dirty = (await git("status --porcelain")).trim();
    if (dirty) return res.json({ ok: false, dirty: true, error: "You have unsaved local changes — SAM won't overwrite them. Commit or stash them first (`git stash`), then hit Update again." });
    const output = (await git("pull --ff-only", 45000)).slice(0, 400);
    res.json({ ok: true, output });
  } catch (e: any) {
    const msg = (e?.stderr || e?.message || e).toString();
    const friendly =
      /not a git repository/i.test(msg) ? "This isn't a source checkout — download the latest app from the releases page instead." :
      /diverged|non-fast-forward|would be overwritten|Not possible to fast-forward/i.test(msg) ? "Your copy has diverged from GitHub. Run `git pull` in the sam folder to reconcile, or reinstall the app." :
      /could not resolve host|network|timed out/i.test(msg) ? "Couldn't reach GitHub — check your internet and try again." :
      msg.slice(0, 200);
    res.json({ ok: false, error: friendly });
  }
});
app.get("/api/status", (_req, res) =>
  res.json({
    skills: SKILLS.length,
    projects: PROJECTS.length,
    tools: TOOLS.length,
    platform: process.platform,
    defaultTier: process.env.DEFAULT_TIER || "free",
    voice: { elevenlabs: !!process.env.ELEVENLABS_API_KEY },
    memory: memoryStats(),
    docs: docsStats(),
    models: providersStatus(),
    capacity: capacityReport(),
    vault: vaultStats(),
  })
);
app.get("/api/keys", (_req, res) => res.json(providersStatus()));
// SAM's own free-tier capacity + the single legit key to add next (if any).
app.get("/api/capacity", (_req, res) => res.json({ ...capacityReport(), nudge: capacityNudge() }));

// ── Serve the built app from this one process (production mode) ──
// One server on :8787 — no separate Vite dev server. Leaner + faster.
const DIST = fileURLToPath(new URL("../dist", import.meta.url)); // decodes spaces in the install path
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(join(DIST, "index.html"));
  });
  console.log(`  app served     · http://localhost:${PORT}  (single process)`);
}

// Bind strictly to loopback — prevents network peers on the same Wi-Fi/LAN
// from reaching the API. The CORS check catches browser-origin abuse; this
// is the second layer that stops raw TCP connections from other devices.
// ── LISTEN ────────────────────────────────────────────────────
// Default: loopback only (private, nothing reachable from the network).
// REMOTE MODE (phone access): SAM_REMOTE=1 + SAM_REMOTE_TOKEN=<long secret> binds to the
// LAN but requires the token on EVERY request (cookie set on first visit via ?token=…).
// We refuse to open the network without a strong token — no token, no remote. Note it's
// plain HTTP on your LAN: fine on home Wi-Fi, don't use on networks you don't trust.
const REMOTE = process.env.SAM_REMOTE === "1" && (process.env.SAM_REMOTE_TOKEN || "").length >= 16;
if (process.env.SAM_REMOTE === "1" && !REMOTE) console.log("  ⚠️ SAM_REMOTE ignored — set SAM_REMOTE_TOKEN to a secret of 16+ chars first.\n");
const HOST = REMOTE ? "0.0.0.0" : "127.0.0.1";
app.listen(Number(PORT), HOST, () => {
  console.log(`  SAM online · http://localhost:${PORT}\n`);
  if (REMOTE) {
    const nets = os.networkInterfaces();
    const lan = Object.values(nets).flat().find((n) => n && n.family === "IPv4" && !n.internal)?.address;
    if (lan) console.log(`  📱 phone access · open http://${lan}:${PORT}/?token=YOUR_TOKEN on your phone (same Wi-Fi)\n`);
  }
}).on("error", (e: any) => {
  // Port already taken — almost always another SAM (or a stale one) already serving on it. Don't
  // crash: the window will just connect to whatever's already there. Log it plainly.
  if (e?.code === "EADDRINUSE") console.error(`  ⚠️ Port ${PORT} is already in use — SAM may already be running. Using the existing instance.`);
  else console.error("  ⚠️ Server listen error:", e?.message || e);
});
