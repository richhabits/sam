// ─────────────────────────────────────────────────────────────
//  S.A.M. · SMART ARTIFICIAL MIND
//  The brain. Ties together: skill router → model providers →
//  vault memory → project context. One endpoint runs the loop.
// ─────────────────────────────────────────────────────────────

import "dotenv/config";
// Applied before anything else can print. Every sink SAM writes to funnels through the
// console eventually, so scrubbing here means a secret cannot reach a log by being
// forgotten at one call site.
import { scrubConsole, publicError } from "./scrub.ts";
scrubConsole();
import os from "node:os";
import { timingSafeEqual, } from "node:crypto";
import { readFileSync, existsSync, } from "node:fs";
import { withPending, takePending as takePendingApproval, type PendingCtx } from "./pending.ts";
import { handleUnattended, resolveAsk, sweepAsks, openAsks, getAsk, wireAskDelivery, type Ask } from "./ask.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── `--version` / `version` → print the version and exit, before the server binds (issue #13).
//    Uses the packaged version if Electron set it, else reads it from package.json. ──
if (process.argv.slice(2).some((a) => a === "--version" || a === "version")) {
  let v = process.env.SAM_APP_VERSION || "";
  if (!v) { try { v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version || ""; } catch { /* fall back below */ } }
  console.log(`SAM ${v || "unknown"}`);
  process.exit(0);
}

import express from "express";
import cors from "cors";
import { reloadPools } from "./keys.ts";
import { capacityReport, capacityNudge } from "./capacity.ts";
import { sendMail, mailerConfigured, ownerEmail, } from "./mailer.ts";
import { runModel, type Tier, providersStatus, runVision, warmBrain, } from "./models.ts";
import { drainMetrics, peekMetrics, recordModelCall } from "./metrics.ts";
import { cacheable, fingerprint, lookup as cacheLookup, store as cacheStore, cacheStats, clearCache } from "./cache.ts";
import { addFolder, removeFolder, listFolders, reindexAll, setWatching, startWatching, lifeIndexStats } from "./lifeindex.ts";
import { listForged, setForgedEnabled, deleteForged, syncForgedRegistry, forgedStats } from "./forge.ts";
import { verifyToken as verifyRemoteToken, createToken, revokeToken, listTokens, SCOPES } from "./remote-tokens.ts";
import { encryptionStatus, setupEncryption, unlockWithPassphrase, unlockFromKeychain, lock as lockVault, isEncryptionEnabled } from "./vault-crypto.ts";
import { installCrashHandlers, crashStats, diagnosticBundle } from "./crashlog.ts";
import { previousRelease } from "./rollback.ts";
import { friendlyUpdateError, isNewerVer, sourceUpdateStatus } from "./update-status.ts";
import { exportPack, planImport, applyPack, myPackKey } from "./packs.ts";
import { recordSuccess, nextMoment, dismiss as dismissMoment, momentStats } from "./moments.ts";
import { runAgent, resumeAgent, runAgentStream, isFastPath } from "./agent.ts";
import { route, selfCheckFailed, nextTierUp, CONTINUATION_RE } from "./classify.ts";
import { TOOLS, benchmarkBrains } from "./tools.ts";
import { quotes as marketQuotes } from "./markets.ts";
import { loadRanking, rankingStale, rankingAgeDays, clearRanking } from "./colosseum.ts";
import { remember, recallWith, memoryStats, pinnedModel, listByKind } from "./memory.ts";
import { registerMemoryRoutes } from "./routes.memory.ts";
import { registerWorkflowsRoutes } from "./routes.workflows.ts";
import { writeEnv } from "./env-file.ts";
import { hostAllowed, isLoopback, isTrustedLocal, originAllowed, passkeyRequiredForMutation } from "./http-guards.ts";
import { checkPasskey, handshakeEnforced } from "./handshake.ts";
import { desk as flipitDesk } from "./flipit.ts";
import { JobStore } from "./yard/store.ts";
import { JobLog } from "./yard/worker.ts";
import { supervisor } from "./yard/supervisor.ts";
import { routeOrNull as yardRoute } from "./yard/intent.ts";
import { answerRouted } from "./yard/dispatch.ts";
import { listProjects, readManifest, checkpoints, projectPath } from "./yard/managed.ts";
import { resolvePreview, projectFiles as yardProjectFiles, readProjectFile, projectsRoot } from "./yard/preview.ts";
import {
  requestPairing, pendingRequests, approvePairing, denyPairing,
  verifyPairToken, pairedBrowsers, revokePairing, stashForCollection, collect,
} from "./yard/pairing.ts";

// One store per server process, opened on first use so a SAM with the yard off never
// creates a database it will not read.
// The yard's own door. Loopback position PLUS the passkey, always — never conditional on
// the global setting. Creating a job means running commands on this machine, so it is held
// to the stricter bar whether or not the rest of SAM is hardened today.
// Either the desktop app's per-launch passkey, or a browser this machine's operator
// deliberately paired from inside that app. A paired token is narrower than the passkey:
// it opens the yard's writes and nothing else, and it can be revoked on its own.
const isYardTrusted = (req: any) =>
  isLoopback(req) && (checkPasskey(req) || !!verifyPairToken(req.headers?.["x-sam-pair"]));

let _yard: JobStore | null = null;
const yardStore = (): JobStore => (_yard ??= new JobStore());
import { issuesSummary, listIssues } from "./issues.ts";
import { pulseSummary, snapshot, samplesOf } from "./pulse.ts";
import { startKeeper } from "./keeper.ts";
import { renderConsole } from "./console-view.ts";
import { renderScope, scopeData } from "./scope-view.ts";
import { registerAdminRoutes } from "./routes.admin.ts";
import { registerPeopleRoutes } from "./routes.people.ts";
import { registerStudioRoutes } from "./routes.studio.ts";
import { registerCreativeRoutes } from "./routes.creative.ts";
import { registerVoiceRoutes } from "./routes.voice.ts";
import { searchDocsWith, docsStats } from "./ingest.ts";
import { embedOne } from "./embeddings.ts";
import { buildIndexes, selectTools, selectSkillId, routingReady } from "./routing.ts";
import { isAllowed, allow, disallow, listAllowed, setAutopilot, autopilotOn, toolTier, isDangerous } from "./authz.ts";
import { nowText, locationText, initContext } from "./context.ts";
import { grabWorld, worldContext } from "./world.ts";
import { logSecurity, securityStatus, securityEvents } from "./security.ts";
import { startProactive, takePending, listNudges, desktopNotify } from "./proactive.ts";
import { consentState, setEnabled as setConsent, disableAll as consentDisableAll } from "./consent.ts";
import { readAutonomyLog, clearAutonomyLog } from "./autonomy-log.ts";
import { evaluateTriggers } from "./triggers.ts";
import { listPreferences, learnPreference, forgetPreference, resetPreferences } from "./preferences.ts";
import { isEnabled as consentEnabled } from "./consent.ts";
import { recordTask, analyticsSummary, getAnalytics, resetAnalytics } from "./analytics.ts";
import { telemetryEnabled, telemetryDecided, setTelemetry, buildPayload, postTelemetry } from "./telemetry.ts";
import { billingStatus, checkout as billingCheckout, type Plan } from "./billing.ts";
import { runDoctor } from "./doctor.ts";
import { runTeam, runNinjas, SPECIALISTS, NINJAS } from "./agents.ts";
import { loadSwarms, startSwarm, approveAgent, resumeOrphanedSwarms } from "./swarm.ts";
import { recover as recoverPreviewCommit } from "./preview-commit.ts";
import { crossIn, crossOutOnce, thresholdEnabled } from "./threshold.ts";
import { knackEnabled, recentInfluences } from "./knack.ts";
import { isSetup as safeIsSetup, lock as safeLock, loadIntoProcessEnv as safeLoadEnv, migratableNames, migrateFromEnv as safeMigrate, secretNames, setup as safeSetup, status as safeStatus, unlock as safeUnlock } from "./safe.ts";
import { startDropWatcher, dropFolderPath } from "./ios.ts";
import { startScheduler, listSchedules, addSchedule, removeSchedule, toggleSchedule } from "./scheduler.ts";
import { runDue as runStandingDue, standingEnabled, list as standingList, arm as standingArm, disarm as standingDisarm, rearm as standingRearm, remove as standingRemove } from "./standing.ts";
import { fireDue as fireChimesDue, setTimer as chimeTimer, setAlarm as chimeAlarm, listChimes, cancelChime, snoozeChime, type Chime } from "./chime.ts";
import { bind as routineBind, unbind as routineUnbind, list as routineList, matchRoutine, routinesEnabled, routineFor } from "./routines.ts";
import { getWorkflow, runWorkflow as runWorkflowFor, recordRun as recordWorkflowRunRec } from "./workflows.ts";
import { camerasEnabled, list as listCameras, add as addCamera, remove as removeCamera } from "./cameras.ts";
import { peopleContext, } from "./people.ts";
import { pushNotify, } from "./push.ts";
import { loadSkills, routeSkill, validateSkillTools } from "./skills.ts";
import { PROJECTS, projectById, projectsContext } from "./projects.ts";
import { operatingDoctrine, personaVoice, personaVoiceCompact, PERSONAS } from "./persona.ts";
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
process.on("unhandledRejection", (reason) => { try { console.error("[SAM] unhandledRejection:", reason instanceof Error ? reason.message : reason); } catch { /* logging must never itself throw */ } });
process.on("uncaughtException", (err) => { try { console.error("[SAM] uncaughtException:", err?.message || err); } catch { /* logging must never itself throw */ } });

const app = express();
// SECURITY: only allow same-origin + localhost (dev HUD on :5273). This stops a
// random website you visit from reaching SAM's powerful local API (CSRF-style abuse).
// Any blocked origin gets logged so SAM can call it out.
app.use(cors({
  origin: (o, cb) => {
    const ok = originAllowed(o);
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
app.use((req, res, next) => {
  if (!hostAllowed(req.headers.host || "")) {
    logSecurity("alert", "blocked-host", `Blocked a request with an unexpected Host header (possible DNS-rebinding)`, req.headers.host || "");
    return res.status(403).json({ error: "bad host" });
  }
  next();
});

// SECURITY · the Handshake — loopback position is not authorization. OPT-IN via SAM_REQUIRE_CONTROL_TOKEN:
// off by default so nothing changes. When on, loopback position alone is NOT enough — mutating /api
// calls must carry the per-launch secret the legit frontend holds (a random local process can't).
// Remote mode has its own token, so this only guards the local channel. See control-token.ts.
app.use((req, res, next) => {
  if (!passkeyRequiredForMutation(req, { enforced: handshakeEnforced(), remote: process.env.SAM_REMOTE === "1" })) return next();
  if (checkPasskey(req)) return next();
  logSecurity("alert", "blocked-untrusted-local", `Privileged ${req.method} ${req.path} without the passkey — refused despite loopback`, req.socket.remoteAddress || "");
  return res.status(403).json({ error: "passkey required" });
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
    // AUDIT FIX: a malformed %-escape (e.g. `sam_token=%`) made decodeURIComponent throw an
    // uncaught exception → 500 on the auth path. Decode defensively; a bad cookie is just no token.
    let cookieTok = cookie;
    try { cookieTok = decodeURIComponent(cookie); } catch { cookieTok = ""; }
    const t = q || cookieTok || bearer;
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
      // page navigation to the clean path; the cookie now carries auth. Force a same-origin target:
      // req.path can be "//evil.com/x", which as a Location is protocol-relative and redirects
      // off-site, so collapse any leading slashes to one and only ever bounce to a local path.
      if (req.method === "GET" && !req.path.startsWith("/api/")) {
        const safe = "/" + (req.path || "/").replace(/^\/+/, "");
        res.redirect(302, safe); return;
      }
    }
    next();
  });
}

// Local-machine-only check (used to fence off the most dangerous / owner-only actions even
// when phone/remote access is on). Uses the socket address — not a spoofable header.

const PORT = process.env.PORT || 8787;
// BENCH MODE (scripts/bench.ts) — deterministic mock brain + no background side-effects
// (no scheduler timers, LAN, world-grab, self-update, drop-watcher). Keeps the benchmarked
// pipeline clean, offline and reproducible. Never set in a real install.
const BENCH_MODE = process.env.SAM_BENCH_MOCK === "1";
if (BENCH_MODE) clearCache();   // every benchmark run starts from an empty cache (reproducible)
if (!BENCH_MODE) installCrashHandlers();   // local-only rotating crash log (never uploaded)
const SKILLS = loadSkills();
// Warn (don't crash) if any skill's `tools:` allowlist names a tool SAM doesn't have — a typo
// would otherwise silently deny that tool for that skill forever.
for (const w of validateSkillTools(SKILLS, new Set(TOOLS.map((t) => t.name)))) console.warn(`[skills] ${w}`);

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
  .catch(() => {/* best-effort — nothing downstream depends on this succeeding */})
  .then(() => { const n = syncForgedRegistry(); if (n) console.log(`  forged tools    · ${n} enabled (SAM-built)\n`); })   // hot-load user-enabled forged tools
  .then(() => buildIndexes(SKILLS))
  .then(() => routingReady() && console.log("  routing ready   · semantic tool + skill selection\n"))
  .catch(() => {/* best-effort — nothing downstream depends on this succeeding */});   // never let boot indexing reject unhandled
// Pre-load the local brain into RAM so the FIRST message is instant (no cold model-load).
// Local Ollama only — never a cloud call, so it costs nothing.
if (!BENCH_MODE) void warmBrain().then((m) => m && console.log(`  brain warmed    · ${m} resident (first reply is instant)\n`)).catch(() => {/* warm-up is best-effort and must never delay boot */});
initContext();
// Self-containment: prune ancient daily logs so the vault stays lean forever (free).
{ const { removed } = pruneOldLogs(); if (removed) console.log(`  vault tidied    · pruned ${removed} old log${removed > 1 ? "s" : ""}\n`); }
// On startup, grab the user's whole operation (apps/repos + brands + socials) so SAM
// walks in already knowing his world. Non-blocking; details load on demand via tools.
if (!BENCH_MODE) void grabWorld().then((s) => console.log(`  ${s}\n`)).catch(() => {/* optional world snapshot — boot continues without it */});
if (!BENCH_MODE) resumeOrphanedSwarms();
// The Threshold — CROSS IN: restore the last session's context so SAM resumes knowing what it was
// doing. On by default (SAM_THRESHOLD=0 to disable). The matching CROSS OUT (persist a summary) is
// registered on the stop signals below. CROSS IN only reads+logs; CROSS OUT is fail-loud + bounded.
if (!BENCH_MODE && thresholdEnabled()) {
  const prev = crossIn();
  if (prev) console.log(`  threshold       · ↩ resumed from ${prev.at}${prev.openThreads.length ? ` · open: ${prev.openThreads.join("; ")}` : ""}\n`);
  // Terminal/kill stops. The Electron GUI-quit path calls the SAME crossOutOnce (electron/main.ts),
  // and the once-guard means whichever fires first persists — never both.
  const onStop = (sig: string) => {
    const r = crossOutOnce(`session ended (${sig})`);
    if (r && !r.ok) console.error(`  ⚠️ threshold CROSS OUT failed (${r.error.detail}) — context for this session was NOT saved.`); // LOUD, never silent
    process.exit(0);
  };
  process.once("SIGTERM", () => onStop("SIGTERM"));
  process.once("SIGINT", () => onStop("SIGINT"));
}
// The Safe — encrypted secret store. The real gate is `safeIsSetup()`: this is a NO-OP for anyone who
// hasn't set the Safe up (everyone by default). If it IS set up, unlock on launch (keychain mode is
// seamless) and bridge the sealed secrets back + reload the key pools, so a user who set up the Safe
// via the UI just works on the next boot. SAM_SAFE=0 is the kill-switch. A failed unlock is LOUD and
// does NOT fall back to plaintext — the migration removed it, so secrets stay unavailable until unlocked.
if (!BENCH_MODE && safeIsSetup() && process.env.SAM_SAFE !== "0") {
  const u = safeUnlock();
  if (u.ok) {
    const n = safeLoadEnv();       // bridge the non-key secrets (tool creds) into process.env
    const pooled = reloadPools();  // provider keys are read from the Safe at point of use — rebuild the pools now they're unlocked
    console.log(`  the Safe        · 🔓 unlocked (${u.value}) · ${n} secret(s) loaded · ${pooled} key(s) pooled\n`);
  } else console.error(`  ⚠️ the Safe is LOCKED (${u.error.kind}) — secrets are unavailable (no plaintext fallback). Unlock in Settings.`);
}
// Preview → Commit crash recovery: if a journalled write was interrupted, roll its applied steps
// back to before-state so a batch never survives half-applied across a restart. A no-op when no
// journal is present (the default), so it's safe to run unconditionally.
if (!BENCH_MODE) { const { rolledBack } = recoverPreviewCommit(); if (rolledBack.length) console.log(`  recovered       · rolled back ${rolledBack.length} interrupted write(s)\n`); }
// The Keeper — on by default (SAM_KEEPER=0 to disable). One level-triggered pass on a timer that
// re-checks reality and corrects safe drift (stale latches, low disk surfaced), recording each to
// the Black Box + the Pulse.
if (!BENCH_MODE && startKeeper()) console.log("  keeper armed    · watching for drift\n");
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

// The Ask — how an out-of-band approval request reaches the user (their OWN channels only). The
// Console card (openAsks) is the always-available local fallback if none of these are configured.
wireAskDelivery((a: Ask) => {
  const title = "SAM — approval needed";
  const body = `${a.action} · ${a.blast}. Approve in the app, or it's deferred (not done).`;
  desktopNotify(title, body);
  void pushNotify(title, body, `/?ask=${a.id}`);
  if (mailerConfigured() && ownerEmail()) {
    const mins = Math.round((a.expiresAt - a.raisedAt) / 60_000);
    void sendMail(ownerEmail(), title,
      `SAM wanted to run an action while you were away and needs your OK — nothing has run:\n\n` +
      `  What:  ${a.action}\n  Why:   ${a.why}\n  Risk:  ${a.blast}\n  From:  ${a.source}\n\n` +
      `Open SAM and approve it within ~${mins} min, or it is DEFERRED — not performed.`);
  }
});

// Timeout driver: expire un-answered Asks (SAFE default → deferred, never auto-approved) and let a
// paused swarm agent finish cleanly instead of hanging forever. Cheap 60s tick; unref'd so it never
// keeps the process alive.
if (!BENCH_MODE) setInterval(() => {
  try {
    for (const a of sweepAsks()) {
      if (a.swarmRef) void approveAgent(a.swarmRef.swarmId, a.swarmRef.agentId, false).catch(() => {/* the swarm may be gone */});
    }
  } catch { /* best-effort */ }
}, 60_000).unref?.();

// The Standing Crew (SAM_STANDING, default off) — fire any armed background specialists whose cron is
// due. runDue is idempotent + self-claiming + double-gated (flag AND the "standing-crew" consent);
// a risky action it triggers comes back pending and is deferred, never run unattended.
if (!BENCH_MODE) setInterval(() => { try { if (standingEnabled()) void runStandingDue(new Date()); } catch { /* best-effort */ } }, 60_000).unref?.();
if (standingEnabled()) console.log(`  🛰️ standing     · ${standingList().filter((a) => a.armed).length} armed`);

// The Chime (SAM_CHIME, default off) — ring alarms/timers that are due. fireDue is clock-injected +
// claim-before-notify, safe to call every tick. desktopNotify fires inside it; the callback is where
// SAM's own in-app bell would go. Ringing is a notification only — never runs a tool.
if (!BENCH_MODE) setInterval(() => { try { fireChimesDue(new Date(), (_c: Chime) => {/* in-app bell hook (UI) */}); } catch { /* best-effort */ } }, 30_000).unref?.();

// iOS Companion — watch for iCloud Drop folder notes from the user's iPhone.
if (!BENCH_MODE) startDropWatcher(async (d) => {
  console.log(`  📱 drop received · ${d.file} (${d.kind})`);
  // Process the drop as a standard command (SAM answers it autonomously).
  try {
    const system = buildSystem("", undefined, { name: process.env.SAM_USER_NAME || "there", mode: "business" }, "");
    // iOS companion defaults to NO-DANGEROUS (swarm=true) — an unattended phone drop can never
    // trigger a dangerous tool (send/delete/push/shell) without the owner at the machine.
    const tier = (process.env.DEFAULT_TIER as Tier) || "free";
    const r = await runAgent(system, d.content, tier, undefined, false, true);
    if (r.kind === "final" && r.text) {
      // Queue the result for the app to show + send a notification.
      desktopNotify("SAM — iOS Drop Processed", r.text); void pushNotify("SAM", r.text);
    } else {
      // A phone drop hit a risky action — deliver an Ask instead of silently dropping it.
      handleUnattended(r, { tier, source: "ios", why: `an iOS drop (“${d.file}”) needs this to continue` });
    }
  } catch { /* best-effort — nothing downstream depends on this succeeding */ }
});

// Scheduler — Recurring background tasks
if (!BENCH_MODE) startScheduler(async (command: string) => {
  const system = buildSystem("", undefined, { name: process.env.SAM_USER_NAME || "there", mode: "business" }, "");
  const tier = (process.env.DEFAULT_TIER as Tier) || "free";
  const r = await runAgent(system, command, tier);
  if (r.kind === "final" && r.text) {
    desktopNotify("SAM — Scheduled Task", r.text); void pushNotify("SAM — scheduled task", r.text);
    return r.text;
  }
  // A scheduled task hit a risky action with no one watching. This used to return "Finished." —
  // reported as success while nothing ran (SAM's #1 failure class). The Ask delivers it out-of-band
  // and SAFE-DEFAULTS: not performed unless approved within the timeout.
  const a = handleUnattended(r, { tier, source: "scheduler", why: `a scheduled task (“${command}”) needs this to continue` });
  return a.kind !== "none" ? a.text : "Finished.";
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
    const tier = (process.env.DEFAULT_TIER as Tier) || "free";
    const r = await runAgent(system, prompt, tier, selectTools(qvec, 6));
    // The morning brief shouldn't act riskily unattended — but if a tool it reached for needs
    // approval, surface it as an Ask rather than silently dropping the result.
    handleUnattended(r, { tier, source: "proactive", why: "your morning brief reached for an action that needs approval" });
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

interface User { name?: string; about?: string; mode?: "business" | "personal"; language?: string; persona?: string }

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
      personaVoiceCompact(user?.persona, name),   // same brain, chosen tone — even quick replies feel like the right voice (compact: the lean prompt must stay lean)
      `Keep it tight and correct. Never bluff; if you're unsure, say so.`,
      user?.language && !/^en|english/i.test(user.language) ? `Always reply to ${name} in ${user.language}.` : ``,
      `Today & current time: ${nowText()}`,
      // Keep the routed skill's playbook (it's small + relevant) but drop the heavy persona/doctrine.
      skillBody ? `\n## Playbook\n${skillBody}` : ``,
    ].filter(Boolean).join("\n");
  }
  const pctx = mode === "business" ? projectsContext() : "";   // compute once (was called twice)
  return [
    personaVoice(user?.persona, name),   // LEAD with the chosen voice — switchable tone over the one shared memory
    ``,
    `You are SAM — ${name}'s personal AI assistant. Substance first, and speak in the voice set above. Confident, sharp, human — never robotic or corporate. Call them ${name} now and then.`,
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
    `- If ${name}'s ranting/gassed, be the calm head — hear them out, ground it in the facts + their memory, point to the smart move. Say it in YOUR current voice, not a canned line.`,
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
    // Recency wins: a final, hard reminder of the chosen voice — small free models weight the
    // last instruction most, so this makes the persona actually land (only when non-default).
    user?.persona && user.persona !== "sam" ? `\n${personaVoiceCompact(user.persona, name)}\nStay in this voice for your reply.` : ``,
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
// SAM's replies often CONTAIN the durable thing (a plan it laid out, a decision reached) —
// so we extract from the whole exchange, not just when the user stated a fact.
const PLAN_SIGNAL_RE = /\b(plan|step\s*\d|steps?:|here'?s (the|a) plan|action plan|i'?d recommend|recommendation|strateg|let'?s go with|we'?ll|decision|decided|go with|next steps?|to-?do|open loop|action items?)\b/i;

// A "fact" that's actually noise: a bare single-token slug ("mainline" — no standalone meaning),
// or a transient reading (a weather result / "currently …" isn't a durable fact worth keeping).
const TRANSIENT_FACT_RE = /\b(currently|right now|at the moment|as of|feels like|temperature|humidity|weather)\b|°\s?[cf]\b|\d+\s?(°|km\/h|mph|%)/i;
function isNoisyFact(text: string): boolean {
  const t = text.trim();
  return !/\s/.test(t) || TRANSIENT_FACT_RE.test(t);
}

async function learnFrom(userMsg: string, samMsg: string, name: string) {
  // Extract when the user revealed something durable OR the exchange settled a plan/decision.
  if (!worthRemembering(userMsg) && !PLAN_SIGNAL_RE.test(samMsg || "")) return;
  try {
    const sys = "You extract DURABLE memory from a conversation for a personal assistant. Return ONLY a JSON array of {\"type\",\"text\"} objects (type ∈ fact | plan | decision | task), or [] when nothing is worth keeping. Be strict — most exchanges yield [].";
    const prompt =
      `From the exchange below, capture 0-4 items worth remembering long-term about ${name} and their work:\n` +
      `- fact: a durable personal fact ("${name} prefers X", a person in their life, a project/brand, a contact, a constraint).\n` +
      `- plan: a concrete multi-step plan you AGREED — keep the steps, compact, so "proceed" later can act on it.\n` +
      `- decision: a choice that was actually made ("${name} chose premium positioning for Ghost Detail").\n` +
      `- task: an open loop / to-do still outstanding ("invoice #38 unpaid").\n` +
      `STRICT — return [] unless something genuinely qualifies. Skip small talk, questions, transient state ("tired today"), and anything not actually established. Name the subject in each text so it stands alone.\n\n` +
      `${name}: ${userMsg}\nSAM: ${samMsg}\n\nJSON array of {type,text} (or []):`;
    const r = await runModel("local", sys, prompt);   // LOCAL only — background memory never spends cloud quota (free promise)
    const mm = r.text.match(/\[[\s\S]*\]/);
    if (!mm) return;
    const items = JSON.parse(mm[0]);
    if (!Array.isArray(items)) return;
    for (const it of items) {
      // Tolerate both {type,text} and bare strings (older model outputs) → default to "fact".
      const text = (typeof it === "string" ? it : it?.text) || "";
      const type = ["fact", "plan", "decision", "task"].includes(it?.type) ? it.type : "fact";
      const clean = typeof text === "string" ? text.trim() : "";
      // Quality gate for FACTS: skip noise the extractor sometimes leaks — bare single-token
      // slugs ("mainline") and transient readings (a weather result isn't a durable fact).
      if (type === "fact" && isNoisyFact(clean)) continue;
      if (clean.length > 6) await remember(clean, type, name);
    }
  } catch { /* memory is best-effort */ }
}

// On a continuation ("proceed"/"do step 1"), re-surface the plans/decisions/open loops we've
// agreed — so SAM knows WHAT to continue even beyond the client's recent-turns window. Local,
// on-device, zero-cost: just a SQLite read of the user's own memory.
function openPlans(name?: string): string {
  const rows = [
    ...listByKind("plan", name, 3).map((x) => `- [plan] ${clip(x.text, 320)}`),
    ...listByKind("decision", name, 2).map((x) => `- [decision] ${clip(x.text, 220)}`),
    ...listByKind("task", name, 3).map((x) => `- [open loop] ${clip(x.text, 180)}`),
  ];
  return rows.length ? `\n## What we've been working on — pick up from here\n${rows.join("\n")}` : "";
}

// ── MAIN COMMAND LOOP ────────────────────────────────────────
//  Runs the AGENT: SAM can use tools. Safe tools run automatically;
//  a risky tool returns kind:"pending" for the user to approve.
// Prior turns from the client → a compact transcript the model reads as context, so
// "proceed" / "continue" / "1 then 2" actually know what we were talking about. Bounded
// (last 10 turns, each clipped) to protect free-tier token budgets. Empty when there's
// no history — callers then behave exactly as before.
type ClientTurn = { role?: string; text?: string };
function formatHistory(history: unknown): string {
  if (!Array.isArray(history)) return "";
  const turns = (history as ClientTurn[])
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .slice(-10)
    .map((t) => `${t.role === "user" ? "User" : "SAM"}: ${t.text!.trim().slice(0, 1200)}`);
  if (!turns.length) return "";
  return `Conversation so far (context — the user's NEW message comes after this):\n${turns.join("\n")}`;
}

app.post("/api/command", async (req, res) => {
  const { message, projectId, tier: rawTier, user, attachments, noCache, history } = req.body as
    { message: string; projectId?: string; tier?: string; user?: User; attachments?: any[]; noCache?: boolean; history?: ClientTurn[] };
  const convo = formatHistory(history);
  const atts = Array.isArray(attachments) ? attachments : [];
  const images = atts.filter((a) => a?.kind === "image" && a.data);
  const texts = atts.filter((a) => a?.kind === "text" && a.text);
  if (!message?.trim() && !atts.length) return res.status(400).json({ error: "empty message" });
  recordTask(new Date().toISOString());   // LOCAL analytics only — a count + date, never the message

  // THE YARD — the one question asked before the ordinary path runs. It returns null for
  // conversation, which is nearly everything, and then NOTHING below here changes: the
  // existing behaviour is untouched rather than merely similar. Only a confident, explicit
  // build/edit/status request leaves this path, and only while the yard is switched on.
  if (process.env.SAM_YARD === "1" && message?.trim()) {
    const routed = yardRoute(message, listProjects().map((p) => ({ slug: p.slug, name: p.name })));
    if (routed) {
      const answer = await answerRouted(routed, yardStore());
      if (answer) return res.json({ reply: answer, tool: "the yard", provider: "local", model: "the yard" });
    }
  }

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
  let recalled = (!fast && !lean) ? dietRecall(qvec, user?.name) : "";
  if (CONTINUATION_RE.test(message || "")) recalled = (recalled ? recalled + "\n" : "") + openPlans(user?.name);   // re-anchor "proceed" on the agreed plan
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
  const canCache = !atts.length && !!message && cacheable(message) && !convo;   // multi-turn context → never replay a stale single-turn answer
  const fp = canCache ? fingerprint({ skillId: skill?.id, projectId, userName: user?.name, mode: user?.mode, persona: user?.persona, lean, recalled, docs }) : "";
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

  let r = await runAgent(system, fullMessage, chosen, toolNames, turbo, restricted, reason, convo, skill?.tools);   // restricted ⇒ swarm-mode: dangerous never auto-runs; skill?.tools ⇒ capability allowlist
  let escalated = false, answeredTier = chosen, badgeReason = reason;

  // WRONG-TIER SELF-CHECK: if a cheap answer that used NO tools looks truncated/refused/empty,
  // escalate ONE tier and serve the better answer — the user sees one good reply, not the retry.
  // Gated to tool-free finals so we never re-run a side-effecting action.
  if (r.kind === "final" && !turbo && r.trace.length === 0 && selfCheckFailed(r.text || "", message)) {
    const up = nextTierUp(chosen, autoPremiumAllowed());
    if (up) {
      const up2 = await runAgent(system, fullMessage, up, toolNames, turbo, restricted, `escalated ${chosen}→${up}`, convo, skill?.tools);
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
    if (!res.headersSent) res.status(500).json({ kind: "final", text: "Something went wrong on my end — give that another go.", error: publicError(e) });
  }
});

// ── STREAMING command (SSE) — tokens + tool events as they happen ──
app.post("/api/stream", async (req, res) => {
  const { message, projectId, tier: rawTier, user, noCache, history } = req.body as { message: string; projectId?: string; tier?: string; user?: User; noCache?: boolean; history?: ClientTurn[] };
  if (!message?.trim()) return res.status(400).json({ error: "empty message" });
  const convo = formatHistory(history);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (e: any) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  // ── Routines: a spoken/typed phrase bound to a saved workflow runs it directly, ahead of the
  //    brain. Gated by SAM_ROUTINES; the workflow's own pause-on-dangerous contract is preserved
  //    (execTool refuses unsafe tools here — nothing risky runs unattended from a phrase). ──
  if (routinesEnabled()) {
    const wfId = matchRoutine(message);
    const wf = wfId ? getWorkflow(wfId) : null;
    if (wf) {
      try {
        const phrase = routineFor(wf.id)?.phrases?.[0] || wf.name;
        send({ type: "route", tier: "local", klass: "routine", reason: `routine · “${phrase}” → ${wf.name}` });
        const { toolByName } = await import("./tools.ts");
        const run = await runWorkflowFor(wf, {
          now: new Date().toISOString(),
          execTool: async (tool, input) => {
            const t = toolByName(tool);
            if (!t) return `(no such tool: ${tool})`;
            if (!t.safe) return `(“${tool}” needs your approval — run it with SAM open)`;
            try { return await t.run(input); } catch (e: any) { return `(error: ${e?.message || e})`; }
          },
          execBrain: async (prompt) => (await runModel((process.env.DEFAULT_TIER as Tier) || "free", "You are SAM, running a saved routine step. Do this step and hand back a tight result.", prompt)).text,
        });
        recordWorkflowRunRec(wf.id, run);
        const summary = `▶ Ran your **${wf.name}** routine (${run.results?.length ?? 0} steps)${run.status === "paused" ? " — paused at a step that needs your OK." : run.status === "error" ? " — hit an error." : "."}`;
        send({ type: "token", t: summary });
        send({ type: "done", text: summary, provider: "routine", trace: [] });
        send({ type: "end", projectId: projectId || "" });
        return res.end();
      } catch (e: any) {
        send({ type: "token", t: `Couldn't run that routine: ${e?.message || e}` });
        send({ type: "done", text: "", provider: "routine", trace: [] });
        send({ type: "end", projectId: projectId || "" });
        return res.end();
      }
    }
  }

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
    let recalled = (!fast && !lean) ? dietRecall(qvec, user?.name) : "";
    if (CONTINUATION_RE.test(message || "")) recalled = (recalled ? recalled + "\n" : "") + openPlans(user?.name);   // re-anchor "proceed" on the agreed plan
    const docs = (fast || lean) ? "" : recallDocs(qvec);
    let toolNames = fast ? undefined : selectTools(qvec, 8, message);
    const restricted = !!(req as any).remoteScope && (req as any).remoteScope !== "full";   // scoped remote token
    if (restricted && toolNames) toolNames = toolNames.filter((n) => !isDangerous(n));
    const system = buildSystem(skill?.body || "", projectId, user, recalled, true, docs, lean);
    const userName = (user?.name || "the user").trim();

    // ── SEMANTIC CACHE — same question, same context → replay instantly, 0 tokens ──
    const canCache = !!message && cacheable(message) && !convo;   // multi-turn context → never replay a stale single-turn answer
    const fp = canCache ? fingerprint({ skillId: skill?.id, projectId, userName: user?.name, mode: user?.mode, persona: user?.persona, lean, recalled, docs }) : "";
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
    }, turbo, convo, skill?.tools);   // skill?.tools ⇒ capability allowlist enforced at dispatch
  } catch (_e: any) {
    send({ type: "done", text: "Something went wrong mid-answer.", trace: [] });
  }
  send({ type: "end", projectId: projectId || "" });
  res.end();
});

// ── MEMORY DASHBOARD — "What SAM remembers about you." 100% on-device (SQLite); nothing
//    here ever leaves the machine. Grouped by kind so the user sees facts, plans, decisions
//    and open loops, and can delete any of them. Trust surface + loveability moment. ──
// Model Colosseum — run an Elo benchmark of SAM's free brains (see server/colosseum.ts).
// POST because it fires real model calls (a round-robin of judged matches) — takes ~a minute.
app.post("/api/arena", async (req, res) => {
  const { prompt, prompts, brains } = (req.body || {}) as { prompt?: string; prompts?: string[]; brains?: string[] };
  try { res.json(await benchmarkBrains({ prompt, prompts, brains })); }
  catch (e: any) { res.status(500).json({ error: publicError(e) }); }
});
// Current persisted ranking + freshness — the panel shows this on open (is it still steering?).
app.get("/api/arena", (_req, res) => {
  const r = loadRanking();
  if (!r) return res.json({ current: null });
  res.json({ current: r, stale: rankingStale(r.ts, Date.now()), ageDays: rankingAgeDays(r.ts, Date.now()) });
});
// Forget the ranking → free-tier routing reverts to its default (static lane) order.
app.delete("/api/arena", (_req, res) => { clearRanking(); res.json({ current: null }); });

// Live market quotes for the Markets panel — keyless, free (see server/markets.ts).
app.get("/api/quotes", async (req, res) => {
  const symbols = String(req.query.symbols || "").split(",").map((s) => s.trim()).filter(Boolean);
  try { res.json({ quotes: await marketQuotes(symbols) }); }
  catch (e: any) { res.status(500).json({ quotes: [], error: publicError(e) }); }
});

// Memory dashboard routes live in routes.memory.ts — self-contained (no index.ts-local state).
registerMemoryRoutes(app);
// Persona presets for the switcher — same brain + shared memory, tone only.
app.get("/api/personas", (_req, res) => res.json({ personas: PERSONAS }));

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
    if (!res.headersSent) res.status(500).json({ kind: "final", text: "Something went wrong finishing that — try again.", error: publicError(e) });
  }
});

// What can SAM actually do? (for the UI / transparency)
app.get("/api/tools", (_req, res) => res.json(TOOLS.map((t) => ({ name: t.name, safe: t.safe, tier: toolTier(t.name, t.safe), description: t.description, allowed: isAllowed(t.name) }))));

// ── STANDING AUTHORIZATIONS ("yes, always allow X") ──────────
app.get("/api/allow", (_req, res) => res.json({ allowed: listAllowed() }));
app.post("/api/allow", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "Standing authorizations can only be changed on this computer, not remotely." });
  const { tool, on } = req.body as { tool: string; on: boolean };
  if (!tool) return res.status(400).json({ error: "no tool" });
  on ? allow(tool) : disallow(tool);
  res.json({ ok: true, allowed: listAllowed() });
});


registerAdminRoutes(app);

// Voice/TTS routes live in routes.voice.ts — self-contained (no index.ts-local state).
registerVoiceRoutes(app);
registerCreativeRoutes(app);


// ── HUD DATA ENDPOINTS ───────────────────────────────────────
app.get("/api/projects", (_req, res) => res.json(PROJECTS));
app.get("/api/skills", (_req, res) =>
  res.json(SKILLS.map((s) => ({ id: s.id, name: s.name, tier: s.tier, triggers: s.triggers })))
);
app.get("/api/vault/log", (_req, res) => res.json(recentLog(12)));
app.get("/api/vault/graph", (_req, res) => res.json(buildGraph()));
app.get("/api/vault/stats", (_req, res) => res.json(vaultStats()));

app.get("/api/voice/token", async (req, res) => {
  // AUDIT FIX: this GET MINTS a live OpenAI ephemeral credential, but the global gate only
  // covers mutations — so it was reachable with no Handshake. When the Handshake is enforced,
  // require the passkey (or a paired browser), the same trust the yard's own door demands.
  if (handshakeEnforced() && !isYardTrusted(req)) return res.status(403).json({ error: "passkey required" });
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
// The human-readable version SAM reports in the update popover. Packaged app: injected by Electron.
// Source install: read from package.json once at boot — NOT the git SHA, which is meaningless to a user.
const SAM_VERSION = process.env.SAM_APP_VERSION
  || (() => { try { return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version || ""; } catch { return ""; } })();
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
app.post("/api/autopilot", (req, res) => { if (!isLoopback(req)) return res.status(403).json({ error: "Autopilot can only be toggled on this computer, not remotely." }); setAutopilot(!!req.body?.on); res.json({ on: autopilotOn() }); });

// ── Autonomy consent (v1.8) — the "What can SAM do on its own?" pane + the autonomy log.
// Reading is fine remotely; CHANGING what SAM may do autonomously is a security setting → loopback-only
// (a phone on a scoped token must never be able to grant SAM new autonomy).
app.get("/api/consent", (_req, res) => res.json({ behaviors: consentState() }));
app.post("/api/consent", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  const ok = setConsent(String(req.body?.behavior || "") as any, !!req.body?.on);
  return ok ? res.json({ behaviors: consentState() }) : res.status(400).json({ error: "unknown behavior" });
});
app.post("/api/consent/disable-all", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  consentDisableAll(); res.json({ behaviors: consentState() });
});
app.get("/api/autonomy-log", (req, res) => res.json({ entries: readAutonomyLog(Number(req.query.limit) || 100) }));
app.post("/api/autonomy-log/clear", (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  clearAutonomyLog(); res.json({ ok: true });
});
// Current suggestion cards — evaluates triggers against the live world (due reminders now; file-watch
// wiring surfaces here as the life index reports new files). Data only — nothing runs from this call.
app.get("/api/suggestions", (_req, res) => {
  const dueReminders = listNudges().filter((n) => n.due && new Date(n.due).getTime() <= Date.now()).map((n) => ({ id: n.id, text: n.text }));
  res.json({ cards: evaluateTriggers({ now: new Date().toISOString(), dueReminders }) });
});

// Workflow routes live in routes.workflows.ts — self-contained (no index.ts-local state).
registerWorkflowsRoutes(app);

// ── Measurement (v2.0) — "Your SAM" stats (local) + opt-in anonymous telemetry ──
// Analytics is 100% on-device. The dashboard also reports how many preferences SAM has learned and the
// honest "0 data left your device" (unless the user opted into telemetry).
app.get("/api/analytics", (_req, res) => {
  const s = analyticsSummary(new Date().toISOString());
  res.json({ ...s, preferencesLearned: listPreferences().length, telemetry: { enabled: telemetryEnabled(), decided: telemetryDecided() } });
});
app.post("/api/analytics/reset", (_req, res) => { resetAnalytics(); res.json({ ok: true }); });
// Telemetry: the user's explicit, neutral opt-in. OFF by default; nothing is sent unless enabled.
app.get("/api/telemetry", (_req, res) => res.json({ enabled: telemetryEnabled(), decided: telemetryDecided() }));
app.post("/api/telemetry", (req, res) => {
  // Enabling telemetry causes anonymous data to LEAVE the device — a privacy-posture change, so it's
  // decided AT THE MACHINE only, exactly like /api/consent. A scoped phone token must never flip it on.
  if (!isLoopback(req)) return res.status(403).json({ error: "loopback only" });
  setTelemetry(!!req.body?.on, new Date().toISOString());
  res.json({ enabled: telemetryEnabled(), decided: true });
});
// Exactly what WOULD be sent, so the user can inspect it before deciding (transparency, no dark pattern).
app.get("/api/telemetry/preview", (_req, res) => res.json({ payload: buildPayload(getAnalytics(), process.env.SAM_APP_VERSION || "dev", process.platform, new Date().toISOString()), note: "null means telemetry is off — nothing is sent." }));

// ── Doctor (v2.1) — "SAM isn't working" self-heal. Gathers the live world, returns exact fixes. ──
app.get("/api/doctor", async (_req, res) => {
  const st = providersStatus();
  const hasCloudKeys = Array.isArray(st?.providers) && st.providers.some((p: any) => (p?.keys ?? 0) > 0);
  const ollamaConfigured = !!st?.local?.ollama;
  const ping = async (url: string, ms: number) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok || r.status < 500; } catch { return false; } };
  const ollamaReachable = ollamaConfigured ? await ping("http://127.0.0.1:11434/api/tags", 1500) : false;
  const online = await ping("https://api.github.com/zen", 2500).catch(() => false);
  let vaultWritable = true;
  try { const { writeFileSync, unlinkSync } = await import("node:fs"); const p = join(process.env.VAULT_DIR || join(REPO_ROOT, "vault"), ".doctor-probe"); writeFileSync(p, "ok"); unlinkSync(p); } catch { vaultWritable = false; }
  res.json(runDoctor({ hasCloudKeys, ollamaConfigured, ollamaReachable, online, vaultWritable, platform: process.platform, ramGb: os.totalmem() / 1024 ** 3 }));
});

// ── Billing (v2.0) — OFF by default. NEVER gates core (coreGated is always false). ──
app.get("/api/billing", (_req, res) => res.json(billingStatus()));
app.post("/api/billing/checkout", (req, res) => res.json(billingCheckout(String(req.body?.plan || "") as Plan)));

// ── Preference memory (v1.8) — "What SAM has learned about you". Local, inspectable, deletable.
// Nothing here is ever transmitted (see preferences.ts privacy invariant). Learning is OFF unless the
// user enabled the "learn-preferences" consent behaviour.
app.get("/api/preferences", (_req, res) => res.json({ preferences: listPreferences(), learning: consentEnabled("learn-preferences") }));
app.post("/api/preferences/learn", (req, res) => {
  if (!consentEnabled("learn-preferences")) return res.json({ learned: false, reason: "learning is off — enable it in “What can SAM do on its own?”" });
  const { key, value } = req.body || {};
  if (!key || value == null) return res.status(400).json({ error: "key + value required" });
  res.json({ learned: true, preference: learnPreference(String(key), String(value), new Date().toISOString()) });
});
app.post("/api/preferences/forget", (req, res) => res.json({ ok: forgetPreference(String(req.body?.key || "")) }));
app.post("/api/preferences/reset", (_req, res) => { resetPreferences(); res.json({ ok: true }); });

registerPeopleRoutes(app, PORT);


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
    const restricted = !!(req as any).remoteScope && (req as any).remoteScope !== "full";   // scoped remote token ⇒ dangerous tools never auto-run
    const text = await run(message, (process.env.DEFAULT_TIER as Tier) || "free", system, send, restricted);
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

registerStudioRoutes(app);

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
  catch (e: any) { res.status(500).json({ error: publicError(e) }); }
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

// ── THE SAFE — encrypted secret store (setup / unlock / migrate / lock / status). isTrustedLocal:
// loopback + the Handshake (crown jewels — stricter than encryption's loopback-only). NO secret VALUE
// ever appears in a response — names + counts only. Errors surface the typed reason, never a value.
const safeGate = (req: express.Request, res: express.Response): boolean => {
  if (isTrustedLocal(req)) return true;
  res.status(403).json({ error: "the Safe is loopback + Handshake only" });
  return false;
};
app.get("/api/safe/status", (req, res) => {
  if (!safeGate(req, res)) return;
  res.json(safeStatus());
});
app.get("/api/safe/migrate/preview", (req, res) => {
  if (!safeGate(req, res)) return;
  const names = migratableNames();                      // present-in-env secret NAMES only — never values
  res.json({ names, count: names.length, total: secretNames().length });
});
app.post("/api/safe/setup", (req, res) => {
  if (!safeGate(req, res)) return;
  const { passphrase, useKeychain } = (req.body ?? {}) as { passphrase?: string; useKeychain?: boolean };
  const r = safeSetup({ passphrase: passphrase ? String(passphrase) : undefined, useKeychain: useKeychain !== false });
  res.json(r.ok ? { ok: true, ...r.value } : { ok: false, error: r.error.kind });
});
app.post("/api/safe/unlock", (req, res) => {
  if (!safeGate(req, res)) return;
  const pass = (req.body as { passphrase?: string })?.passphrase;
  const r = safeUnlock(pass ? String(pass) : undefined);
  if (!r.ok) return res.json({ ok: false, error: r.error.kind });
  // Same as the boot path: bridge tool creds, then rebuild the key pools from the now-unlocked Safe —
  // a passphrase-mode Safe unlocked HERE (not at boot) must still repopulate the pools, or a migrated
  // user would have no cloud brains until restart.
  const loaded = safeLoadEnv();
  const pooled = reloadPools();
  res.json({ ok: true, mode: r.value, loaded, pooled });
});
app.post("/api/safe/migrate", (req, res) => {
  if (!safeGate(req, res)) return;
  const r = safeMigrate(secretNames());
  if (r.ok) return res.json({ ok: true, ...r.value });
  res.json({ ok: false, error: r.error.kind, ...(r.error.kind === "verify-failed" ? { secret: r.error.secret } : {}) });
});
app.post("/api/safe/lock", (req, res) => {
  if (!safeGate(req, res)) return;
  safeLock(); res.json({ ok: true });
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
  // Source install: git-based check (git pull updates it). We show the real version number
  // ("SAM 2.2.0") — never a bare git SHA, which tells the user nothing about what they're running.
  try {
    const local = await git("rev-parse HEAD");
    const remote = (await git("ls-remote origin HEAD")).split(/\s+/)[0] || "";
    res.json(sourceUpdateStatus(SAM_VERSION, local, remote));
  } catch { res.json({ behind: false, current: SAM_VERSION || undefined }); }   // no git/remote → still report the version
});
app.post("/api/update", async (_req, res) => {
  try {
    // Refuse gracefully on a dirty tree — never silently overwrite the user's local edits.
    const dirty = (await git("status --porcelain")).trim();
    if (dirty) return res.json({ ok: false, dirty: true, error: "You have unsaved local changes — SAM won't overwrite them. Commit or stash them first (`git stash`), then hit Update again." });
    const output = (await git("pull --ff-only", 45000)).slice(0, 400);
    res.json({ ok: true, output });
  } catch (e: any) {
    res.json({ ok: false, error: friendlyUpdateError(e?.stderr || e?.message || e) });
  }
});
// The Console — a self-contained local status page (the Pulse + the Black Box). Loopback + the
// Handshake (when enforced): the metrics are on-device diagnostics, never exposed to the network.
app.get("/api/console", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "the Console is loopback + Handshake only" }); return; }
  const samples = samplesOf("brain.latency_ms", { tier: "free" });
  const s = samples.length ? samples : samplesOf("brain.latency_ms", { tier: "local" });
  res.type("html").send(renderConsole(snapshot(), listIssues(), s, new Date().toISOString(), { enabled: knackEnabled(), recent: recentInfluences() }, openAsks()));
});

// The Ask — the still-open out-of-band approval requests (loopback + Handshake, like the Console).
app.get("/api/asks", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  res.json({ asks: openAsks() });
});

// Approve or decline an Ask. SAFE by construction: nothing runs unless this fires with approved:true
// on a still-open Ask. A swarm Ask resumes through the swarm's own path; any other runs the parked
// action now (fire-and-forget — the result surfaces via a notification).
app.post("/api/ask/:id", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  const ask = getAsk(req.params.id);
  if (!ask) { res.status(404).json({ error: "no such Ask — it may have expired (deferred)" }); return; }
  const approved = !!req.body?.approved;
  if (ask.swarmRef) {
    void approveAgent(ask.swarmRef.swarmId, ask.swarmRef.agentId, approved).catch(() => {/* resolves the Ask internally */});
    res.json({ status: approved ? "approved" : "denied" }); return;
  }
  const r = resolveAsk(req.params.id, approved);
  if (r?.action) {
    const system = buildSystem("", undefined, { name: process.env.SAM_USER_NAME || "there", mode: "business" }, "");
    void resumeAgent(system, r.action.transcript, r.action.tier as Tier, true, r.action.tool, r.action.input, r.action.trace)
      .then((rr) => { if (rr.kind === "final" && rr.text) { desktopNotify("SAM — approved action done", rr.text); void pushNotify("SAM", rr.text); } })
      .catch(() => {/* approved action failed; surfaced via notification only */});
  }
  res.json({ status: r?.ask.status ?? "gone" });
});

// FLIP IT — surface the sibling £5 trading rig's live state inside SAM (read-only, loopback only).
// Reads ~/flip-it/state|ledger; absent (most users) ⇒ { present: false } and the pane shows a hint.
app.get("/api/flipit", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  const d = flipitDesk();
  if (!d.present) { res.json({ present: false, schema: 2 }); return; }
  // schema 2 payload, plus the flat fields the desk shipped before it grew a read model —
  // kept so an older pane keeps rendering while the new one lands.
  res.json({
    ...d,
    equity: d.now!.equity, rung: d.now!.rung, hwm: d.now!.hwm,
    seeded: d.now!.seeded, status: d.now!.status,
    days: d.now!.days, trades: d.now!.trades, target: d.now!.target, tradeTarget: d.now!.tradeTarget,
  });
});

// THE YARD — long-running build jobs.
//
// The gate is split by what an action can DO, not by which feature it belongs to.
// READING the queue is no more sensitive than any other panel in SAM, so it sits at the
// same bar as the rest of them — which is what lets the ops tile work in a browser tab
// as well as the desktop app. Handing the passkey to a browser instead would have made
// the gate worthless, since any local process could then ask for it too.
//
// WRITING is different: creating a job runs commands on this machine. Those routes hold
// the passkey unconditionally, whatever the global setting is.
app.get("/api/yard", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  if (process.env.SAM_YARD !== "1") { res.json({ on: false }); return; }
  const store = yardStore();
  store.reapAbandoned();
  res.json({ on: true, worker: supervisor.status(), ...store.summary(), recent: store.list(undefined, 20) });
});
app.get("/api/yard/job/:id", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  const job = yardStore().get(String(req.params.id));
  if (!job) { res.status(404).json({ error: "no such job" }); return; }
  res.json({ job, log: job.logPath ? new JobLog(job.logPath).tail(60) : [] });
});
app.post("/api/yard/enqueue", (req, res) => {
  if (!isYardTrusted(req)) { res.status(403).json({ error: "this browser is not paired with the yard — pair it from the SAM app to start and stop work here" }); return; }
  if (process.env.SAM_YARD !== "1") { res.status(409).json({ error: "the yard is off" }); return; }
  const { kind, payload, budget, project } = req.body || {};
  if (!kind || typeof kind !== "string") { res.status(400).json({ error: "a job needs a kind" }); return; }
  res.json({ job: yardStore().enqueue(kind, payload ?? {}, { budget: budget ?? null, project: project ?? null }) });
});
app.post("/api/yard/cancel", (req, res) => {
  if (!isYardTrusted(req)) { res.status(403).json({ error: "this browser is not paired with the yard — pair it from the SAM app to start and stop work here" }); return; }
  try { res.json({ job: yardStore().cancel(String(req.body?.id || "")) }); }
  catch (e: any) { res.status(404).json({ error: e?.message || "no such job" }); }
});
app.post("/api/yard/retry", (req, res) => {
  if (!isYardTrusted(req)) { res.status(403).json({ error: "this browser is not paired with the yard — pair it from the SAM app to start and stop work here" }); return; }
  const job = yardStore().retry(String(req.body?.id || ""));
  job ? res.json({ job }) : res.status(409).json({ error: "that job can't be retried — a budget stop or a cancel is a decision, not a fault" });
});

// ── What the yard has built ─────────────────────────────────────────────────
// Reading, so the same bar as every other panel — this is what lets the builder view
// work in a browser tab alongside the desktop app.
app.get("/api/yard/projects", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  res.json({ projects: listProjects(), root: projectsRoot() });
});
app.get("/api/yard/projects/:slug", async (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  const slug = String(req.params.slug);
  const manifest = readManifest(slug);
  if (!manifest) { res.status(404).json({ error: "no such project" }); return; }
  const history = await checkpoints(slug, 30, { handshake: true }).catch(() => []);
  res.json({ manifest, checkpoints: history, files: yardProjectFiles(slug), path: projectPath(slug) });
});
app.get("/api/yard/projects/:slug/file", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  const text = readProjectFile(String(req.params.slug), String(req.query?.path || ""));
  text === null ? res.status(404).json({ error: "no such file" }) : res.json({ text });
});

// The preview itself. Under /api like every other route (the house contract, and it is
// right — one place to reason about the surface). An iframe loads it perfectly well, and
// every asset the page pulls in resolves through the same confinement.
// Express 4 wildcard: `*` with the remainder in params[0]. The `*splat` named form is
// Express 5, and on 4 it silently matches nothing — every asset a page asked for 404'd
// while the front page still loaded, which looks like a broken project rather than a
// broken route.
app.get("/api/yard/preview/:slug/*", servePreview);
app.get("/api/yard/preview/:slug", servePreview);
function servePreview(req: any, res: any) {
  if (!isLoopback(req)) { res.status(403).send("loopback only"); return; }
  const rel = String(req.params[0] ?? req.params.splat ?? "");
  const r = resolvePreview(String(req.params.slug), rel);
  if (!r.ok) { res.status(r.status).send(r.reason); return; }
  res.type(r.type);
  // A preview is a working copy, not a published site: never let a browser cache it, or
  // an edit you just made appears not to have happened.
  res.setHeader("Cache-Control", "no-store");

  // SAM refuses to be framed anywhere (clickjacking), which also stopped it framing its
  // OWN preview. Relaxed to same-origin here, and ONLY here.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  // The important half. This page was written by a model and is served from SAM's own
  // origin, so on its own it could call SAM's API with the browser's full authority. The
  // CSP `sandbox` directive puts the document in an opaque origin whatever loads it —
  // framed or opened directly — so it can render and run its own scripts and reach
  // nothing of SAM's. Relying on the iframe's sandbox attribute alone would protect the
  // framed case and leave the direct one wide open.
  res.setHeader(
    "Content-Security-Policy",
    "sandbox allow-scripts; default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'none'; frame-ancestors 'self'",
  );
  res.send(readFileSync(r.path));
}

// ── Pairing a browser ───────────────────────────────────────────────────────
// Asking is unprivileged on purpose: a request is inert until a person holding the
// passkey approves the exact code the browser is showing them.
// Whether this browser needs to pair at all. Deliberately NOT passkey-gated: a browser
// that cannot answer this question cannot discover that pairing is what it needs, and a
// lock whose key is hidden behind the lock is just a wall. It reveals only whether the
// gate is on and whether THIS caller is already through it — both of which a caller
// learns anyway from the next 403.
app.get("/api/pair/status", (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "loopback only" }); return; }
  const paired = checkPasskey(req) || !!verifyPairToken(req.headers?.["x-sam-pair"]);
  res.json({ enforced: handshakeEnforced(), paired, needed: handshakeEnforced() && !paired });
});

app.post("/api/yard/pair/request", (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "loopback only" }); return; }
  const r = requestPairing(String(req.body?.label || "a browser"));
  if (!r) { res.status(429).json({ error: "too many pairing requests are already waiting — approve or dismiss one first" }); return; }
  res.json({ id: r.id, code: r.code });
});
// The browser waits for its OWN request. It learns nothing about anyone else's.
app.get("/api/yard/pair/collect", (req, res) => {
  if (!isLoopback(req)) { res.status(403).json({ error: "loopback only" }); return; }
  const token = collect(String(req.query?.id || ""));
  res.json({ token });
});
// Everything below needs the passkey: this is the approval itself.
app.get("/api/yard/pair/pending", (req, res) => {
  if (!isLoopback(req) || !checkPasskey(req)) { res.status(403).json({ error: "the desktop app approves pairing" }); return; }
  res.json({ pending: pendingRequests(), paired: pairedBrowsers() });
});
app.post("/api/yard/pair/approve", (req, res) => {
  if (!isLoopback(req) || !checkPasskey(req)) { res.status(403).json({ error: "the desktop app approves pairing" }); return; }
  const a = approvePairing(String(req.body?.id || ""), String(req.body?.code || ""));
  if (!a) { res.status(400).json({ error: "that code does not match the request — check the number the browser is showing" }); return; }
  stashForCollection(a.browser.id, a.token);   // the waiting browser collects it, once
  logSecurity("info", "yard-browser-paired", `Paired "${a.browser.label}" for yard writes`, "");
  res.json({ browser: a.browser });
});
app.post("/api/yard/pair/deny", (req, res) => {
  if (!isLoopback(req) || !checkPasskey(req)) { res.status(403).json({ error: "the desktop app approves pairing" }); return; }
  res.json({ ok: denyPairing(String(req.body?.id || "")) });
});
app.post("/api/yard/pair/revoke", (req, res) => {
  if (!isLoopback(req) || !checkPasskey(req)) { res.status(403).json({ error: "the desktop app approves pairing" }); return; }
  const ok = revokePairing(String(req.body?.id || ""));
  if (ok) logSecurity("info", "yard-browser-unpaired", "A paired browser was revoked", "");
  res.json({ ok });
});

// The Standing Crew — arm/disarm/list background specialists (loopback + Handshake; privileged control).
app.get("/api/standing", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  res.json({ list: standingList(), on: standingEnabled() });
});
app.post("/api/standing/arm", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  const { specialistId, task, cron } = req.body || {};
  try { res.json({ agent: standingArm(specialistId, task, cron) }); }
  catch (e: any) { res.status(400).json({ error: e?.message || "couldn't arm that agent" }); }
});
app.post("/api/standing/disarm", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  const a = standingDisarm(req.body?.id); a ? res.json({ agent: a }) : res.status(404).json({ error: "no such standing agent" });
});
app.post("/api/standing/rearm", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  const a = standingRearm(req.body?.id); a ? res.json({ agent: a }) : res.status(404).json({ error: "no such standing agent" });
});
app.post("/api/standing/remove", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  standingRemove(req.body?.id) ? res.json({ ok: true }) : res.status(404).json({ error: "no such standing agent" });
});

// The Chime — alarms + named timers (the store always works; ringing is gated by SAM_CHIME).
app.get("/api/chimes", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  res.json({ chimes: listChimes() });
});
app.post("/api/chime", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  const { kind, label, afterMs, at, recur } = req.body || {};
  try {
    const c = kind === "timer" ? chimeTimer(label, Number(afterMs)) : chimeAlarm(label, { at, recur });
    res.json({ chime: c });
  } catch (e: any) { res.status(400).json({ error: e?.message || "couldn't set that" }); }
});
app.post("/api/chime/cancel", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  cancelChime(req.body?.id) ? res.json({ ok: true }) : res.status(404).json({ error: "no such chime" });
});
app.post("/api/chime/snooze", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  try { const c = snoozeChime(req.body?.id, Number(req.body?.ms) || 540000); c ? res.json({ chime: c }) : res.status(404).json({ error: "no such chime" }); }
  catch (e: any) { res.status(400).json({ error: e?.message || "couldn't snooze" }); }
});

// Routines — spoken triggers bound to saved workflows (the module gates matching on SAM_ROUTINES).
app.get("/api/routines", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  res.json({ routines: routineList() });
});
app.post("/api/routines/bind", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  const r = routineBind(req.body?.workflowId, req.body?.phrases || []);
  r?.ok === false ? res.status(400).json({ error: r.reason }) : res.json(r ?? { ok: true });
});
app.post("/api/routines/unbind", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback only" }); return; }
  routineUnbind(req.body?.workflowId); res.json({ ok: true });
});

// The Watch — local-only cameras. Crown-jewel routes: loopback + Handshake only. Double-gated
// (SAM_CAMERAS flag + "cameras" consent) before anything can be added; listing reports the gate state
// so the UI can guide the user. cameras.ts enforces the local-only url guard — no public host ever.
function camerasReady(): { ok: boolean; why?: string } {
  if (!camerasEnabled()) return { ok: false, why: "Cameras are off — set SAM_CAMERAS=1 to enable the feature." };
  if (!consentEnabled("cameras")) return { ok: false, why: "Turn on “Cameras (local only)” in what SAM can do on its own." };
  return { ok: true };
}
app.get("/api/cameras", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  const gate = camerasReady();
  res.json({ on: gate.ok, why: gate.why, cameras: listCameras() });
});
app.post("/api/cameras", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  const gate = camerasReady();
  if (!gate.ok) { res.status(403).json({ error: gate.why }); return; }
  const r = addCamera({ name: req.body?.name, location: req.body?.location, kind: req.body?.kind, url: req.body?.url });
  r.ok ? res.json({ camera: r.camera }) : res.status(400).json({ error: r.reason });
});
app.post("/api/cameras/remove", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "loopback + Handshake only" }); return; }
  removeCamera(req.body?.id) ? res.json({ ok: true }) : res.status(404).json({ error: "no such camera" });
});

// The Scope — the live view. /api/scope is the compact JSON the page polls every ~1.5s; the view is
// the page itself. Both loopback + the Handshake (when enforced) — live diagnostics, never off-box.
app.get("/api/scope", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "the Scope is loopback + Handshake only" }); return; }
  res.json(scopeData());
});
app.get("/api/scope/view", (req, res) => {
  if (!isTrustedLocal(req)) { res.status(403).json({ error: "the Scope is loopback + Handshake only" }); return; }
  res.type("html").send(renderScope());
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
    issues: issuesSummary(),   // local error capture (the black box) — strictly on-device
    pulse: pulseSummary(),     // runtime metrics — strictly on-device
  })
);
app.get("/api/keys", (_req, res) => res.json(providersStatus()));
// SAM's own free-tier capacity + the single legit key to add next (if any).
app.get("/api/capacity", (_req, res) => res.json({ ...capacityReport(), nudge: capacityNudge() }));

// ── Serve the built app from this one process (production mode) ──
// One server on :8787 — no separate Vite dev server. Leaner + faster.
// join(dirname(fileURLToPath(import.meta.url)), …) — NOT `new URL("…", import.meta.url)`: vite rewrites
// that two-arg form to an http dev-server asset URL, which fileURLToPath rejects → blank electron in dev.
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist"); // decodes spaces in the install path
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
  // THE YARD — long work runs in its own process so a build can never make chat or voice
  // wait. Flag-gated OFF: nothing about SAM changes until it is switched on deliberately.
  if (process.env.SAM_YARD === "1") {
    yardStore().reapAbandoned();   // anything left `running` by a previous life fails honestly
    console.log(supervisor.start() ? "  the yard      · worker starting" : "  the yard      · no worker entrypoint — staying down");
    // Take the worker down with us. Without this the child is reparented to init and
    // keeps running: one orphan per restart, each still claiming jobs.
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      process.on(sig, () => { supervisor.stop(); process.exit(0); });
    }
    process.on("exit", () => supervisor.stop());
  }
  // Opt-in aggregate heartbeat (v2.0). Fire-and-forget, both-gates-closed by default: sends only if the
  // user opted in AND a TELEMETRY_ENDPOINT is configured. Undeployed builds return "no-endpoint" ⇒ inert.
  void postTelemetry(getAnalytics(), process.env.SAM_APP_VERSION || "dev", process.platform, new Date().toISOString())
    .then((r) => { if (r === "sent" || r === "failed") console.log(`  telemetry heartbeat · ${r}`); });
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
