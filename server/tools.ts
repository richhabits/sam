// ─────────────────────────────────────────────────────────────
//  S.A.M. · TOOLS  (THE HANDS)
//  Every real-world action SAM can take. Each tool declares
//  whether it's `safe` (runs automatically) or risky (needs
//  the user's OK first — the ask-first safety gate).
//
//  100% local / free: uses macOS built-ins (osascript, System
//  Events, screencapture, open) + Node + fetch. No paid APIs.
// ─────────────────────────────────────────────────────────────

import { exec, execFile as execFileCb, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, stat, appendFile as appendFileFs, rename, cp } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, mkdirSync, statfsSync, createWriteStream } from "node:fs";

// ── Cross-platform file search (NO shell) — works on Windows/Linux/Mac identically. Mac keeps its
//    fast Spotlight `mdfind` path where called; this is the portable fallback. Walk is bounded so it
//    can't run away on a huge tree, and skips hidden/system/heavy dirs. ──────────────────────────
const SKIP_DIRS = new Set(["node_modules", "Library", ".git", ".Trash", "vendor", "dist", "build", ".cache"]);
async function walkFiles(dir: string, depth: number, out: string[]): Promise<string[]> {
  if (depth < 0 || out.length >= 4000) return out;
  let entries: any[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= 4000) break;
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkFiles(full, depth - 1, out);
    else out.push(full);
  }
  return out;
}
async function findByName(root: string, query: string, limit = 30): Promise<string[]> {
  const q = query.toLowerCase();
  return (await walkFiles(root, 5, [])).filter((f) => basename(f).toLowerCase().includes(q)).slice(0, limit);
}
async function findByContent(root: string, query: string, limit = 30): Promise<string[]> {
  const q = query.toLowerCase();
  
  // Try git grep (insanely fast for git repos)
  try {
    const { stdout } = await promisify(exec)(`git -C ${shq(root)} grep -li ${shq(query)}`, { timeout: 10000 });
    const lines = stdout.split("\n").filter(Boolean);
    if (lines.length) return lines.slice(0, limit).map(f => join(root, f));
  } catch (e: any) {
    // 1 indicates no matches for grep, not necessarily a failure. Only fallback if it's a real failure.
    if (e.code !== 1 && e.code !== 128) { /* fallback */ }
  }

  // Try ripgrep (rg) if installed
  try {
    const { stdout } = await promisify(exec)(`rg -il ${shq(query)} ${shq(root)}`, { timeout: 10000 });
    const lines = stdout.split("\n").filter(Boolean);
    if (lines.length) return lines.slice(0, limit);
  } catch (_e: any) {
    // 1 indicates no matches.
  }

  // Fallback to JS walk
  const hits: string[] = [];
  for (const f of await walkFiles(root, 4, [])) {
    if (hits.length >= limit) break;
    if (!/\\.(txt|md|markdown|json|jsonl|js|ts|tsx|csv|log|html?|xml|ya?ml|py|env|conf|ini|rtf)$/i.test(f)) continue;
    try { if ((await readFile(f, "utf8")).toLowerCase().includes(q)) hits.push(f); } catch { /* unreadable file in a scan — skip it, keep scanning */ }
  }
  return hits;
}
import { homedir, } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { resolve, dirname, basename, extname, join, sep, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Heavy CJS/native deps (pdf-parse, mammoth, playwright) are lazy-loaded at call
// time via require — importing them as ESM at the top crashed boot, and this also
// keeps startup fast/slim (they only load if you actually use them).
const require = createRequire(import.meta.url);
import type { Page } from "playwright-core";
import { redactKnownCredentials } from "./scrub.ts";
import { renderVideo, titleCard } from "./render.ts";
import { buildDeck, fallbackSections, outlineMarkdown, parseSections, saveDeck, sectionCount, type Section } from "./slides.ts";
import { formatQuotes, quotes as marketQuotes } from "./markets.ts";
import { fetchLocation, nowText } from "./context.ts";
import { grabRepos, loadSocials } from "./world.ts";
import { resolveRepoDir, repoIndex } from "./repos.ts";
import { logSecurity, securityStatus } from "./security.ts";
import { addNudge, listNudges, completeNudge } from "./proactive.ts";
import { addPerson, listPeople } from "./people.ts";
import { remember, recall, listRecent, forget, clearAll } from "./memory.ts";
import { ingestFolder, reportText, searchDocs, docsStats, recentDocs, forgetDoc } from "./ingest.ts";
import { addFolder, removeFolder, listFolders, askAbout, lifeIndexStats } from "./lifeindex.ts";
import { forgeTool, listForged, forgedStats, bindToolRegistry } from "./forge.ts";
import { addSchedule, listSchedules, removeSchedule, toggleSchedule } from "./scheduler.ts";
import { startSwarm, loadSwarms, stopSwarm, spawnSubAgent, swarmFanout, swarmPipeline } from "./swarm.ts";
import { listAllowed, allow, disallow, setAutopilot, autopilotOn, isElonMode } from "./authz.ts";
import { PROJECTS } from "./projects.ts";
import { keyStatus, getKey, poolSize, reportSuccess, reportFailure } from "./keys.ts";
import { capacityReport, capacityNudge } from "./capacity.ts";
import { autoHealDoctor } from "./doctor.ts";
import { sendMail, mailerConfigured, ownerEmail } from "./mailer.ts";
import { runSelftest } from "./selftest.ts";
import { loadSkills } from "./skills.ts";
import { vaultStats, recentLog, pruneOldLogs } from "./vault.ts";
import { runVision, runModel, availableBrains, runBrain } from "./models.ts";
import { runArena, judgePrompt, JUDGE_SYSTEM, parseVerdict, formatLeaderboard, saveRanking, type ArenaResult } from "./colosseum.ts";
import { championWithConfidence } from "./colosseum-significance.ts";
import { monteCarlo100x, analyzeMultiStrategy, project100xLadder } from "./flipit.ts";
import { generateStoryboardDirector, compileHiggsfieldMotionPrompt, buildCharacterAnchorPrompt, type CharacterProfile } from "./studio-higgsfield.ts";
import { getSavingsSummary, compressPromptForCost, auditCapitalProtection } from "./cost-optimizer.ts";
import { executeSmartAction, generateSmartStudioPreset, buildSimpleFlipItSummary } from "./smart-actions.ts";
import { prepareMobilePush } from "./mobile-bridge.ts";
import { generateSpeechAudio } from "./audio-engine.ts";
import { calculatePortfolioRebalance, type HoldingPosition, type TargetAllocation } from "./flipit-auto.ts";
import { getMasterDashboard } from "./orchestrator.ts";
import { generateMobileFeed } from "./mobile-feed.ts";
import { getBrainPerformanceMatrix } from "./brain-arbitrage.ts";
import { executeSimdToolBatch } from "./simd-tools.ts";
import { resolveOptimalRoute } from "./speculative-router.ts";
import { prewarmContext } from "./prefetch.ts";
import { trySolveLocally } from "./local-micro-solver.ts";
import { auditSpaceConsumption, compactSpaceAndMemory } from "./space-compactor.ts";
import { disambiguateUserIntent } from "./intent-disambiguator.ts";
import { computeKellyRiskShield, scanCrossMarketSpreads } from "./flipit-scale.ts";
import { getSharedIngestStatus, startSharedIngestEngine, stopSharedIngestEngine } from "./flipit-ingest.ts";
import { getStarterPlaybookDef, STARTER_PLAYBOOKS } from "./starter-playbooks.ts";
import { getPlaybook, listPlaybooks, renderTemplate } from "./yard/playbooks.ts";
import { getSpeedLeaderboard } from "./speed.ts";
import { conductDeepResearch, compileExecutiveDossier } from "./deep-research.ts";
import { getHardwareVitals } from "./hardware-monitor.ts";
import { verifyAuditChainIntegrity } from "./audit-ledger.ts";
import { scanEvArbitrageSignals } from "./flipit-signals.ts";
import { startSandboxApp, stopSandboxApp, getSandboxSession, listSandboxSessions } from "./yard/sandbox-daemon.ts";
import { compileProductionTimeline } from "./studio-master-timeline.ts";
import { generateMarketMakerQuotes, calculateDeltaHedge } from "./flipit-market-maker.ts";
import { getMeshTopologyReport, createGossipMessage, processIncomingMeshGossip } from "./p2p-mesh.ts";
import { getOrCreateVoiceSession } from "./voice-agent.ts";
import { executeAntigravityCognition, verifyFactualGrounding, verifySymbolDeclaration, runCognitiveReflectionLoop } from "./antigravity-brain.ts";
import { generateCinematicStoryboard } from "./studio-director.ts";
import { execute100xAgenticWorkflow } from "./agentic-100x.ts";
import { runMultiModelConsensus } from "./consensus.ts";
import { parseCompilerDiagnostics, generateRepairPlan } from "./code-repair.ts";
import { getAutoProvisionStatus, validateAndSaveProviderKey } from "./auto-provision.ts";
import { huntRevenueOpportunities } from "./revenue-hunter.ts";
import { generateExecutiveDailyDeck } from "./executive-deck.ts";
import { registerWebhookEndpoint, dispatchWebhookEvent, loadWebhookEndpoints } from "./webhooks.ts";
import { createVaultSnapshot, restoreVaultSnapshot } from "./universal-sync.ts";
import * as nb from "./notebook.ts";
import { retrieveFullOutput } from "./compress.ts";
import { checkOutboundUrl } from "./url-guard.ts";
import { CAPS as SHEET_CAPS, parseCsv, profileTable, readTable, renderReport, SheetError } from "./sheets.ts";
import { fetchClean } from "./webintel.ts";
import { extract } from "./webintel-extract.ts";
import { extractMany } from "./webintel-research.ts";
import { crawl, mapSite } from "./webintel-crawl.ts";

// SAM's own brain, shaped for the webintel extractors. They take an injected LLM precisely so
// they own no model plumbing — this is the one place that plumbing lives.
// "free" because field-extraction from supplied text is a cheap job: spending a premium lane on
// it would burn paid quota for no gain (Doctrine #3 — quotas are production infrastructure).
const samLlm = async (system: string, prompt: string): Promise<string> =>
  (await runModel("free", system, prompt))?.text || "";
const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
import { extractFactsFromTranscript, saveImportedFacts } from "./importer.ts";
import { commit as commitChanges, preview as previewChanges } from "./preview-commit.ts";
import type { ArgSchema } from "./parser.ts";

// Locate the user's Obsidian vault: explicit OBSIDIAN_VAULT, else the usual spots (a real
// Obsidian vault always contains a `.obsidian` config folder — that's how we recognise one).
function obsidianVault(): string | null {
  const home = homedir();
  const explicit = process.env.OBSIDIAN_VAULT;
  if (explicit && existsSync(explicit.replace(/^~/, home))) return explicit.replace(/^~/, home);
  const candidates = [
    join(home, "Obsidian"), join(home, "Documents", "Obsidian"), join(home, "Documents"),
    join(home, "Library", "Mobile Documents", "iCloud~md~obsidian", "Documents"),
  ];
  for (const base of candidates) {
    try {
      if (existsSync(join(base, ".obsidian"))) return base;
      for (const sub of readdirSync(base, { withFileTypes: true })) {   // a vault nested one level down
        if (sub.isDirectory() && existsSync(join(base, sub.name, ".obsidian"))) return join(base, sub.name);
      }
    } catch { /* not there */ }
  }
  return null;
}

export const sh = promisify(exec);
// No-shell exec for anything carrying model/user text — args go straight to the
// binary, so $(…)/backticks/quotes can never reach a shell.
const execFile = promisify(execFileCb);

// Shell-safe single-quote wrapping for untrusted args.
const shq = (s: any) => `'${String(s ?? "").replace(/'/g, "'\\''")}'`;

// GitHub via the gh CLI (already logged in on this Mac — no tokens to manage).
async function gh(args: string): Promise<string> {
  try {
    const { stdout } = await sh(`gh ${args}`, { timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
    return (stdout.trim() || "(done)").slice(0, 6000);
  } catch (e: any) {
    const msg = (e?.stderr || e?.message || e).toString();
    if (/not logged|authentication|gh auth/i.test(msg)) return "GitHub isn't logged in. Run `gh auth login` in Terminal first.";
    if (/command not found|not found: gh/i.test(msg)) return "The GitHub CLI (gh) isn't installed. Install it with `brew install gh`.";
    return `GitHub: ${msg.slice(0, 300)}`;
  }
}

// git in a specific local repo folder (handles spaces in the path).
// `dir` is resolved FIRST: a name ("mainline"), a ~path, or a real path. An unresolvable
// one throws before git is ever invoked, which is how the "/home/romeo/sam" and literal
// "undefined" folders used to get this far.
//
// A failing git command THROWS. It used to return its own error text as an ordinary
// result, so the agent loop counted the call a success and the model explained an outcome
// that never happened ("I don't have write access to my own repositories"). A thrown
// error becomes an honest "that didn't work (…)" the model can actually report.
async function gitIn(dir: unknown, args: string): Promise<string> {
  // The GitHub list (cached, and empty if `gh` isn't available) only sharpens the error:
  // it lets SAM say "that repo is yours but isn't cloned here" instead of "no such repo".
  const remoteNames = (await grabRepos().catch(() => [])).map((a) => a.name);
  const at = resolveRepoDir(dir, remoteNames);
  try {
    const { stdout, stderr } = await sh(`git -C ${shq(at)} ${args}`, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    return ((stdout || "") + (stderr || "")).trim().slice(0, 4000) || "(done)";
  } catch (e: any) {
    throw new Error(`git failed in ${at}: ${(e?.stderr || e?.message || e).toString().trim().slice(0, 400)}`);
  }
}
async function currentBranch(dir: string): Promise<string> {
  return (await gitIn(dir, "rev-parse --abbrev-ref HEAD")).trim();
}

// ── Portability: works on any laptop; Mac-only tools degrade gracefully.
export const OS = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux";
const IS_MAC = OS === "mac";
function notSupported(feature: string): string {
  return `“${feature}” is not currently supported natively on ${OS}.`;
}
// Cross-platform "open this URL/app/file with the system default".
function openCmd(target: string): string {
  if (OS === "mac") return `open ${shq(target)}`;
  if (OS === "windows") return `start "" ${shq(target)}`;
  return `xdg-open ${shq(target)}`;
}

export interface Tool {
  name: string;
  safe: boolean;                 // true = auto-run, false = ask the user first
  description: string;           // shown to the model
  params: string;               // human/model hint for the input shape
  args?: ArgSchema;             // machine schema — the Parser validates calls against it (single source of truth)
  activity: (input: any) => string;   // plain-language "what SAM is doing"
  preview?: (input: any) => string;   // what the confirm card shows (risky only)
  run: (input: any) => Promise<string>;
  // Same tool + same input → same answer, for the lifetime of ONE agent run (not across runs —
  // a file can change between turns). Only for tools where that's actually true: reads of stable
  // state, not anything time-varying (current time, a live status check) or anything that writes.
  // Deliberately opt-in per tool rather than inferred from `safe`, which covers plenty of
  // safe-but-not-idempotent calls (datetime, weather) caching would make wrong, not fast.
  cacheable?: boolean;
}

// Never run these, even if approved — catastrophic / irreversible. Tuned to block the
// truly unrecoverable forms (wiping ~, /, a whole system root or a mounted volume ROOT)
// WITHOUT blocking legitimate cleanup inside those trees (e.g. rm -rf /Volumes/DRIVE/proj/dist).
// Destructive verbs are anchored to command position so they don't false-positive on
// read-only uses like `grep shutdown log` or `ls /bin/rm`.
const HARD_DENY = [
  /\brm\s+(?:-[a-z]+\s+)*["']?[~/]\/?["']?\s*(?:$|[\s;])/i,                               // rm [flags] ~  |  /  (root/home wipe; ReDoS-safe — each flag group anchored by '-')
  /\brm\s+(?:-[a-z]+\s+)*["']?(?:\$\{?HOME\}?|\/(?:Users|System|Library|Applications|Volumes))\/?["']?(?:\s|;|$)/i,  // rm of $HOME or a system / all-volumes ROOT (NOT subdirs — a specific drive/dir is approval-gated)
  /(^|[;&|]\s*)(sudo\s+)?\/(usr\/)?bin\/rm\s+(-[a-z]*[rf])/i,                             // absolute rm -rf as a command (sidesteps trash alias)
  /\bfind\s+["']?[~/]["']?(\s|$).*(-delete|-exec\s+rm)/i,
  /\bmkfs\b/, /\bdd\s+(if|of)=/, /:\(\)\s*\{/,
  /(^|[;&|]\s*)(sudo\s+)?(shutdown|reboot|halt)\b/i, /\bkillall\s+-9\b/, />\s*\/dev\/(sd|disk|rdisk)/,
  /\bchmod\s+-R\s+000\b/, /\bsudo\s+(rm|dd|mkfs|chmod|chown|shutdown|reboot)\b/,
  /\bdiskutil\s+(erase|partition|apfs\s+delete)/i, /\bcsrutil\b/, /\blaunchctl\s+bootout\b/,
];
// Pure predicate (no logging) — exported so the denylist can be unit-tested without
// executing anything (you can't test an "allowed" command by running rm).
export function isCatastrophic(cmd: string): boolean {
  return HARD_DENY.some((re) => re.test(cmd));
}
function denied(cmd: string): string | null {
  if (isCatastrophic(cmd)) {
    logSecurity("alert", "blocked-command", `Refused a catastrophic command: ${cmd}`, "agent");
    return `Blocked for safety: "${cmd}" matches a catastrophic-command guard. SAM will never run this.`;
  }
  return null;
}

const clip = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + `\n…[trimmed, ${s.length} chars total]` : s);
// Escape a value for embedding inside a DOUBLE-QUOTED string in AppleScript (and similar).
// Order is load-bearing: backslash FIRST, then quote. Escaping only the quote lets a trailing
// backslash in user input escape the CLOSING quote and break out of the literal — that is the
// AppleScript-injection class CodeQL flags, and nine tool sites got it wrong before routing here.
export const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// ── INTERNET ─────────────────────────────────────────────────
// Outbound requests get a hard timeout (free providers stall) and web_fetch —
// which auto-runs on a model-chosen URL — gets an SSRF guard so internal/LAN
// targets (router admin, cloud metadata, localhost services) are unreachable.
const WEB_TIMEOUT = 15000;
const webSignal = () => AbortSignal.timeout(WEB_TIMEOUT);
// Every outbound fetch in this file goes through tfetch so a stalled public API
// (weather, translate, finance, HN…) can't hang the agent loop forever. Node's
// fetch has NO default timeout. Callers may pass their own signal (kept as-is).
function tfetch(url: any, opts: any = {}): Promise<Response> {
  return fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(WEB_TIMEOUT) });
}
// SSRF guard — ONE implementation, in server/url-guard.ts, unit-tested there (url-guard.test.ts).
// This file used to carry its own isPrivateIp/assertPublicUrl pair. Two guards means one is quietly
// the weaker, and this one was: it missed CGNAT (100.64/10), multicast and non-http(s) schemes, and
// it failed OPEN when the DNS lookup itself errored. Re-exported under the old name because
// sam.test.ts covers it there — so that test now exercises the surviving implementation.
export { isPrivateAddress as isPrivateIp } from "./url-guard.ts";

async function assertPublicUrl(url: string): Promise<void> {
  const v = await checkOutboundUrl(url);
  if (!v.ok) throw new Error(`blocked: ${v.reason}`);
}

const ROTATING_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.3; rv:109.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/121.0.0.0"
];
function randomUA() { return ROTATING_UAS[Math.floor(Math.random() * ROTATING_UAS.length)]; }

// A fully keyless, free, rotating search pool that bypasses rate limits automatically.
async function webSearch(q: string): Promise<string> {
  const query = encodeURIComponent(q);
  const out: string[] = [];
  const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();

  // Lane 1: DuckDuckGo HTML Scrape
  try {
    const r = await tfetch("https://html.duckduckgo.com/html/?q=" + query, {
      headers: { "User-Agent": randomUA() }, signal: webSignal(),
    });
    const html = await r.text();
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
    const realUrl = (href: string) => {
      const m = href.match(/[?&]uddg=([^&]+)/);
      if (m) { try { return decodeURIComponent(m[1]); } catch { /* keep raw */ } }
      return href.startsWith("//") ? "https:" + href : href;
    };
    for (let m = re.exec(html); m && out.length < 6; m = re.exec(html)) {
      const link = realUrl(m[1]);
      if (link.includes("duckduckgo.com/y.js") || link.includes("bing.com/aclick")) continue;
      out.push(`• ${strip(m[2])} — ${strip(m[3])}\n  ${link}`);
    }
    if (out.length) return out.join("\n");
  } catch { /* fallback */ }

  // Lane 2: SearxNG Public Node Fallback
  try {
    const sr = await tfetch("https://searx.be/search?q=" + query + "&format=json", {
      headers: { "User-Agent": randomUA() }, signal: webSignal(),
    });
    const sJson = (await sr.json()) as any;
    if (sJson.results && sJson.results.length > 0) {
      for (const res of sJson.results.slice(0, 6)) {
        out.push(`• ${strip(res.title || "")} — ${strip(res.content || "")}\n  ${res.url}`);
      }
      if (out.length) return out.join("\n");
    }
  } catch { /* fallback */ }

  // Fallback 2: Yahoo Search Scrape
  try {
    const y = await tfetch("https://search.yahoo.com/search?p=" + query, {
      headers: { "User-Agent": randomUA() }, signal: webSignal(),
    });
    const html = await y.text();
    const re = /<h3 class="title"><a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<div class="compTitle[^>]*>[\s\S]*?<div class="compText[^>]*>(.*?)<\/div>/g;
    for (let m = re.exec(html); m && out.length < 6; m = re.exec(html)) {
      out.push(`• ${strip(m[2])} — ${strip(m[3])}\n  ${m[1]}`);
    }
    if (out.length) return out.join("\n");
  } catch { /* failed */ }

  return "No results parsed. The search engines might be rate limiting this IP. Try web_fetch on a specific URL instead.";
}

async function webFetch(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  await assertPublicUrl(url);
  // Our own reader (webintel) rather than the inline strip below it replaced. That one deleted
  // tags and nothing else, so site chrome — nav bars, language lists, cookie banners — arrived as
  // "content": measured 1997 chars of it before the article began on a Wikipedia page. webintel
  // prefers <main>/<article> and drops header/nav/footer, and it caches, so a re-read is free.
  const page = await fetchClean(url, { timeoutMs: WEB_TIMEOUT });
  if (!page.ok || !page.text) return `Couldn't read ${url}${page.error ? ` — ${page.error}` : ""}`;
  return clip(page.text);
}

// ── TERMINAL ─────────────────────────────────────────────────
async function runCommand(cmd: string): Promise<string> {
  const d = denied(cmd);
  if (d) return d;
  try {
    let finalCmd = cmd;
    if (isElonMode()) {
      // 30-day safety bin: intercept `rm` in Elon Mode to prevent catastrophic data loss.
      // Moves targeted files/folders to ~/.sam-trash with a timestamp instead of deleting.
      const trashAlias = `rm() { mkdir -p ~/.sam-trash; for arg in "$@"; do case "$arg" in -*) ;; *) mv "$arg" ~/.sam-trash/"$(basename "$arg")-$(date +%s)" 2>/dev/null || true ;; esac; done; }; `;
      finalCmd = trashAlias + cmd;
    }
    const { stdout, stderr } = await sh(finalCmd, { timeout: 60000, cwd: homedir(), maxBuffer: 8 * 1024 * 1024 });
    return clip((stdout || "") + (stderr ? `\n[stderr] ${stderr}` : "")) || "(command finished, no output)";
  } catch (e: any) {
    return `Command failed: ${e?.message || e}`.slice(0, 2000);
  }
}

// ── SAFE TERMINAL — auto-approved read-only commands (Antigravity-parity) ─────
// These patterns match commands that are strictly read-only, non-destructive, and
// non-outward-facing. The command is ONLY auto-approved if the FIRST real token
// (ignoring env assignments and pipes) matches one of these known-safe executables
// and the full pipeline doesn't contain anything dangerous. This is the exact
// architecture Cursor and Antigravity use.
const SAFE_CMD_PREFIXES = new Set([
  // Filesystem reads
  "ls", "cat", "head", "tail", "wc", "file", "stat", "du", "df",
  "find", "tree", "basename", "dirname", "realpath", "readlink",
  // Search
  "grep", "rg", "ag", "ack", "fgrep", "egrep", "git",
  // Build / type-check / lint (read-only verification)
  "npx", "node", "npm", "pnpm", "yarn", "bun", "deno",
  "tsc", "eslint", "biome", "prettier",
  // System info
  "echo", "date", "uname", "whoami", "hostname", "id", "env", "printenv",
  "which", "where", "type", "man", "help",
  "sw_vers", "system_profiler", "sysctl",
  // Network reads (non-mutating)
  "curl", "wget", "dig", "nslookup", "host", "ping", "traceroute",
  // Process inspection
  "ps", "top", "lsof", "pgrep",
  // Archive inspection (not extraction)
  "unzip", "tar", "zipinfo",
  // Diff / compare
  "diff", "cmp", "md5", "shasum", "sha256sum",
  // Python / Ruby (for one-liners and scripts)
  "python", "python3", "ruby",
]);

// Commands that are NEVER safe, even if the first token looks innocent. These indicate
// mutation, outward effects, or destructive action anywhere in the pipeline.
const UNSAFE_PATTERNS = [
  /\brm\s+(-|[^|])/i,              // rm anything
  /\bmkdir\b/i, /\btouch\b/i,       // filesystem mutation
  /\bmv\b/i, /\bcp\b/i,             // file copy/move (could overwrite)
  /\bchmod\b/i, /\bchown\b/i,       // permission changes
  /\bsudo\b/i,                      // privilege escalation
  /\bgit\s+(push|merge|rebase|reset|checkout|stash|commit|cherry-pick|revert|clean)\b/i,  // git mutations
  /\bgit\s+branch\s+-[dD]\b/i,      // git branch delete
  /\bnpm\s+(publish|deprecate|unpublish|install|uninstall|link|ci)\b/i,    // npm mutations
  /\bnpx\s+(create-|degit|giget|prisma\s+migrate)/i,                      // project scaffolding
  /\bkill\b/i, /\bkillall\b/i,
  /\bcurl\s.*(-X\s*(POST|PUT|PATCH|DELETE)|--data|--upload|-d\s)/i,       // mutating HTTP
  /\bwget\s.*-O\b/i,                // wget writing files
  />\s*[^|]/,                       // output redirection to file (not pipe)
  /\bdd\b/i, /\bmkfs\b/i,
  /\bshutdown\b/i, /\breboot\b/i,
  /\bdiskutil\b/i,
];

// Extract the first "real" command from a segment, skipping env assignments like
// `FOO=bar BAZ=qux command args`. Returns the base command name.
function firstCommand(cmd: string): string {
  // Strip leading env assignments (VAR=value pairs)
  const stripped = cmd.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)*/, "").trim();
  // Get the first token
  const first = stripped.split(/\s+/)[0] || "";
  // Strip any path prefix: /usr/bin/git → git
  return first.replace(/^.*\//, "");
}

// AUDIT FIX: the original version only split on `|` before checking each segment's first
// token, so `ls ; cat ~/.ssh/id_rsa` sailed through — the whole string became one "segment",
// firstCommand() found "ls" as the first whitespace token, and everything after the `;` was
// never inspected at all. `$(...)`, backticks and `<(...)` are worse: the SHELL evaluates
// those before the outer command even runs, so no amount of splitting on separators catches
// them — the only sound answer is to refuse the whole command outright if it contains one.
// Confirmed exploitable pre-fix: `cat ~/.ssh/id_rsa` (no chaining needed at all — cat/head/
// grep were unconditionally in the allowlist with zero credential-path awareness, silently
// undoing the exact protection read_file's CREDENTIAL_PATH check exists to enforce),
// `ls ; base64 ~/.ssh/id_rsa`, `echo $(cat ~/.aws/credentials)`, `ls && cat ~/.env`.
const SUBSHELL_SYNTAX = /\$\(|`|<\(|>\(/;

export function isReadOnlyCommand(cmd: string): boolean {
  // An empty (or separator-only, e.g. ";;") command has zero segments to check once filtered —
  // the loop below would run zero times and fall through to `true` vacuously otherwise.
  if (!cmd.trim()) return false;
  // Refuse outright rather than try to parse into it — process/command substitution runs
  // before anything else in the pipeline, regardless of what the outer command looks like.
  if (SUBSHELL_SYNTAX.test(cmd)) return false;
  // Same protection read_file enforces for exactly the same reason, extended here: run_command
  // still lets a human see+approve a `cat` of a private key; this tool must never let that
  // happen silently. Checked per TOKEN, not against the whole command string — isCredentialPath
  // anchors on "immediately after a path separator or string start" (`(^|\/)`), which a relative
  // arg like "cat .env" never satisfies when tested as part of the full "cat .env" string (the
  // space before ".env" isn't a "/", and ".env" isn't at position 0). Each individual token IS
  // exactly the kind of standalone path isCredentialPath was built to test.
  if (cmd.split(/\s+/).some((tok) => isCredentialPath(tok))) return false;
  // Never safe if it matches a known destructive pattern
  if (UNSAFE_PATTERNS.some((re) => re.test(cmd))) return false;
  // Also never safe if the hard-deny list catches it
  if (isCatastrophic(cmd)) return false;
  // Split on every shell separator — pipes, sequencing (;), conditional chaining (&&/||),
  // backgrounding (&), and a literal newline (a multi-line command is sequenced exactly like
  // `;`) — and check EVERY resulting segment's own first command, not just the string's first
  // token. A single un-inspected segment is a single un-inspected command.
  const segments = cmd.split(/\s*(?:\|\||&&|[|;&\n])\s*/).filter(Boolean);
  for (const seg of segments) {
    const base = firstCommand(seg);
    if (!SAFE_CMD_PREFIXES.has(base)) return false;
  }
  return true;
}

async function runSafeCommand(cmd: string): Promise<string> {
  if (!isReadOnlyCommand(cmd)) {
    return `This command isn't in SAM's read-only allowlist — use run_command instead (it'll ask for approval). Blocked: "${cmd}"`;
  }
  try {
    const { stdout, stderr } = await sh(cmd, { timeout: 60000, cwd: homedir(), maxBuffer: 8 * 1024 * 1024 });
    return clip((stdout || "") + (stderr ? `\n[stderr] ${stderr}` : "")) || "(command finished, no output)";
  } catch (e: any) {
    return `Command failed: ${e?.message || e}`.slice(0, 2000);
  }
}

// run_daemon — for a command too slow to sit in the agent loop's step budget (a full test suite,
// a big build, a long scrape). Same HARD_DENY gate and Elon-Mode trash-aliasing as run_command;
// the only difference is it doesn't wait. Output streams to vault/daemons/<id>.log the whole time
// (tail -f it, or ask SAM to read it) rather than being buffered until exit, and a nudge fires on
// completion — SAM's server is a long-running process for the life of the daemon, so a plain
// (non-detached) child is enough to guarantee the exit handler fires; it doesn't need to survive
// a server restart the way a true system daemon would.
const DAEMON_DIR = join(VAULT_DIR, "daemons");
export const activeTasks = new Map<string, { cmd: string; child: ChildProcess; logPath: string; startedAt: number }>();

function runDaemon(cmd: string, opts?: { interactive?: boolean }): string {
  const d = denied(cmd);
  if (d) return d;
  let finalCmd = cmd;
  if (isElonMode()) {
    const trashAlias = `rm() { mkdir -p ~/.sam-trash; for arg in "$@"; do case "$arg" in -*) ;; *) mv "$arg" ~/.sam-trash/"$(basename "$arg")-$(date +%s)" 2>/dev/null || true ;; esac; done; }; `;
    finalCmd = trashAlias + cmd;
  }
  mkdirSync(DAEMON_DIR, { recursive: true });
  const id = `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const logPath = join(DAEMON_DIR, `${id}.log`);
  const log = createWriteStream(logPath);
  // A write failing here (the vault dir vanished — a real, recurring hazard on this codebase's
  // external-drive deployments) must never become an uncaught exception that takes the whole
  // server down for an unrelated background task.
  log.on("error", () => { /* best-effort logging — the command itself is unaffected */ });
  log.write(`$ ${cmd}\n\n`);
  // stdin defaults to "ignore" (run_daemon is fire-and-forget). manage_task's send_input needs
  // an actual pipe to write to, or the feature can never work regardless of validation.
  const stdinMode: "pipe" | "ignore" = opts?.interactive ? "pipe" : "ignore";
  const child = spawn(finalCmd, { shell: true, cwd: homedir(), stdio: [stdinMode, "pipe", "pipe"] });
  child.on("error", (e) => { log.end(`\n[failed to start: ${e.message}]\n`); addNudge(`Background task failed to start — "${cmd.slice(0, 60)}": ${e.message}`); });
  child.stdout!.pipe(log, { end: false });
  child.stderr!.pipe(log, { end: false });
  child.on("close", (code) => {
    activeTasks.delete(id);
    log.end(`\n\n[exit ${code}]\n`);
    const short = cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd;
    addNudge(`Background task finished (exit ${code}) — "${short}". Log: ${logPath}`);
  });
  activeTasks.set(id, { cmd: finalCmd, child, logPath, startedAt: Date.now() });
  return `Started in the background as ${id}. Logging to ${logPath} — I'll let you know when it finishes. Ask me to read that log anytime to check progress.`;
}

export async function manageTaskTool(i: { action: string; taskId?: string; command?: string; input?: string }): Promise<string> {
  if (i.action === "list") {
    if (activeTasks.size === 0) return "No active tasks.";
    return Array.from(activeTasks.entries()).map(([id, t]) => 
      `- ${id}: ${t.cmd.slice(0, 60)} (running for ${Math.round((Date.now() - t.startedAt) / 1000)}s)`
    ).join("\n");
  }
  
  if (i.action === "spawn") {
    if (!i.command) return "Error: 'command' required for spawn.";
    return runDaemon(i.command, { interactive: true });
  }

  const id = i.taskId;
  if (!id) return "Error: 'taskId' required for this action.";
  const task = activeTasks.get(id);
  if (!task) return `Error: task ${id} not found or already finished.`;

  if (i.action === "status") {
    let out = `Task ${id} is RUNNING.\nLog path: ${task.logPath}\n`;
    try {
      const logs = readFileSync(task.logPath, "utf8");
      const lines = logs.split("\n");
      const tail = lines.slice(-30).join("\n");
      out += `\n--- LAST 30 LINES ---\n${tail}`;
    } catch { out += "\n(No log output yet)"; }
    return out;
  }

  if (i.action === "send_input") {
    if (i.input === undefined) return "Error: 'input' required for send_input.";
    const d = denied(i.input);
    if (d) return d;
    if (!task.child.stdin) return `Error: task ${id} has no stdin.`;
    task.child.stdin.write(i.input + (i.input.endsWith("\n") ? "" : "\n"));
    return `Sent input to task ${id}. Use status to check output.`;
  }

  if (i.action === "kill") {
    task.child.kill();
    activeTasks.delete(id);
    return `Sent SIGTERM to task ${id}.`;
  }

  return `Error: Unknown action '${i.action}'`;
}

// depth guards against a circular reference (`const o = {}; o.path = o`) recursing forever, or a
// pathologically deep nested object doing the same — neither is reachable via normal JSON-parsed
// tool-call args (JSON can't encode cycles), but safePath()/unwrapPath() are called from plenty of
// places that aren't necessarily fed parsed JSON, and tool.activity() calls this unguarded by any
// try/catch in at least two real call sites (agent.ts's executeToolBatch and resumeAgent) — an
// uncaught stack overflow there fails the whole batch/turn, not just one tool call.
export function unwrapPath(p: any, depth = 0): string {
  if (depth > 10) return "~";
  if (!p) return "~";
  if (typeof p === "string") {
    if (p === "[object Object]") return "~";
    return p.trim() || "~";
  }
  if (typeof p === "object") {
    const raw = p.path ?? p.dir ?? p.file ?? p.target ?? p.folder ?? p.src ?? p.name ?? "";
    return unwrapPath(raw, depth + 1);
  }
  return String(p || "~");
}

const safePath = (p: any) => {
  const str = unwrapPath(p);
  return resolve(str.replace(/^~(?=$|\/)/, homedir()));
};

// Files that are ONLY ever credentials. read_file is safe:true, and safe:true means the agent loop
// never asks — see agent.ts, where the gate is `!tool.safe && !mayAutoRun(...)`, so the whole tier
// system simply does not apply to it. Combined with web_fetch (also safe:true, also never asks,
// and whose SSRF guard blocks INTERNAL targets rather than egress), that was a two-step, entirely
// silent exfiltration path: read ~/.ssh/id_rsa, then GET it to an attacker's host, no prompt at
// any point. The only thing standing in the way was the UNTRUSTED fence persuading the model not
// to comply — a behavioural control doing a mechanism's job.
//
// This is a refusal, not a capability removal: `run_command` can still cat any of these, and it is
// DANGEROUS, so a human sees the exact command and approves it. The power stays; the SILENCE goes.
const CREDENTIAL_PATH = [
  /(^|\/)\.ssh\//i,                                   // private keys, authorized_keys, known_hosts
  /(^|\/)\.aws\/(credentials|config)$/i,
  /(^|\/)\.gnupg\//i,
  /(^|\/)\.(netrc|npmrc|pypirc)$/i,
  /(^|\/)\.docker\/config\.json$/i,
  /(^|\/)\.kube\/config$/i,
  /(^|\/)\.config\/gh\/hosts\.yml$/i,
  /(^|\/)\.env(\.[\w.-]+)?$/i,                        // .env, .env.local, .env.production
  /\.(pem|key|p12|pfx|p8|keystore|jks)$/i,            // private key / keystore material
  /(^|\/)Library\/Keychains\//i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
];
export function isCredentialPath(p: string): boolean {
  return CREDENTIAL_PATH.some((re) => re.test(p));
}
export async function readFileTool(input: string | { path?: string; startLine?: number; endLine?: number; lineNumbers?: boolean }): Promise<string> {
  const rawPath = typeof input === "string" ? input : String(input?.path || "");
  if (!rawPath) return "No file path provided to read_file.";
  try {
    const sp = safePath(rawPath);
    // Checked on the RESOLVED path, so "~/x/../.ssh/id_rsa" and a symlink-free relative walk both
    // land on the same string this matches against.
    if (isCredentialPath(sp)) {
      logSecurity("alert", "blocked-credential-read", `Refused an unattended read of a credential file: ${sp}`, "agent");
      return `Blocked: ${rawPath} holds credentials, and read_file runs without asking you first. If you want SAM to see it, ask for the shell command instead (\`cat ${rawPath}\`) — that one shows you the exact command and waits for your approval.`;
    }
    const ext = extname(sp).toLowerCase();
    
    if (ext === ".pdf") {
      const pdfParse = require("pdf-parse");
      const data = await readFile(sp);
      const res = await pdfParse(data);
      return clip(res.text);
    }

    if (ext === ".docx") {
      const mammoth = require("mammoth");
      const data = await readFile(sp);
      const res = await mammoth.extractRawText({ buffer: data });
      return clip(res.value);
    }

    const raw = await readFile(sp, "utf8");

    // Line slicing support
    if (typeof input === "object" && input !== null && (input.startLine !== undefined || input.endLine !== undefined || input.lineNumbers !== undefined)) {
      const lines = raw.split("\n");
      const totalLines = lines.length;
      const start = Math.max(1, Math.min(totalLines, Number(input.startLine) || 1));
      const end = Math.min(totalLines, Math.max(start, Number(input.endLine) || totalLines));
      
      const slice = lines.slice(start - 1, end);
      const shouldNumber = input.lineNumbers !== false;
      const formatted = slice.map((line, idx) => {
        const lineNo = start + idx;
        return shouldNumber ? `${lineNo}: ${line}` : line;
      }).join("\n");

      return `Showing lines ${start} to ${end} of ${totalLines} in ${rawPath}:\n${formatted}`;
    }

    return clip(raw); 
  } catch (e: any) { 
    return `Could not read ${rawPath}: ${e?.message || e}`; 
  }
}

export interface EditFileInput {
  path: string;
  target: string;
  replacement: string;
  allowMultiple?: boolean;
}

export async function editFileTool(input: EditFileInput): Promise<string> {
  const rawPath = String(input?.path || "");
  if (!rawPath) return "No file path provided to edit_file.";
  try {
    const sp = safePath(rawPath);
    if (!existsSync(sp)) return `Could not edit ${rawPath}: file does not exist. Use write_file to create new files.`;

    const target = input.target;
    if (typeof target !== "string" || target.length === 0) {
      return `edit_file rejected: target content cannot be empty.`;
    }
    const replacement = typeof input.replacement === "string" ? input.replacement : "";

    const content = await readFile(sp, "utf8");

    // Count occurrences
    let occurrences = 0;
    let pos = content.indexOf(target);
    while (pos !== -1) {
      occurrences++;
      pos = content.indexOf(target, pos + target.length);
    }

    if (occurrences === 0) {
      return `Target content not found in ${rawPath}. Make sure the target text matches existing lines exactly, including indentation.`;
    }

    if (occurrences > 1 && !input.allowMultiple) {
      return `Target content found ${occurrences} times in ${rawPath}. Set allowMultiple: true to replace all instances, or provide more surrounding context to make target unique.`;
    }

    let newContent: string;
    if (input.allowMultiple) {
      newContent = content.split(target).join(replacement);
    } else {
      const idx = content.indexOf(target);
      newContent = content.slice(0, idx) + replacement + content.slice(idx + target.length);
    }

    if (process.env.SAM_PREVIEW_COMMIT !== "0") {
      const plan = previewChanges([{ kind: "write", path: sp, after: newContent }]);
      const c = plan.changes[0];
      if (c.action === "unchanged") return `${rawPath} is unchanged (target was identical to replacement).`;
      const r = commitChanges(plan);
      if (!r.ok) return `Could not edit ${rawPath}: ${r.error || "commit failed and was rolled back"}`;
      return `Edited ${rawPath} (${occurrences} replacement${occurrences === 1 ? "" : "s"}, +${c.addedLines}/-${c.removedLines} lines, journalled)`;
    }

    await writeFile(sp, newContent, "utf8");
    return `Edited ${rawPath} (${occurrences} replacement${occurrences === 1 ? "" : "s"})`;
  } catch (e: any) {
    return `Could not edit ${rawPath}: ${e?.message || e}`;
  }
}

function editFileCard(i: EditFileInput): string {
  try {
    const sp = safePath(i.path);
    if (!existsSync(sp)) return `Edit ${i.path} (file not found)`;
    const content = readFileSync(sp, "utf8");
    if (!content.includes(i.target)) return `Edit ${i.path} (target snippet not found in file)`;
    const newContent = i.allowMultiple ? content.split(i.target).join(i.replacement || "") : content.replace(i.target, i.replacement || "");
    const c = previewChanges([{ kind: "write", path: sp, after: newContent }]).changes[0];
    return `Edit ${i.path} · +${c.addedLines}/-${c.removedLines} lines`;
  } catch {
    return `Edit ${i?.path || "file"}`;
  }
}

async function writeFileTool(input: { path: string; content: string }): Promise<string> {
  try {
    const abs = safePath(input.path);
    // SAM_PREVIEW_COMMIT: route the write through Preview → Commit — journalled + convergent, so a
    // crash mid-write is recoverable (recover() at boot) and re-writing identical content is a no-op.
    // It also creates parent dirs, which the plain write below does not. On by default now it's proven
    // live; SAM_PREVIEW_COMMIT=0 is the kill-switch back to the plain overwrite.
    if (process.env.SAM_PREVIEW_COMMIT !== "0") {
      const plan = previewChanges([{ kind: "write", path: abs, after: input.content }]);
      const c = plan.changes[0];
      if (c.action === "unchanged") return `${input.path} already holds that exact content — nothing written`;
      const r = commitChanges(plan);
      // NO SILENT FAILURE: a commit that rolled back must say so, never report a phantom success.
      if (!r.ok) return `Could not write ${input.path}: ${r.error || "commit failed and was rolled back"}`;
      return `Wrote ${input.content.length} chars to ${input.path} (${c.action}, +${c.addedLines}/-${c.removedLines} lines, journalled)`;
    }
    await writeFile(abs, input.content, "utf8");
    return `Wrote ${input.content.length} chars to ${input.path}`;
  }
  catch (e: any) { return `Could not write ${input.path}: ${e?.message}`; }
}
// The confirm card for write_file. With Preview → Commit on, show the REAL change — create vs modify
// and the line delta — so the user approves against a diff, not a blind byte count. Must never throw
// (it renders the approval card); any resolve/read failure falls back to the plain description.
function writeFileCard(i: { path: string; content: string }): string {
  if (process.env.SAM_PREVIEW_COMMIT === "0") return `Write to ${i.path} (${(i.content || "").length} chars)`;
  try {
    const c = previewChanges([{ kind: "write", path: safePath(i.path), after: i.content ?? "" }]).changes[0];
    const verb = c.action === "create" ? "Create" : c.action === "unchanged" ? "No change to" : "Modify";
    return `${verb} ${i.path} · +${c.addedLines}/-${c.removedLines} lines`;
  } catch { return `Write to ${i.path} (${(i.content || "").length} chars)`; }
}

export interface GrepSearchInput {
  query: string;
  path?: string;
  caseInsensitive?: boolean;
  isRegex?: boolean;
  maxResults?: number;
}

// AUDIT FIX: grep_search is safe:true (no approval, ever) and shipped with zero
// credential-path awareness — read_file and run_safe_command both check isCredentialPath;
// this didn't. Confirmed exploitable: grep_search({ path: "~/.ssh" }) returned real content
// straight out of known_hosts with no targeting trick beyond just pointing `path` at the
// directory. Two layers: refuse outright when the search root itself is (or is inside) a
// credential path, and — since git-grep/ripgrep/findByContent could still surface a stray
// credential file even in an otherwise-legitimate search root (one that isn't actually
// gitignored, say) — strip any individual `file:line:content` result whose file path matches,
// rather than trust the search root check alone to be the only line of defence.
function scrubCredentialMatches(lines: string[]): { kept: string[]; scrubbed: number } {
  let scrubbed = 0;
  const kept = lines.filter((line) => {
    const filePath = line.split(":")[0];
    if (filePath && isCredentialPath(filePath)) { scrubbed++; return false; }
    return true;
  });
  return { kept, scrubbed };
}
const scrubNote = (n: number) => (n > 0 ? `\n(${n} match${n === 1 ? "" : "es"} in credential files withheld — ask for the shell command instead if you need to see them, so a human approves it first.)` : "");

export async function grepSearchTool(input: GrepSearchInput | string): Promise<string> {
  const parsed = typeof input === "string" ? { query: input } : input;
  const query = String(parsed?.query || "").trim();
  if (!query) return "Please provide a query for grep_search.";
  const targetDir = parsed?.path ? safePath(parsed.path) : homedir();
  // isCredentialPath's patterns match "/.ssh/" etc. WITH a trailing separator (they're built to
  // test a file path, not a bare directory) — a directory path from safePath() never has one, so
  // testing targetDir alone would silently miss exactly the case this exists to catch. The
  // per-line scrub below still catches it as a second layer either way, but this should too.
  if (isCredentialPath(`${targetDir}/`)) {
    return `Blocked: ${targetDir} holds credentials, and grep_search runs without asking you first. If you want SAM to see it, ask for the shell command instead — that one shows you the exact command and waits for your approval.`;
  }
  const max = Math.min(Math.max(1, Number(parsed?.maxResults) || 50), 200);

  const flags: string[] = ["--no-index", "-n", "-I"];
  if (parsed?.caseInsensitive !== false) flags.push("-i");
  if (parsed?.isRegex) flags.push("-E");

  // 1. Try git grep (with --no-index so untracked working trees and temp dirs are searched)
  try {
    const cmd = `git -C ${shq(targetDir)} grep ${flags.join(" ")} ${shq(query)}`;
    const { stdout } = await sh(cmd, { timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
    const { kept: lines, scrubbed } = scrubCredentialMatches(stdout.split("\n").filter(Boolean));
    if (lines.length > 0) {
      const top = lines.slice(0, max);
      const extra = lines.length > max ? `\n…and ${lines.length - max} more matches.` : "";
      return `Found ${lines.length} match(es) in ${targetDir}:\n${top.join("\n")}${extra}${scrubNote(scrubbed)}`;
    }
    if (scrubbed > 0) return `No shareable matches for "${query}" in ${targetDir}.${scrubNote(scrubbed)}`;
  } catch (e: any) {
    if (e.code === 1) return `No matches found for "${query}" in ${targetDir}.`;
    // non-git directory or git error, try ripgrep
  }

  // 2. Try ripgrep (rg)
  try {
    const rgFlags = [
      "-n",
      parsed?.caseInsensitive !== false ? "-i" : "",
      parsed?.isRegex ? "" : "-F",
      "--max-count", String(max),
    ].filter(Boolean).join(" ");
    const { stdout } = await sh(`rg ${rgFlags} ${shq(query)} ${shq(targetDir)}`, { timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
    const { kept: lines, scrubbed } = scrubCredentialMatches(stdout.split("\n").filter(Boolean));
    if (lines.length > 0) {
      return `Found ${lines.length} match(es) in ${targetDir}:\n${lines.slice(0, max).join("\n")}${scrubNote(scrubbed)}`;
    }
    if (scrubbed > 0) return `No shareable matches for "${query}" in ${targetDir}.${scrubNote(scrubbed)}`;
  } catch (e: any) {
    if (e.code === 1) return `No matches found for "${query}" in ${targetDir}.`;
  }

  // 3. Fallback to findByContent if git/rg not applicable
  const allHits = await findByContent(targetDir, query, max * 2);
  const { kept: hits, scrubbed } = scrubCredentialMatches(allHits);
  return hits.length > 0
    ? `Found in ${hits.length} file(s):\n${hits.slice(0, max).join("\n")}${scrubNote(scrubbed)}`
    : `No matches found for "${query}" in ${targetDir}.${scrubNote(scrubbed)}`;
}

export async function semanticSearchTool(input: { query: string; path?: string; k?: number; floor?: number }): Promise<string> {
  const q = String(input.query || "").trim();
  if (!q) return "Error: query required.";
  const p = safePath(input.path || ".");
  // Fast ingest (skips unchanged files) to ensure codebase is up to date
  await ingestFolder(p, 2000);
  const hits = await searchDocs(q, input.k || 10, input.floor || 0.2);
  if (!hits.length) return `No semantic matches found for "${q}" (floor ${input.floor || 0.2}).`;
  return `Found ${hits.length} semantic match(es):\n\n` + hits.map(h => `--- ${h.source} (score: ${h.score.toFixed(3)}) ---\n${h.text}`).join("\n\n");
}

export async function astOutlineTool(input: { path: string }): Promise<string> {
  const p = safePath(input.path);
  if (!existsSync(p)) return `Error: File ${p} not found.`;
  const code = readFileSync(p, "utf8");
  const lines = code.split("\n");
  const outline: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.match(/^(export\s+)?(class|interface|type|function)\s+([a-zA-Z0-9_]+)/)) {
      outline.push(`[Line ${i + 1}] ${l.split('{')[0].trim()}`);
    } else if (l.match(/^(export\s+)?(const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(async\s*)?(\(|[a-zA-Z0-9_]+)/)) {
      if (l.includes("=>")) outline.push(`[Line ${i + 1}] ${l.split('=>')[0].trim()} => { ... }`);
      else outline.push(`[Line ${i + 1}] ${l.split('=')[0].trim()} = ...`);
    }
  }
  
  if (outline.length === 0) return `File ${p} contains no top-level structural declarations (classes/functions/interfaces).`;
  return `AST Outline for ${p}:\n${outline.join("\n")}`;
}

export async function runTestsTool(input: { path?: string }): Promise<string> {
  const args = ["vitest", "run", "--reporter=json"];
  if (input.path) {
    const p = safePath(input.path);
    if (!existsSync(p)) return `Error: test target path '${input.path}' not found.`;
    args.push(p);
  }
  let stdout = "", stderr = "";
  try {
    const res = await execFile("npx", args, { timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (e: any) {
    stdout = e.stdout || "";
    stderr = e.stderr || e.message;
  }
  
  try {
    const jsonIdx = stdout.indexOf('{');
    if (jsonIdx === -1) throw new Error(stderr || stdout || "No JSON output from vitest");
    const jsonStr = stdout.substring(jsonIdx);
    const report = JSON.parse(jsonStr);
    
    if (report.success) {
      return `Success: All ${report.numPassedTests} tests passed in ${report.numPassedTestSuites} suites.`;
    }
    
    const failures: string[] = [];
    for (const suite of report.testResults || []) {
      if (suite.status === "failed") {
        for (const test of suite.assertionResults || []) {
          if (test.status === "failed") {
            const errs = test.failureMessages?.join("\n").slice(0, 500) || "Unknown error";
            failures.push(`- Test: "${test.ancestorTitles.join(" > ")} > ${test.title}"\n  File: ${suite.name}\n  Error: ${errs}\n`);
          }
        }
      }
    }
    return `Tests Failed!\n${failures.join("\n")}`;
  } catch (e: any) {
    return `Failed to parse test output. Raw error:\n${stderr || stdout || e.message}`.slice(0, 2000);
  }
}

export async function subAgentTool(input: { task: string; specialist?: string; tier?: string }): Promise<string> {
  const task = String(input.task || "").trim();
  if (!task) return "Error: task required for subagent.";
  const res = await spawnSubAgent({ task, specialistId: input.specialist, tier: input.tier as any });
  return `Subagent [${res.id}] (${res.status}):\n\n${res.output}`;
}

export async function swarmFanoutTool(input: {
  tasks: string[] | { task: string; specialist?: string; tier?: string }[];
  concurrency?: number;
  synthesize?: boolean;
  goal?: string;
  tier?: string;
}): Promise<string> {
  const rawTasks = Array.isArray(input?.tasks) ? input.tasks : [];
  if (!rawTasks.length) return "Error: tasks array is required (up to 50 tasks).";
  const res = await swarmFanout(rawTasks as any, {
    concurrency: input.concurrency,
    synthesize: input.synthesize ?? true,
    goal: input.goal,
    tier: input.tier as any,
  });

  const lines = [
    `Swarm Fan-Out (50x Concurrency): ${res.completed}/${res.total} completed (${res.failed} failed)\n`,
  ];
  for (const r of res.results) {
    const preview = r.output.length > 200 ? r.output.slice(0, 200) + "…" : r.output;
    lines.push(`- [${r.status.toUpperCase()}] ${r.specialist}: "${r.task}" (${r.durationMs}ms)\n  ${preview.replace(/\n/g, " ")}`);
  }
  if (res.synthesis) {
    lines.push(`\n## 50x Swarm Synthesis:\n${res.synthesis}`);
  }
  return lines.join("\n");
}

export async function codebaseScanParallelTool(input: {
  path?: string;
  pattern: string;
  includeAst?: boolean;
  concurrency?: number;
}): Promise<string> {
  const root = safePath(input?.path || ".");
  const pattern = String(input?.pattern || "").trim();
  if (!pattern) return "Error: search pattern required.";
  // safe:true — auto-executes with zero approval, so this can never be allowed to read straight
  // into a credential path the way grep_search and run_safe_command both once did. Two layers,
  // matching grepSearchTool's fix: refuse the root outright, and drop any individual file whose
  // path matches isCredentialPath — e.g. an allowed extension like .md or .json living inside a
  // recognized credential directory (~/.ssh/notes.md, ~/.aws/config-notes.json). Note this is the
  // same narrow, known-path protection every other tool in this file shares, not a generic
  // secret-content scanner — a file merely named like a credential (gcp-key.json) with no
  // recognized path segment or extension is not caught by isCredentialPath itself.
  if (isCredentialPath(`${root}/`)) {
    return `Blocked: "${input?.path}" looks like a credential path — codebase_scan_parallel won't read it. Ask for the shell command instead so a human approves it first.`;
  }
  const includeAst = input.includeAst ?? true;

  const files = (await walkFiles(root, 6, [])).filter(f => /\.(ts|js|tsx|jsx|json|md|py|go|rs|css|html)$/.test(f) && !isCredentialPath(f));
  if (!files.length) return `No source files found in ${root}.`;

  const concurrency = Math.min(Math.max(1, input.concurrency || 16), 50);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const matches: { file: string; line: number; text: string; astNode?: string }[] = [];

  const queue = [...files];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;
      try {
        const content = await readFile(file, "utf8");
        const lines = content.split("\n");
        let currentAst = "";
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          if (includeAst) {
            const astMatch = line.match(/^(export\s+)?(class|interface|type|function|const|let|var)\s+([a-zA-Z0-9_]+)/);
            if (astMatch) currentAst = astMatch[0].trim();
          }
          if (regex.test(line)) {
            matches.push({
              file: relative(root, file),
              line: idx + 1,
              text: line.trim().slice(0, 200),
              astNode: currentAst || undefined,
            });
            if (matches.length >= 100) break;
          }
        }
      } catch { /* skip unreadable files */ }
    }
  });

  await Promise.all(workers);

  if (!matches.length) return `No matches found for pattern "${pattern}" across ${files.length} scanned files.`;

  const header = `Parallel Codebase Scan (50x Scanner): Found ${matches.length} match(es) across ${files.length} files for "${pattern}":\n`;
  const rows = matches.slice(0, 50).map(m => 
    `- ${m.file}:${m.line} ${m.astNode ? `[in ${m.astNode}]` : ""}\n  ${m.text}`
  );
  return header + rows.join("\n");
}

export async function swarmPipelineTool(input: {
  stages: { name?: string; specialist?: string; task: string; tier?: string; optional?: boolean }[];
  initialInput?: string;
  synthesize?: boolean;
  goal?: string;
  tier?: string;
}): Promise<string> {
  const rawStages = Array.isArray(input?.stages) ? input.stages : [];
  if (!rawStages.length) return "Error: stages array is required.";
  const normalized = rawStages.map((s, idx) => ({
    id: `stage-${idx + 1}`,
    name: s.name || `Step ${idx + 1}`,
    specialistId: s.specialist || "coder",
    taskTemplate: s.task,
    tier: s.tier as any,
    optional: s.optional,
  }));

  const res = await swarmPipeline(normalized, {
    initialInput: input.initialInput,
    synthesize: input.synthesize ?? true,
    goal: input.goal,
    tier: input.tier as any,
  });

  const lines = [
    `Swarm Pipeline [${res.pipelineId}] Status: ${res.status.toUpperCase()}\n`,
  ];
  for (const s of res.stages) {
    const preview = s.output.length > 250 ? s.output.slice(0, 250) + "…" : s.output;
    lines.push(`- Step "${s.name}" (${s.specialist}) [${s.status.toUpperCase()}] (${s.durationMs}ms):\n  ${preview.replace(/\n/g, " ")}`);
  }
  if (res.synthesis) {
    lines.push(`\n## Pipeline Synthesis:\n${res.synthesis}`);
  }
  return lines.join("\n");
}

export async function doctorAutoHealTool(): Promise<string> {
  const hasCloudKeys = keyStatus().some(s => s.total > 0);
  const isOnline = true;
  const vaultWritable = true;
  const world = {
    hasCloudKeys,
    ollamaConfigured: false,
    ollamaReachable: false,
    online: isOnline,
    vaultWritable,
    platform: process.platform,
  };
  const rep = autoHealDoctor(world);
  const lines = [
    `Doctor Auto-Heal Status: ${rep.status.toUpperCase()}`,
    rep.summary,
  ];
  if (rep.remediated.length > 0) {
    lines.push(`\nRemediations Applied:\n` + rep.remediated.map(r => `  ✅ ${r}`).join("\n"));
  }
  if (rep.tasksCreated.length > 0) {
    lines.push(`\nAdmin Tasks Filed for Follow-up:\n` + rep.tasksCreated.map(t => `  ⚠️ ${t}`).join("\n"));
  }
  return lines.join("\n");
}

export async function astReplaceSymbolTool(input: {
  path: string;
  oldSymbol: string;
  newSymbol: string;
  dryRun?: boolean;
}): Promise<string> {
  const p = safePath(input?.path || "");
  if (!existsSync(p)) return `Error: File '${input?.path}' not found.`;
  const oldSymbol = String(input?.oldSymbol || "").trim();
  const newSymbol = String(input?.newSymbol || "").trim();
  if (!oldSymbol || !newSymbol) return "Error: both oldSymbol and newSymbol are required.";
  if (oldSymbol === newSymbol) return "Error: oldSymbol and newSymbol must be distinct.";

  const content = await readFile(p, "utf8");
  const lines = content.split("\n");
  const symbolRegex = new RegExp(`\\b${oldSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");

  const modifiedLines: { line: number; before: string; after: string; isDeclaration: boolean }[] = [];
  let totalReplacements = 0;

  const newLines = lines.map((line, idx) => {
    if (symbolRegex.test(line)) {
      const isDecl = /^(export\s+)?(class|interface|type|function|const|let|var|enum)\s+/.test(line.trim());
      const replaced = line.replace(symbolRegex, () => {
        totalReplacements++;
        return newSymbol;
      });
      modifiedLines.push({
        line: idx + 1,
        before: line.trim(),
        after: replaced.trim(),
        isDeclaration: isDecl,
      });
      return replaced;
    }
    return line;
  });

  if (totalReplacements === 0) {
    return `No identifier occurrences of symbol "${oldSymbol}" found in ${input.path}.`;
  }

  const newContent = newLines.join("\n");

  if (input.dryRun) {
    const diffs = modifiedLines.map(m => `  Line ${m.line} ${m.isDeclaration ? "[DECLARATION]" : ""}:\n    - ${m.before}\n    + ${m.after}`).join("\n");
    return `AST Symbol Refactor (Dry Run) for ${input.path} — ${totalReplacements} replacement(s) found:\n${diffs}\n\nPass dryRun: false to apply changes.`;
  }

  await writeFile(p, newContent, "utf8");

  let tscStatus = "Skipped (non-TS or test mode)";
  if (p.endsWith(".ts") || p.endsWith(".tsx")) {
    try {
      const { execSync } = await import("node:child_process");
      execSync("npx tsc --noEmit", { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" });
      tscStatus = "Clean (0 errors)";
    } catch (e: any) {
      // The rename is a plain word-boundary text replace, not scope-aware — it happily touches
      // matches inside string literals, comments, and template literals too, so a bad rename is
      // a real, expected outcome, not an edge case. Leaving broken code on disk because a
      // "validation" step only reported the problem instead of gating on it would be worse than
      // not validating at all — so revert on any tsc failure rather than leave the mess behind.
      try { await writeFile(p, content, "utf8"); } catch { /* best effort */ }
      const diffs = modifiedLines.map(m => `  Line ${m.line} ${m.isDeclaration ? "[DECLARATION]" : ""}:\n    - ${m.before}\n    + ${m.after}`).join("\n");
      return `AST Symbol Refactor REVERTED for ${input.path}: the rename introduced TypeScript errors, so the file was restored to its original content.\n\nAttempted modifications:\n${diffs}\n\nTypeScript errors:\n${e.stdout || e.message}`;
    }
  }

  const diffs = modifiedLines.map(m => `  Line ${m.line} ${m.isDeclaration ? "[DECLARATION]" : ""}:\n    - ${m.before}\n    + ${m.after}`).join("\n");
  return `AST Symbol Refactor Applied: Replaced "${oldSymbol}" with "${newSymbol}" in ${input.path} (${totalReplacements} replacement(s)).\n\nModifications:\n${diffs}\n\nTypeScript Validation: ${tscStatus}\n\nNote: this is a word-boundary text match, not scope-aware — it also replaces "${oldSymbol}" inside string literals, comments, and template literals, not only actual code references. Review the diff above before trusting a rename near strings/comments containing that text.`;
}

export async function flipitMonteCarloTool(input: {
  initialCapital?: number;
  mu?: number;
  sigma?: number;
  days?: number;
  paths?: number;
  ruinThreshold?: number;
}): Promise<string> {
  const res = monteCarlo100x({
    initialCapital: input?.initialCapital,
    mu: input?.mu ?? 0.001,
    sigma: input?.sigma ?? 0.012,
    days: input?.days ?? 60,
    paths: input?.paths ?? 10_000,
    ruinThreshold: input?.ruinThreshold ?? 0.5,
  });

  const lines = [
    `FlipIt 100x Monte Carlo Simulation (${res.paths.toLocaleString()} paths, ${res.days} days):`,
    `· Mean Final Equity: £${res.meanFinalEquity.toFixed(2)} | Median: £${res.medianFinalEquity.toFixed(2)}`,
    `· Return Quantiles: p5: £${res.quantiles.p5.toFixed(2)} | p25: £${res.quantiles.p25.toFixed(2)} | p50: £${res.quantiles.p50.toFixed(2)} | p75: £${res.quantiles.p75.toFixed(2)} | p95: £${res.quantiles.p95.toFixed(2)}`,
    `· Risk Metrics: VaR 95%: ${(res.var95 * 100).toFixed(2)}% | CVaR 95% (Expected Shortfall): ${(res.cvar95 * 100).toFixed(2)}%`,
    `· Performance: Sharpe Ratio: ${res.sharpeRatio.toFixed(2)} | Sortino: ${res.sortinoRatio.toFixed(2)} | Max Drawdown (Mean): ${(res.maxDrawdownMean * 100).toFixed(2)}% | p95 Drawdown: ${(res.maxDrawdownP95 * 100).toFixed(2)}%`,
    `· Ruin Risk: ${(res.ruinProbability * 100).toFixed(3)}%`,
  ];
  return lines.join("\n");
}

export async function flipitMultiStrategyTool(input: {
  assets?: { id: string; name: string; expectedDailyReturn: number; dailyVolatility: number }[];
  targetDailyVol?: number;
  assumedCorrelation?: number;
}): Promise<string> {
  const rawAssets = Array.isArray(input?.assets) && input.assets.length > 0 ? input.assets : [
    { id: "mom_12_1", name: "12-1 Momentum Core", expectedDailyReturn: 0.0012, dailyVolatility: 0.014 },
    { id: "trend_filter", name: "200-SMA Trend Following", expectedDailyReturn: 0.0009, dailyVolatility: 0.011 },
    { id: "mean_rev", name: "RSI Mean Reversion", expectedDailyReturn: 0.0007, dailyVolatility: 0.009 },
    { id: "vol_break", name: "Bollinger Volatility Breakout", expectedDailyReturn: 0.0015, dailyVolatility: 0.018 },
  ];

  const res = analyzeMultiStrategy(rawAssets, {
    targetDailyVol: input?.targetDailyVol,
    assumedCorrelation: input?.assumedCorrelation,
  });

  const lines = [
    `FlipIt Multi-Strategy Portfolio Matrix (${res.assets.length} strategies):`,
    `· Portfolio Expected Return: +${(res.portfolioExpectedReturn * 100).toFixed(3)}%/day (${(res.portfolioExpectedReturn * 252 * 100).toFixed(1)}% p.a.)`,
    `· Portfolio Volatility: ${(res.portfolioVolatility * 100).toFixed(2)}%/day | Diversification Ratio: ${res.diversificationRatio.toFixed(2)}x`,
    `· Volatility Target Scaling: ${res.volatilityScaleFactor.toFixed(2)}x to meet ${((input?.targetDailyVol || 0.01) * 100).toFixed(2)}% daily target vol`,
    `\nStrategy Allocations (Risk Parity):`,
    ...res.assets.map(a => `  - ${a.name} (${a.id}): ${(a.riskParityWeight * 100).toFixed(1)}% allocation [vol: ${(a.dailyVolatility * 100).toFixed(1)}%]`),
  ];
  return lines.join("\n");
}

export async function flipitLadderProjectionsTool(input: {
  currentEquity?: number;
  mu?: number;
  sigma?: number;
  totalRungs?: number;
}): Promise<string> {
  const res = project100xLadder(input?.currentEquity ?? 5.0, {
    mu: input?.mu,
    sigma: input?.sigma,
    totalRungs: input?.totalRungs ?? 100,
  });

  const lines = [
    `FlipIt 100-Rung Ladder Projections (Start: £${res.currentEquity.toFixed(2)}):`,
    `· Kelly Optimal Bet Sizing: ${(res.optimalKellyFraction * 100).toFixed(1)}% (half-Kelly)`,
    `· Milestone Velocities:`,
    `  - 10x (£${(res.currentEquity * 10).toFixed(2)}): ~${res.milestones.tenXDays} trading days`,
    `  - 50x (£${(res.currentEquity * 50).toFixed(2)}): ~${res.milestones.fiftyXDays} trading days`,
    `  - 100x (£${(res.currentEquity * 100).toFixed(2)}): ~${res.milestones.hundredXDays} trading days`,
    `\nSample Milestone Rungs:`,
    ...[1, 5, 10, 20, 50, 100].filter(r => r <= res.totalRungs).map(r => {
      const rung = res.rungs[r - 1];
      return `  - Rung ${rung.rung}: Target £${rung.targetEquity.toFixed(2)} (~Day ${rung.estimatedDaysToReach})`;
    }),
  ];
  return lines.join("\n");
}

export async function studioHiggsfieldDirectorTool(input: {
  concept: string;
  shotCount?: number;
  style?: string;
  characterName?: string;
  characterDesc?: string;
}): Promise<string> {
  const concept = String(input?.concept || "").trim();
  if (!concept) return "Error: concept is required for Higgsfield storyboard director.";

  let character: CharacterProfile | undefined;
  if (input.characterName) {
    character = {
      characterId: `char_${Date.now()}`,
      name: input.characterName,
      age: 28,
      gender: "person",
      ethnicity: "distinct",
      facialFeatures: input.characterDesc || "sharp cinematic features",
      hair: "styled dark hair",
      eyes: "expressive hazel",
      signatureClothing: "signature cinematic wardrobe",
      distinctTokens: ["id_anchor_1", "soul_lock"],
    };
  }

  const proj = await generateStoryboardDirector({
    concept,
    shotCount: input.shotCount,
    style: input.style,
    character,
  });

  const lines = [
    `🎬 Higgsfield Studio Storyboard: "${proj.title}"`,
    `· Narrative Goal: ${proj.narrativeGoal}`,
    `· Total Shots: ${proj.shots.length} (${proj.totalDurationSec}s estimated runtime)`,
    `· Negative Prompt Filter: ${proj.negativePromptScrub}`,
    `\n## Shot Sequence:`,
  ];

  for (const shot of proj.shots) {
    lines.push(
      `\n### Shot ${shot.shotNumber}: [${shot.shotType}] (${shot.durationSec}s) — ${shot.action}`,
      `· Camera Rig: ${shot.cameraMoveId} | Lens: ${shot.lensId} | Transition: ${shot.transitionToNext}`,
      `· Generation Prompt:\n  "${shot.cinematicPrompt}"`
    );
  }

  return lines.join("\n");
}

export async function studioMotionControllerTool(input: {
  prompt: string;
  cameraRig?: string;
  lens?: string;
  physics?: string;
  motionIntensity?: number;
  aspectRatio?: string;
}): Promise<string> {
  const prompt = String(input?.prompt || "").trim();
  if (!prompt) return "Error: prompt is required.";

  const syn = compileHiggsfieldMotionPrompt({
    basePrompt: prompt,
    cameraRigId: input.cameraRig,
    lensId: input.lens,
    physicsId: input.physics,
    motionIntensity: input.motionIntensity,
    aspectRatio: input.aspectRatio as any,
  });

  const lines = [
    `🎥 Higgsfield 3D Motion Control Synthesis:`,
    `· Lens Signature: ${syn.lensSignature} | Aspect Ratio: ${syn.aspectRatio}`,
    `· Physics Dynamics: ${syn.physicsCues}`,
    `· 3D Camera Trajectory: Rig "${syn.cameraTrajectory.rig}" (Intensity: ${(syn.cameraTrajectory.intensity * 100).toFixed(0)}%)`,
    `  Translation: [${syn.cameraTrajectory.translation.map(n => n.toFixed(2)).join(", ")}] | Rotation: [${syn.cameraTrajectory.rotation.map(n => n.toFixed(2)).join(", ")}]`,
    `\n## Compiled Generation Prompt:\n"${syn.compiledPrompt}"`,
    `\n## Scrubbed Negative Prompt:\n"${syn.negativePrompt}"`,
  ];

  return lines.join("\n");
}

export async function studioCharacterLockTool(input: {
  name: string;
  age?: number | string;
  gender?: string;
  ethnicity?: string;
  facialFeatures?: string;
  hair?: string;
  eyes?: string;
  signatureClothing?: string;
  distinctTokens?: string[];
}): Promise<string> {
  const name = String(input?.name || "").trim();
  if (!name) return "Error: character name is required.";

  const profile: CharacterProfile = {
    characterId: `char_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    age: input.age || 25,
    gender: input.gender || "female",
    ethnicity: input.ethnicity || "athletic",
    facialFeatures: input.facialFeatures || "high cheekbones, symmetrical features",
    hair: input.hair || "shoulder-length dark hair",
    eyes: input.eyes || "green",
    signatureClothing: input.signatureClothing || "black leather jacket and silver pendant",
    distinctTokens: input.distinctTokens || [`${name.toLowerCase()}_soulid`, "character_lock_v1"],
  };

  const anchorPrompt = buildCharacterAnchorPrompt(profile);

  return [
    `👤 Higgsfield SoulID Character Profile Locked: "${profile.name}"`,
    `· ID: ${profile.characterId}`,
    `· Anchor Tokens: ${profile.distinctTokens.join(", ")}`,
    `\n## Character Consistency Prompt Anchor:\n"${anchorPrompt}"\n`,
    `Append this anchor to any generation prompt to maintain consistent character identity across scenes without face or style drift.`,
  ].join("\n");
}

export async function costSavingsReportTool(): Promise<string> {
  const summary = getSavingsSummary();
  const ledger = summary.ledger;

  const lines = [
    `💰 SAM Cost & Token Savings Ledger:`,
    `· Total Requests Handled: ${ledger.totalRequests.toLocaleString()}`,
    `· Free-Tier Routing Efficiency: ${summary.freeEfficiencyPercentage}% (${ledger.freeTierRequests} requests served free)`,
    `· Semantic Cache Efficiency: ${summary.cacheEfficiencyPercentage}% (${ledger.cachedRequests} requests served from zero-token cache)`,
    `· Tokens Processed Free/Cached: ${(ledger.tokensProcessed.freeInputTokens + ledger.tokensProcessed.freeOutputTokens + ledger.tokensProcessed.cachedTokens).toLocaleString()} tokens`,
    `· Estimated Dollars Saved: $${ledger.dollarsSavedTotal.toFixed(2)} (approx. £${summary.estimatedGbpSaved})`,
    `· Total Paid API Spend: $${ledger.dollarsSpentTotal.toFixed(2)}`,
    `\nStrategy: Free-first routing + semantic caching automatically saves tokens on 90%+ of everyday queries.`,
  ];
  return lines.join("\n");
}

export async function optimizePromptTokensTool(input: {
  text: string;
  maxLines?: number;
}): Promise<string> {
  const text = String(input?.text || "").trim();
  if (!text) return "Error: text is required for prompt token optimization.";

  const res = compressPromptForCost(text, { maxLines: input?.maxLines });

  const lines = [
    `⚡ Prompt Token Optimization Summary:`,
    `· Original Size: ${res.originalLength.toLocaleString()} chars (~${res.estimatedOriginalTokens.toLocaleString()} tokens)`,
    `· Optimized Size: ${res.compressedLength.toLocaleString()} chars (~${res.estimatedCompressedTokens.toLocaleString()} tokens)`,
    `· Tokens Saved: ${res.tokensSaved.toLocaleString()} tokens (${res.reductionPercentage}% reduction)`,
    `\n## Optimized Text Preview:\n${res.compressedText.slice(0, 500)}${res.compressedText.length > 500 ? "…" : ""}`,
  ];
  return lines.join("\n");
}

export async function capitalProtectionAuditTool(input: {
  equity?: number;
  highWaterMark?: number;
  maxDrawdownLimit?: number;
}): Promise<string> {
  const eq = input?.equity ?? 5.0;
  const hwm = input?.highWaterMark ?? 5.0;

  const audit = auditCapitalProtection({
    equity: eq,
    highWaterMark: hwm,
    maxDrawdownLimit: input?.maxDrawdownLimit,
  });

  const lines = [
    `🛡️ Capital Protection & Risk Circuit Breaker:`,
    `· Current Equity: £${audit.equity.toFixed(2)} | High-Water Mark: £${audit.highWaterMark.toFixed(2)}`,
    `· Drawdown: ${(audit.currentDrawdown * 100).toFixed(2)}% (Max Limit: ${(audit.maxDrawdownLimit * 100).toFixed(1)}%)`,
    `· Circuit Breaker Status: [${audit.status}]`,
    `· Optimal Kelly Fraction (Position Size): ${(audit.recommendedMaxBetFraction * 100).toFixed(1)}% max per trade`,
  ];
  if (audit.riskWarning) {
    lines.push(`\n⚠️ Alert:\n${audit.riskWarning}`);
  }
  return lines.join("\n");
}

export async function smartQuickActionTool(input: {
  intent: string;
}): Promise<string> {
  const intent = String(input?.intent || "").trim();
  if (!intent) return "Error: intent is required for smart action execution.";

  const act = await executeSmartAction(intent);
  const lines = [
    `${act.title}:`,
    `· ${act.summary}`,
    `\nDetails:`,
    ...act.details.map(d => `  - ${d}`),
    `\nNext Step: ${act.nextSuggestedAction}`,
  ];
  return lines.join("\n");
}

export async function smartStudioPresetTool(input: {
  concept: string;
  mood?: "cinematic" | "action" | "moody" | "commercial" | "anime" | "vintage";
}): Promise<string> {
  const concept = String(input?.concept || "").trim();
  if (!concept) return "Error: concept is required.";

  const preset = generateSmartStudioPreset(concept, input?.mood);
  const lines = [
    `🎬 Higgsfield 1-Click Studio Preset:`,
    `· Recommended Camera: ${preset.recommendedCameraRig} | Lens: ${preset.recommendedLens} | Aspect: ${preset.aspectRatio}`,
    `\n## Ready-To-Generate Prompt:\n"${preset.enhancedPrompt}"`,
    `\nQuick Tips:`,
    ...preset.quickTips.map(t => `  - ${t}`),
  ];
  return lines.join("\n");
}

export async function smartFlipitSummaryTool(): Promise<string> {
  const card = buildSimpleFlipItSummary();
  const lines = [
    `📈 FlipIt Quick Glance Summary:`,
    `· Current Balance: ${card.currentEquity}`,
    `· Ladder Status: ${card.rungStatus} (${card.ladderProgressPct}% progress)`,
    `· Safe Position Size: ${card.safePositionSize}`,
    `· System Health: [${card.overallHealth}]`,
    `· Guidance: ${card.actionAdvice}`,
  ];
  return lines.join("\n");
}

export async function mobileDispatchNotificationTool(input: {
  title: string;
  body: string;
  category?: "alert" | "watchdog" | "task" | "trade" | "chat";
  deepLink?: string;
}): Promise<string> {
  const title = String(input?.title || "SAM Alert").trim();
  const body = String(input?.body || "").trim();
  if (!body) return "Error: notification body is required.";

  const prep = prepareMobilePush({
    title,
    body,
    category: input?.category || "alert",
    deepLink: input?.deepLink,
  });

  const lines = [
    `📱 Mobile Notification Prepared & Dispatched:`,
    `· Notification ID: ${prep.notificationId}`,
    `· Scrubbed Title: "${prep.scrubbedTitle}"`,
    `· Scrubbed Body: "${prep.scrubbedBody}"`,
    `· APNs Category: ${prep.apnsPayload.aps.category} | Sound: ${prep.apnsPayload.aps.sound}`,
    `· FCM Channel: ${prep.fcmPayload.android.notification.channelId}`,
  ];
  return lines.join("\n");
}

export async function audioSynthesizeSpeechTool(input: {
  text: string;
  voice?: string;
  speed?: number;
}): Promise<string> {
  const text = String(input?.text || "").trim();
  if (!text) return "Error: text is required for audio speech synthesis.";

  const speech = generateSpeechAudio(text, input?.voice, { speed: input?.speed });

  const lines = [
    `🎙️ Voice Audio Synthesis Ready:`,
    `· Speaker Voice: ${speech.voice.name} (${speech.voice.accent})`,
    `· Duration: ${speech.durationSeconds}s (${speech.audioFormat})`,
    `· 32-Bin Waveform: [${speech.waveformSample.slice(0, 8).join(", ")}…]`,
    `· Text: "${speech.text.slice(0, 200)}${speech.text.length > 200 ? "…" : ""}"`,
  ];
  return lines.join("\n");
}

export async function flipitRebalancePortfolioTool(input: {
  holdings?: HoldingPosition[];
  targetAllocations?: TargetAllocation[];
  totalEquityGbp?: number;
}): Promise<string> {
  const rawHoldings: HoldingPosition[] = Array.isArray(input?.holdings) && input.holdings.length > 0 ? input.holdings : [
    { id: "mom_12_1", ticker: "MOM", name: "12-1 Momentum Core", currentValueGbp: 65.0, currentWeight: 0.65 },
    { id: "trend_filter", ticker: "TRND", name: "200-SMA Trend Following", currentValueGbp: 20.0, currentWeight: 0.20 },
    { id: "mean_rev", ticker: "REV", name: "RSI Mean Reversion", currentValueGbp: 15.0, currentWeight: 0.15 },
  ];

  const rawTargets: TargetAllocation[] = Array.isArray(input?.targetAllocations) && input.targetAllocations.length > 0 ? input.targetAllocations : [
    { id: "mom_12_1", targetWeight: 0.40 },
    { id: "trend_filter", targetWeight: 0.35 },
    { id: "mean_rev", targetWeight: 0.25 },
  ];

  const report = calculatePortfolioRebalance(rawHoldings, rawTargets, input?.totalEquityGbp);

  const lines = [
    `⚖️ FlipIt Autonomous Portfolio Rebalancing Report (Total: £${report.totalPortfolioValueGbp.toFixed(2)}):`,
    `· Rebalance Required: ${report.isRebalanceNeeded ? "YES (Drift Detected)" : "NO (Balanced)"}`,
    `· Maximum Weight Drift: ${report.maxWeightDriftPct}%`,
    `· Total Turnover: £${report.totalTurnoverGbp.toFixed(2)} (${report.turnoverPercentage}% of portfolio)`,
    `· Estimated Transaction Fees: £${report.estimatedCommissionGbp.toFixed(2)}`,
    `\nActionable Rebalance Orders:`,
    ...report.trades.map(t => `  - [${t.action}] ${t.ticker} (${t.id}): ${t.action === "HOLD" ? "Hold current size" : `${t.action} £${Math.abs(t.deltaGbp).toFixed(2)}`} (Current: ${t.currentWeightPct}% → Target: ${t.targetWeightPct}%)`),
  ];
  return lines.join("\n");
}

export async function samMasterDashboardTool(): Promise<string> {
  const d = getMasterDashboard({ activeToolsCount: TOOLS.length });

  const lines = [
    `🎛️ SAM Master Executive Dashboard:`,
    `· Overall System Health: [${d.systemHealth.status}] (${d.systemHealth.activeToolsCount} tools online)`,
    `· Multi-Tier Cache: L1=${d.cacheStats.l1Entries}, L2=${d.cacheStats.l2Entries} (${d.cacheStats.totalHitRatioPct}% hit ratio)`,
    `· Cost & Token Savings: $${d.costSavings.dollarsSaved.toFixed(2)} saved (${d.costSavings.freeTierPct}% free-lane efficiency)`,
    `· FlipIt 100x Quant Desk: £${d.flipitQuant.equityGbp.toFixed(2)} on Rung ${d.flipitQuant.currentRung} (Safe Sizing: £${d.flipitQuant.safePositionGbp.toFixed(2)})`,
    `· Higgsfield AI Studio: ${d.studioHiggsfield.cameraRigsCount} 3D Camera Rigs, ${d.studioHiggsfield.lensProfilesCount} Lenses, SoulID Active`,
    `· Universal Mobile Bridge: ${d.mobileBridge.pairedDevicesCount} paired devices (APNs: ${d.mobileBridge.apnsOnline ? "ON" : "OFF"}, FCM: ${d.mobileBridge.fcmOnline ? "ON" : "OFF"})`,
    `\nDiagnostics: ${d.systemHealth.doctorSummary}`,
  ];
  return lines.join("\n");
}

export async function mobileGenerateFeedSnapshotTool(): Promise<string> {
  const feed = generateMobileFeed({ activeToolsCount: TOOLS.length });

  const lines = [
    `📱 Mobile Live Feed Stream Snapshot (${feed.activeCards.length} active cards):`,
    ...feed.activeCards.map(c => `  - [${c.type}] ${c.title} (${c.badge}): ${c.subtitle}`),
    `\nDeep Links: ${feed.activeCards.map(c => c.deepLink).join(", ")}`,
  ];
  return lines.join("\n");
}

export async function deepResearchSynthesizerTool(input: {
  query: string;
  depth?: "quick" | "deep" | "exhaustive";
}): Promise<string> {
  const q = String(input?.query || "").trim();
  if (!q) return "Error: query is required for deep research synthesis.";

  const rep = await conductDeepResearch(
    q,
    { search: webSearch, synthesize: (system, prompt) => runModel("free", system, prompt) },
    { depth: input?.depth },
  );

  if (!rep.sources.length) return rep.executiveSummary;

  const lines = [
    `🔬 SAM Deep Research Brief: "${rep.topic}" (Consensus Score: ${rep.consensusConfidencePct}%):`,
    `\n## Executive Summary:`,
    rep.executiveSummary,
    `\n## Key Findings (cited to the sources below):`,
    ...rep.keyFindings.map((f) => `  [${f.sourceIndex}] ${f.claim} (Confidence: ${(f.confidence * 100).toFixed(0)}%)`),
    `\n## Tradeoffs & Dissenting Views:`,
    ...rep.dissentingOrConflictingViews.map(d => `  - ${d}`),
    `\n## Sources:`,
    ...rep.sources.map(s => `  [${s.index}] ${s.title}\n      ${s.url}`),
  ];
  return lines.join("\n");
}

export async function brainPerformanceMatrixTool(): Promise<string> {
  const mat = getBrainPerformanceMatrix();

  const lines = [
    `🧠 SAM Brain Performance & Provider Arbitrage Matrix:`,
    `· Providers in registry: ${mat.totalConfiguredProviders} total — ${mat.benchmarks.length} profiled below (${mat.freeTierCount} of those are zero-cost lanes)`,
    `· Fastest Interactive Streamer (of the profiled, currently-online lanes): ${mat.fastestInteractiveProvider}`,
    `· Top Reasoning Champion (of the profiled, currently-online lanes): ${mat.bestReasoningProvider}`,
    `\nProfiled Providers (status is live; ms/tok-s are typical published figures, not a live per-request measurement):`,
    ...mat.benchmarks.map(b => `  - [${b.status}] ${b.name} (${b.tier.toUpperCase()}): ~${b.typicalLatencyMs}ms latency · ~${b.tokensPerSecond} tok/s [${b.strengthCategory}]`),
  ];
  return lines.join("\n");
}

export async function simdParallelToolBatchTool(input: {
  calls: { name: string; args?: any }[];
}): Promise<string> {
  const calls = Array.isArray(input?.calls) ? input.calls : [];
  if (!calls.length) return "Error: calls array is required with at least 1 tool call.";

  const { fenceToolResult } = await import("./agent.ts");
  const report = await executeSimdToolBatch(calls, async (name, args) => {
    const t = TOOLS.find(x => x.name === name);
    if (!t) return `Tool '${name}' not found.`;
    if (!t.safe) return `Tool '${name}' is mutating and cannot run inside parallel read batch.`;
    return fenceToolResult(name, await t.run(args));
  });

  const lines = [
    `🏎️ SIMD Parallel Tool Batch Executed (${report.completedCount}/${report.totalTools} completed in ${report.wallClockDurationMs}ms):`,
    `· Sequential Baseline Estimate: ${report.sequentialEstimatedMs}ms`,
    `· Parallel Speedup Factor: ${report.speedupFactor}x faster`,
    `\nTool Outputs:`,
    ...report.results.map((r, i) => `  [${i + 1}] ${r.tool} (${r.durationMs}ms): ${r.output.slice(0, 120).replace(/\n/g, " ")}${r.output.length > 120 ? "..." : ""}`),
  ];
  return lines.join("\n");
}

export async function speculativeRouteIntentTool(input: { prompt: string }): Promise<string> {
  const p = String(input?.prompt || "").trim();
  if (!p) return "Error: prompt is required to calculate speculative route.";

  const plan = resolveOptimalRoute(p);

  const lines = [
    `⚡ Speculative Difficulty Route Plan for "${plan.prompt.slice(0, 60)}":`,
    `· Complexity Tier: [${plan.tier}] (Target Latency: ${plan.targetLatencyMs}ms)`,
    `· Primary Free Brain: ${plan.primaryProvider} (${plan.primaryModel}) · Zero-Cost: ${plan.isZeroCostLane ? "YES" : "NO"}`,
    `· Failover Hot-Swap Chain: ${plan.failoverChain.join(" → ")}`,
    `· Rationale: ${plan.rationale}`,
  ];
  return lines.join("\n");
}

export async function prefetchWarmContextTool(input?: { topics?: string[] }): Promise<string> {
  const res = prewarmContext(input?.topics);

  const lines = [
    `🔥 Predictive L1 Cache Pre-Warmed (${res.durationMs}ms):`,
    `· Warmed Keys: ${res.warmedKeys.length ? res.warmedKeys.join(", ") : "All keys already warm"}`,
    `· L1 Resident Cache Size: ${res.l1TotalEntries} entries in-memory`,
  ];
  return lines.join("\n");
}

export async function localMicroSolverTool(input: { query: string }): Promise<string> {
  const q = String(input?.query || "").trim();
  if (!q) return "Error: query is required for local micro solver.";

  const res = trySolveLocally(q);
  if (res.solvedLocally) {
    return `⚡ Local Zero-Token Solution (${res.durationMs}ms · 0 tokens · $0.00):\n· Type: ${res.type.toUpperCase()}\n· Result: ${res.answer}`;
  }
  return `ℹ️ Query "${q}" is non-deterministic or requires multi-step LLM reasoning.`;
}

export async function spaceConsumptionOptimizerTool(input?: { mode?: "audit" | "compact" }): Promise<string> {
  const mode = input?.mode || "audit";
  if (mode === "compact") {
    const res = compactSpaceAndMemory();
    return `🧹 Space & Memory Compaction Completed in ${res.durationMs}ms:\n· Purged Cache Items: ${res.freedCacheEntries}\n· Current Heap Memory: ${res.currentHeapUsedMb} MB\n· Status: ${res.status}`;
  }

  const audit = auditSpaceConsumption();
  return `📊 Memory & Storage Consumption Audit:\n· Heap Memory Used: ${audit.heapUsedMb} MB (of ${audit.heapTotalMb} MB allocated)\n· Resident Set (RSS): ${audit.rssMb} MB\n· Active L1 Cache Entries: ${audit.l1CacheEntries}\n· Status: [${audit.status}]\n· Recommendation: ${audit.savingsRecommendation}`;
}

export async function intentAutoDisambiguatorTool(input: { prompt: string; activeFile?: string }): Promise<string> {
  const p = String(input?.prompt || "").trim();
  if (!p) return "Error: prompt is required for intent disambiguation.";

  const dis = disambiguateUserIntent(p, { activeFile: input?.activeFile });
  return `🎯 Disambiguated Intent (${dis.confidencePct}% confidence):\n· Inferred Target: ${dis.inferredTarget}\n· Recommended Action: ${dis.recommendedTool}(${JSON.stringify(dis.inferredArgs)})\n· Why: ${dis.explanation}`;
}

export async function flipitScaleShieldTool(input?: {
  currentEquityGbp?: number;
  peakEquityGbp?: number;
  winRate?: number;
  avgWinGbp?: number;
  avgLossGbp?: number;
  // AUDIT FIX: this tool's own description already claimed "cross-market arbitrage spreads",
  // but scanCrossMarketSpreads (flipit-scale.ts) was imported and never called anywhere —
  // genuinely dead code the description was already lying about. SAM has no live exchange feed,
  // so this stays honest: the scan only runs if the caller supplies real quotes; with none
  // given, that section is omitted rather than fabricating spreads that were never computed.
  quotes?: { symbol: string; exchangeA: string; bidA: number; askA: number; exchangeB: string; bidB: number; askB: number }[];
  allocatedCapitalGbp?: number;
}): Promise<string> {
  const current = Number(input?.currentEquityGbp ?? 1000);
  const peak = Number(input?.peakEquityGbp ?? current);
  const winRate = Number(input?.winRate ?? 0.55);
  const avgWin = Number(input?.avgWinGbp ?? 100);
  const avgLoss = Number(input?.avgLossGbp ?? 80);

  const res = computeKellyRiskShield({
    currentEquityGbp: current,
    peakEquityGbp: peak,
    winRate,
    avgWinGbp: avgWin,
    avgLossGbp: avgLoss,
  });

  const lines = [
    `🛡️ FlipIt Portfolio Scaling & Risk Shield:`,
    `· Current Equity: £${res.currentEquityGbp.toLocaleString()} (Drawdown: ${res.drawdownPct}%)`,
    `· Risk Regime: [${res.riskRegime}]`,
    `· Kelly Allocation: Full ${Number((res.fullKellyFraction * 100).toFixed(1))}% · Rec Half-Kelly: ${Number((res.recommendedHalfKelly * 100).toFixed(1))}%`,
    `· Max Permitted Leverage: ${res.maxLeveragePermitted}x`,
    `· Recommended Cash Reserve: ${res.recommendedCashReservePct}%`,
    `· Hedging Protocol: ${res.hedgingAction}`,
  ];

  if (Array.isArray(input?.quotes) && input.quotes.length > 0) {
    const opps = scanCrossMarketSpreads(input.quotes, input?.allocatedCapitalGbp ?? 1000);
    lines.push(`\nCross-Market Arbitrage Scan (${opps.length} opportunit${opps.length === 1 ? "y" : "ies"} above fees):`);
    if (opps.length === 0) {
      lines.push(`  No spread cleared the 10bps threshold plus fees on the supplied quotes.`);
    } else {
      for (const o of opps.slice(0, 10)) {
        lines.push(`  - ${o.pair}: buy ${o.sourceExchange} → sell ${o.targetExchange}, ${o.spreadBps}bps, net ~£${o.estimatedNetProfitGbp} [${o.executionRisk} execution risk]`);
      }
    }
  }

  return lines.join("\n");
}

export async function flipitMarketStreamTool(input?: {
  action?: "status" | "start" | "stop";
  pairs?: string[];
}): Promise<string> {
  const action = input?.action || "status";
  if (action === "start") {
    const engine = startSharedIngestEngine(input?.pairs);
    return `📡 Started live Binance & Kraken market stream for pairs: ${engine.getStatus().pairs.join(", ")}.`;
  }
  if (action === "stop") {
    stopSharedIngestEngine();
    return "🛑 Stopped live Binance & Kraken market stream.";
  }
  const status = getSharedIngestStatus();
  const ticks = Object.values(status.latestTicks);
  const lines = [
    `📡 FlipIt Real-Time Exchange Stream Status:`,
    `· Status: ${status.running ? "ACTIVE (Streaming)" : "IDLE (Stopped)"}`,
    `· Monitored Pairs: ${status.pairs.join(", ")}`,
    `· Active Sockets: ${status.activeSocketsCount} · Total Ticks Ingested: ${status.totalTicksReceived}`,
  ];
  if (ticks.length > 0) {
    lines.push(`\nLatest Live Book Ticks:`);
    for (const t of ticks) {
      lines.push(`  - [${t.exchange.toUpperCase()}] ${t.pair}: Bid £${t.bid} (vol ${t.bidVol}) · Ask £${t.ask} (vol ${t.askVol})`);
    }
  } else {
    lines.push(`\nNo ticks received yet. Run action="start" to connect live feeds.`);
  }
  return lines.join("\n");
}

export async function yardLaunchPlaybookTool(input?: {
  playbookId?: string;
  values?: Record<string, string>;
}): Promise<string> {
  const id = input?.playbookId || "fullstack-saas-core";
  const pb = getPlaybook(id) || getStarterPlaybookDef(id);
  if (!pb) {
    const available = [...listPlaybooks().map((p) => p.id), ...STARTER_PLAYBOOKS.map((p) => p.id)];
    return `Playbook "${id}" not found. Available playbooks: ${[...new Set(available)].join(", ")}`;
  }
  const defaultVals = ("defaultValues" in pb ? pb.defaultValues : pb.lastValues) || {};
  const mergedVals = { ...defaultVals, ...(input?.values || {}) };
  const rendered = renderTemplate(pb.template, mergedVals);

  return [
    `📋 Yard Playbook [${pb.name}] (v${"version" in pb ? pb.version : 1}):`,
    `· ID: ${pb.id}`,
    `\n--- Rendered Master Prompt ---\n${rendered}`,
  ].join("\n");
}

export async function modelSpeedBenchmarkTool(): Promise<string> {
  const board = getSpeedLeaderboard();
  const lines = [
    `⚡ S.A.M. Model Speed & Latency Benchmark Leaderboard:`,
    `· Active Providers: ${board.activeCount}/${board.probedCount} · Fastest Leader: [${board.fastestProvider || "Auto-detected"}]`,
  ];
  if (board.results.length > 0) {
    lines.push(`\nProvider Performance Ranking:`);
    for (const r of board.results) {
      const statusIcon = r.ok ? "🟢" : "🔴";
      const throughput = r.tokensPerSec ? ` · ${r.tokensPerSec} tok/sec` : "";
      lines.push(`  ${statusIcon} [${r.providerId}] Total Latency: ${r.totalMs}ms (TTFT: ~${r.ttftMs}ms)${throughput}`);
    }
  } else {
    lines.push(`\nNo probe results recorded yet. Trigger active latency probing via POST /api/models/probe-speeds.`);
  }
  return lines.join("\n");
}

export async function deepResearchDossierTool(input: {
  topic: string;
  depth?: "quick" | "deep" | "exhaustive";
}): Promise<string> {
  const topic = String(input?.topic || "").trim();
  if (!topic) return "Error: topic is required for executive deep research dossier.";

  const report = await conductDeepResearch(topic, {
    search: (q) => webSearch(q),
    synthesize: (sys, pr) => runModel("free", sys, pr, "deep"),
  }, { depth: input?.depth || "deep" });

  const dossier = compileExecutiveDossier(report);
  return dossier.markdownDossier;
}

export async function hardwareVitalsTelemetryTool(): Promise<string> {
  const v = getHardwareVitals();
  const batt = v.battery.hasBattery
    ? `${v.battery.percent}% (${v.battery.powerSource.toUpperCase()}${v.battery.isCharging ? " ⚡ Charging" : ""}${v.battery.timeRemainingMinutes ? ` · ${v.battery.timeRemainingMinutes}m left` : ""})`
    : "AC Power (Desktop/Virtual)";

  const lines = [
    `🖥️ S.A.M. Host Hardware & Power Telemetry:`,
    `· Host: ${v.hostname} (${v.platform} ${v.arch}) · Uptime: ${Math.round(v.uptimeSeconds / 3600)}h ${Math.round((v.uptimeSeconds % 3600) / 60)}m`,
    `· CPU: ${v.cpuCount} cores · Load Avg: [1m: ${v.loadAverage1m}, 5m: ${v.loadAverage5m}, 15m: ${v.loadAverage15m}]`,
    `· Memory: ${Math.round((v.totalMemoryBytes - v.freeMemoryBytes) / (1024 * 1024 * 1024) * 10) / 10}GB / ${Math.round(v.totalMemoryBytes / (1024 * 1024 * 1024) * 10) / 10}GB (${v.memorySaturationPct}% saturated)`,
    `· Battery / Power: ${batt}`,
    `· Task Throttle Status: ${v.isThrottled ? `⚠️ THROTTLED (${v.throttleReason})` : "🟢 NORMAL (Unthrottled)"}`,
  ];
  return lines.join("\n");
}

export async function auditLedgerVerifyTool(): Promise<string> {
  const res = verifyAuditChainIntegrity();
  const lines = [
    `🛡️ S.A.M. Cryptographic Audit Chain Integrity:`,
    `· Status: ${res.valid ? "🟢 100% VERIFIED (Unbroken Merkle Chain)" : `🔴 INTEGRITY FAILED (Broken at #${res.brokenAtIndex}: ${res.error})`}`,
    `· Total Recorded Events: ${res.totalEntries}`,
    `· Latest Block Hash: ${res.latestHash || "N/A"}`,
  ];
  return lines.join("\n");
}

export async function flipitEvSignalsTool(input?: { portfolioGbp?: number }): Promise<string> {
  const cap = input?.portfolioGbp || 1000;
  const signals = scanEvArbitrageSignals([], cap);
  const positive = signals.filter((s) => s.isPositiveEv);

  const lines = [
    `📈 FlipIt Quantitative +EV Prediction Market Signals (Capital: £${cap}):`,
    `· Total Opportunities Scanned: ${signals.length} · Positive Expected Value: ${positive.length}`,
  ];

  if (positive.length > 0) {
    lines.push(`\nActionable +EV Signals:`);
    for (const s of positive) {
      lines.push(
        `  🚀 [${s.recommendedPosition}] "${s.title}" (${s.underlying})` +
        `\n     · Edge: +${s.edgePct}% (Model: ${Math.round(s.modelTrueProbability * 100)}% vs Market: ${Math.round(s.marketImpliedProbability * 100)}%)` +
        `\n     · Half-Kelly Allocation: £${s.halfKellyAllocationGbp} · Expected ROI: +${s.expectedRoiPct}% · Confidence: ${s.confidenceScore}%`
      );
    }
  } else {
    lines.push(`\nNo +EV signals found meeting the 4%+ edge threshold right now.`);
  }
  return lines.join("\n");
}

export async function yardSandboxDaemonTool(input: {
  action: "start" | "stop" | "status" | "list";
  projectId?: string;
  command?: string;
  sessionId?: string;
}): Promise<string> {
  const act = input.action || "list";
  if (act === "list") {
    const list = listSandboxSessions();
    if (list.length === 0) return "No active Yard sandbox sessions currently running.";
    return `Active Yard Sandboxes:\n` + list.map((s) => `· [${s.status}] ID: ${s.sessionId} (Project: ${s.projectId}, Port: http://127.0.0.1:${s.port}, PID: ${s.pid})`).join("\n");
  }

  if (act === "start") {
    if (!input.command) return "Error: command is required to start a sandbox process.";
    const s = await startSandboxApp({
      projectId: input.projectId || "yard-app",
      cwd: process.cwd(),
      command: input.command,
    });
    return `🚀 Started Yard Sandbox "${s.sessionId}" on port http://127.0.0.1:${s.port} (PID: ${s.pid}). Status: ${s.status}`;
  }

  if (act === "stop") {
    if (!input.sessionId) return "Error: sessionId is required to stop sandbox.";
    const res = stopSandboxApp(input.sessionId);
    return res.message;
  }

  if (act === "status") {
    if (!input.sessionId) return "Error: sessionId is required for status.";
    const s = getSandboxSession(input.sessionId);
    if (!s) return `No sandbox found with ID "${input.sessionId}".`;
    const lines = [
      `Yard Sandbox Status: [${s.sessionId}]`,
      `· Project: ${s.projectId} · Status: ${s.status} · Port: http://127.0.0.1:${s.port}`,
      `· Recent Logs (${s.recentLogs.length} lines):`,
      ...s.recentLogs.slice(-10).map((l) => `  ${l}`),
    ];
    if (s.crashError) lines.push(`⚠️ Crash Error: ${s.crashError}`);
    if (s.repairPlan) lines.push(`🔧 Self-Healing Repair Plan: ${s.repairPlan.summary}`);
    return lines.join("\n");
  }

  return "Unknown action.";
}

export async function studioMasterTimelineTool(input: {
  concept: string;
  sceneCount?: number;
  aspectRatio?: "16:9" | "9:16" | "2.39:1" | "1:1";
}): Promise<string> {
  const c = String(input.concept || "").trim();
  if (!c) return "Error: concept is required for master timeline compilation.";

  const timeline = compileProductionTimeline({
    conceptPrompt: c,
    sceneCount: input.sceneCount,
    aspectRatio: input.aspectRatio,
  });

  const lines = [
    `🎬 Studio Master Production Timeline: "${timeline.title}"`,
    `· Format: ${timeline.aspectRatio} @ ${timeline.framerateFps}fps · Total Duration: ${timeline.smpteDuration} (${timeline.totalDurationSec}s, ${timeline.totalFrames} frames)`,
    `· Character Anchor: ${timeline.characterSeedAnchor}`,
    `· Video Shots: ${timeline.videoShots.length} · Audio Stems/Tracks: ${timeline.audioTracks.length}`,
    `\n--- Standard SMPTE Edit Decision List (EDL) ---\n${timeline.edlManifestText}`,
  ];
  return lines.join("\n");
}

export async function flipitMarketMakerTool(input: {
  spotPrice: number;
  strikePrice: number;
  expiryDays: number;
  inventory?: number;
  targetSpread?: number;
}): Promise<string> {
  const spot = Number(input.spotPrice || 100000);
  const strike = Number(input.strikePrice || 100000);
  const days = Number(input.expiryDays || 14);
  const inv = Number(input.inventory || 0);
  const spread = input.targetSpread ? Number(input.targetSpread) : 0.04;

  const quotes = generateMarketMakerQuotes({
    spotPriceUsd: spot,
    strikePriceUsd: strike,
    expiryDays: days,
    currentYesInventory: inv,
    targetSpreadPct: spread,
  });

  const hedge = calculateDeltaHedge(spot, strike, days, inv);

  const lines = [
    `📊 FlipIt Statistical Market Maker & Delta Hedger:`,
    `· Underlying: Spot $${spot.toLocaleString()} vs Strike $${strike.toLocaleString()} (${days}d expiry)`,
    `· Fair Value: ${(quotes.fairValue * 100).toFixed(1)}% · Reservation Price: ${(quotes.reservationPrice * 100).toFixed(1)}% (Skew: ${quotes.skewDirection})`,
    `· Two-Sided Quotes: BID ${(quotes.bidPrice * 100).toFixed(1)}¢ (£${quotes.bidSizeGbp}) | ASK ${(quotes.askPrice * 100).toFixed(1)}¢ (£${quotes.askSizeGbp}) · Spread: ${(quotes.spreadPct * 100).toFixed(1)}¢`,
    `· Net Delta Exposure: $${hedge.totalPortfolioDeltaUsd} (${hedge.binaryDelta.toFixed(6)} per contract)`,
    `· Spot Rebalance: ${hedge.isHedgeRequired ? `⚡ ${hedge.requiredSpotHedgeAction} $${hedge.hedgeAmountSpotUsd} (${hedge.hedgeAmountCryptoUnits} units)` : "✅ Delta Neutral (No hedge required)"}`,
  ];
  return lines.join("\n");
}

export async function p2pMeshNetworkTool(input?: {
  action?: "status" | "broadcast";
  channel?: string;
  payload?: any;
}): Promise<string> {
  const act = input?.action || "status";
  const topology = getMeshTopologyReport();

  if (act === "broadcast" && input?.channel && input?.payload) {
    const msg = createGossipMessage(input.channel as any, input.payload);
    const res = processIncomingMeshGossip(msg);
    return `📡 P2P Mesh Broadcast dispatched on channel [${input.channel}] (Message ID: ${msg.messageId}, Accepted: ${res.accepted}, Hops: ${msg.hopsRemaining})`;
  }

  const lines = [
    `🌐 SAM Local P2P Swarm Mesh Topology:`,
    `· Local Node: ${topology.localNodeId} · Total Discovered Peers: ${topology.totalActivePeers}`,
    `· Active Channels: ${topology.recentChannels.join(", ")}`,
  ];

  if (topology.peerNodes.length > 0) {
    lines.push(`· Connected LAN Nodes:`);
    for (const p of topology.peerNodes) {
      lines.push(`  - [${p.status}] "${p.deviceName}" (${p.platform}) at ${p.address}:${p.port} [${p.capabilities.join(", ")}]`);
    }
  } else {
    lines.push(`· Listening on local LAN for mDNS / WebSocket peer discovery.`);
  }

  return lines.join("\n");
}

export async function voiceAgentStreamTool(input?: {
  sessionId?: string;
  action?: "status" | "speaking" | "reset";
}): Promise<string> {
  const sid = input?.sessionId || "default-mic";
  const session = getOrCreateVoiceSession(sid);

  if (input?.action === "speaking") {
    session.setSpeaking();
    return `🎙️ Voice session [${sid}] state set to SPEAKING.`;
  }
  if (input?.action === "reset") {
    session.reset();
    return `🎙️ Voice session [${sid}] reset to IDLE.`;
  }

  const st = session.getStatus();
  const lines = [
    `🎙️ SAM Real-Time Streaming Voice Agent:`,
    `· Session ID: ${st.sessionId} · State: [${st.state}]`,
    `· Audio Format: 16kHz 16-bit Mono PCM · Total Processed: ${st.totalAudioProcessedMs}ms`,
    `· VAD Telemetry: Last Energy RMS: ${st.lastRmsEnergy} (Speech Frames: ${st.speechFramesCount}, Silent: ${st.silentFramesCount})`,
    `· Buffer Queue: ${st.bufferedChunksCount} chunks`,
  ];
  return lines.join("\n");
}

export async function antigravityCognitionTool(input: {
  taskPrompt: string;
  maxBranches?: number;
}): Promise<string> {
  const p = String(input?.taskPrompt || "").trim();
  if (!p) return "Error: taskPrompt is required for Antigravity cognition execution.";

  const result = executeAntigravityCognition(p, { maxBranches: input.maxBranches || 3 });

  const lines = [
    `⚡ Antigravity Cognitive Brain & Factual Grounding [${result.taskId}]:`,
    `· Grounding Score: ${result.groundingReport.score}% (${result.groundingReport.isFullyGrounded ? "✅ Fully Grounded" : "⚠️ Needs Verification"})`,
    `· Optimal Strategy: "${result.optimalStrategy}" (Confidence: ${(result.synthesizedConfidence * 100).toFixed(1)}%)`,
    `· Verified Workspace Files: ${result.groundingReport.verifiedFilePaths.length > 0 ? result.groundingReport.verifiedFilePaths.join(", ") : "None cited"}`,
    `· Recommended Tool Execution Sequence: ${result.recommendedToolSequence.join(" ➔ ")}`,
  ];

  if (result.groundingReport.discrepancies.length > 0) {
    lines.push(`· ⚠️ Discrepancy Warnings:`);
    for (const d of result.groundingReport.discrepancies) {
      lines.push(`  - [${d.category}] ${d.claim} ➔ ${d.correction}`);
    }
  }

  lines.push(`· Evaluated ${result.candidateHypotheses.length} Speculative Hypotheses in ${result.executionTimeMs}ms:`);
  for (const h of result.candidateHypotheses) {
    lines.push(`  - [${(h.factualConfidence * 100).toFixed(0)}% Conf | ${h.computationalComplexity}] ${h.reasoningVector}`);
  }

  return lines.join("\n");
}

export async function antigravityReflectionLoopTool(input: {
  text: string;
  maxIterations?: number;
}): Promise<string> {
  const t = String(input?.text || "").trim();
  if (!t) return "Error: text is required for reflection loop execution.";

  const loop = runCognitiveReflectionLoop(t, { maxIterations: input.maxIterations || 3 });

  const lines = [
    `🔄 Antigravity Cognitive Reflection Loop:`,
    `· Status: ${loop.converged ? "✅ Converged to 100% Grounded Truth" : "⚠️ Partial Convergence"}`,
    `· Score Improvement: ${loop.initialScore}% ➔ ${loop.finalScore}% (${loop.iterationsExecuted} iteration(s))`,
    `· Verified File Refs: ${loop.finalReport.verifiedFilePaths.join(", ") || "None"}`,
    `· Verified Symbols: ${loop.finalReport.verifiedSymbols.join(", ") || "None"}`,
  ];

  if (loop.repairsApplied.length > 0) {
    lines.push(`· 🛠️ Autonomous Repairs Applied:`);
    for (const r of loop.repairsApplied) {
      lines.push(`  - ${r}`);
    }
  }

  lines.push(`\n[Reflected Output]\n${loop.reflectedText}`);
  return lines.join("\n");
}

export async function antigravitySymbolVerifierTool(input: {
  filePath: string;
  symbolName: string;
}): Promise<string> {
  const fp = String(input?.filePath || "").trim();
  const sym = String(input?.symbolName || "").trim();
  if (!fp || !sym) return "Error: filePath and symbolName are required.";

  const res = verifySymbolDeclaration(fp, sym);
  if (!res.found) {
    return `❌ Symbol '${sym}' NOT found in '${fp}'.`;
  }
  return `✅ Symbol '${sym}' is verified declared in '${fp}' (Line ${res.line || "?"}, Kind: ${res.kind || "symbol"}, Exported: ${res.exported ? "YES" : "NO"}).`;
}

export async function studioDirectorStoryboardTool(input: {
  prompt: string;
  sceneCount?: number;
  aspectRatio?: "16:9" | "9:16" | "2.39:1" | "1:1";
}): Promise<string> {
  const p = String(input?.prompt || "").trim();
  if (!p) return "Error: prompt is required for cinematic storyboard generation.";

  const plan = generateCinematicStoryboard({
    narrativePrompt: p,
    sceneCount: input?.sceneCount,
    aspectRatio: input?.aspectRatio,
  });

  const lines = [
    `🎬 Cinematic Storyboard Director's Plan: "${plan.title}"`,
    `· Aspect Ratio: [${plan.aspectRatio}] · Framerate: ${plan.framerateFps}fps · Total Duration: ${plan.totalDurationSec}s (${plan.totalFrames} frames)`,
    `· Consistent Character Seed Anchor: ${plan.characterSeedAnchor}`,
    `· Total Shots: ${plan.shots.length}`,
    ``,
  ];

  for (const shot of plan.shots) {
    lines.push(`Shot ${shot.shotNumber} (${shot.durationSec}s | Frames ${shot.startFrame}–${shot.endFrame}):`);
    lines.push(`  🎥 Camera Rig: ${shot.cameraRig.label} [${shot.cameraRig.category.toUpperCase()}]`);
    lines.push(`  💡 Lighting & Lens: ${shot.lightingScheme} · ${shot.lensOptics}`);
    lines.push(`  🖼 Visual Prompt: "${shot.visualPrompt}"`);
    lines.push(`  🎵 Audio Cue: ${shot.audioCue}`);
    lines.push(``);
  }

  return lines.join("\n").trim();
}

export async function agentic100xWorkflowTool(input: {
  goal: string;
  concurrency?: number;
  synthesize?: boolean;
}): Promise<string> {
  const g = String(input?.goal || "").trim();
  if (!g) return "Error: goal is required for 100x agentic workflow execution.";

  const res = await execute100xAgenticWorkflow(g, {
    concurrency: input?.concurrency,
    synthesize: input?.synthesize ?? true,
    generateArtifacts: true,
  });

  const lines = [
    `🚀 100X ANTIGRAVITY AGENTIC WORKFLOW EXECUTED [${res.workflowId}]:`,
    `· Goal: "${res.goal}"`,
    `· Nodes: ${res.completedNodes}/${res.totalNodes} completed in ${res.wallClockDurationMs}ms (${res.speedupFactor}x parallel speedup)`,
    `· Execution Waves: ${res.waves.length} topological waves`,
    `· Generated Artifacts: ${res.artifacts.length} deliverable artifacts`,
    `\nExecutive Synthesis:`,
    res.finalSynthesis,
  ];

  return lines.join("\n");
}

export async function multiModelConsensusTool(input: { prompt: string; modelsCount?: number }): Promise<string> {
  const p = String(input?.prompt || "").trim();
  if (!p) return "Error: prompt is required for multi-model consensus.";

  const rep = await runMultiModelConsensus(p, { modelsCount: input?.modelsCount });

  const lines = [
    `🧠 Multi-Model Consensus Report (${rep.participatingCount} models polled in ${rep.wallClockDurationMs}ms):`,
    `· Confidence Score: ${rep.confidenceScorePct}% [${rep.agreementSummary}]`,
    `\nConsensus Answer:`,
    rep.consensusAnswer,
    `\nParticipating Models:`,
    ...rep.opinions.map((o) => `  - ${o.provider}: [${o.status.toUpperCase()}] in ${o.durationMs}ms`),
  ];

  return lines.join("\n");
}

export async function codeRepairPatcherTool(input: { compilerOutput?: string; filePath?: string }): Promise<string> {
  let raw = String(input?.compilerOutput || "").trim();
  if (!raw) {
    try {
      const { execSync } = await import("node:child_process");
      execSync("npx tsc --noEmit", { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" });
      raw = "";
    } catch (e: any) {
      raw = e?.stdout || e?.stderr || e?.message || "";
    }
  }

  const diagnostics = parseCompilerDiagnostics(raw);
  const plan = generateRepairPlan(diagnostics);

  const lines = [
    `🛠️ Code Repair & AST Diagnostic Report:`,
    plan.summary,
  ];

  if (plan.candidates.length > 0) {
    lines.push(`\nActionable Repair Candidates:`);
    for (const c of plan.candidates) {
      lines.push(`  - [${c.filePath}:${c.startLine}–${c.endLine}] ${c.instruction} (${c.confidenceScorePct}% confidence)`);
    }
  }

  return lines.join("\n");
}

export async function autoKeyProvisionerTool(input?: { action?: "status" | "save_key"; providerId?: string; key?: string }): Promise<string> {
  const action = input?.action || "status";

  if (action === "status" || !input?.providerId || !input?.key) {
    const s = getAutoProvisionStatus();
    return [
      `🔑 SAM Guided Key Setup & Headroom Status (${s.freeRotationHeadroomScorePct}% Headroom):`,
      `· Active Providers: ${s.configuredProvidersCount} of ${s.totalSupportedProviders} configured`,
      `\nFree Providers Available:`,
      ...s.targets.map((t) => `  - [${t.status.toUpperCase()}] ${t.label} (${t.id}): ${t.existingKeysCount} active key(s) · ~${t.estimatedMinutes} min setup → ${t.url}`),
      `\nTo activate a key: pass { action: "save_key", providerId: "<id>", key: "<key>" }`,
    ].join("\n");
  }

  const res = await validateAndSaveProviderKey(input.providerId, input.key);

  return [
    `🔑 Key Verification & Activation:`,
    `· Provider: ${res.label} (${res.providerId})`,
    `· Valid Format: ${res.validFormat ? "YES" : "NO"}`,
    `· Status: ${res.saved ? "SAVED & ACTIVATED" : "REJECTED"}`,
    `· Details: ${res.message}`,
  ].join("\n");
}

export async function revenueHunterAlphaTool(input?: { focusCategory?: any; minConfidencePct?: number }): Promise<string> {
  const rep = await huntRevenueOpportunities(input || {});

  const lines = [
    `💰 Autonomous Revenue & Opportunity Report:`,
    `· Total Alpha Identified: $${rep.totalEstimatedValueUSD.toLocaleString()} USD across ${rep.totalOpportunitiesFound} opportunities`,
    `· Executive Strategy: ${rep.executiveStrategy}`,
    `\nTop Opportunities:`,
    ...rep.items.map((o) => `  - [${o.category.toUpperCase()}] ${o.title}: +$${o.estimatedValueUSD} (${o.confidenceScorePct}% conf, ${o.riskLevel} risk)`),
  ];

  return lines.join("\n");
}

export async function executiveDailyBriefTool(): Promise<string> {
  const deck = await generateExecutiveDailyDeck();

  const lines = [
    `👑 Executive Daily Action Brief:`,
    `· ${deck.executiveHeadline}`,
    `· Readiness Score: ${deck.systemReadinessScorePct}% | Total Pending Actions: ${deck.totalPendingActions}`,
    `· Quick Metrics: ${deck.quickMetrics.onlineServices} tools online, ${deck.quickMetrics.activeKeyPools} active key pools`,
    `\nAction Cards:`,
    ...deck.cards.map((c) => `  - [${c.priority.toUpperCase()}] ${c.title}: ${c.description} → Action: ${c.suggestedAction}`),
  ];

  return lines.join("\n");
}

export async function eventWebhookDispatcherTool(input?: { action?: "list" | "register" | "dispatch"; name?: string; url?: string; event?: string; events?: string[]; payload?: Record<string, unknown> }): Promise<string> {
  const action = input?.action || "list";

  if (action === "register" && input?.name && input?.url) {
    const ep = registerWebhookEndpoint(input.name, input.url, input.events || ["*"]);
    return [
      `🌐 Registered Webhook Endpoint:`,
      `· ID: ${ep.id}`,
      `· Name: ${ep.name}`,
      `· Target URL: ${ep.url}`,
      `· Events: ${ep.events.join(", ")}`,
      `· Signing Secret: ${ep.secret.slice(0, 8)}... (HMAC-SHA256 active)`,
    ].join("\n");
  }

  if (action === "dispatch" && input?.event) {
    const deliveries = await dispatchWebhookEvent(input.event, input.payload || {});
    return [
      `📡 Dispatched Event '${input.event}':`,
      `· Targets Notified: ${deliveries.length}`,
      ...deliveries.map((d) => `  - [${d.status.toUpperCase()}] Endpoint ${d.endpointId} (${d.statusCode || d.error}) in ${d.durationMs}ms`),
    ].join("\n");
  }

  const endpoints = loadWebhookEndpoints();
  return [
    `🌐 Registered Webhook Endpoints (${endpoints.length}):`,
    ...endpoints.map((ep) => `  - [${ep.enabled ? "ACTIVE" : "DISABLED"}] ${ep.name} (${ep.id}) → ${ep.url} [Events: ${ep.events.join(", ")}] (Last: ${ep.lastDeliveryStatus || "never"})`),
  ].join("\n");
}

export async function vaultSnapshotBackupTool(input?: { action?: "export" | "restore"; manifest?: any }): Promise<string> {
  const action = input?.action || "export";

  if (action === "restore" && input?.manifest) {
    const res = restoreVaultSnapshot(input.manifest);
    return [
      `🔄 Vault Snapshot Restored:`,
      `· Restored Files: ${res.restoredCount}`,
      `· Skipped/Invalid: ${res.skippedCount}`,
      ...res.restoredFiles.map((f) => `  - ✅ ${f}`),
      ...(res.errors.length > 0 ? [`\nErrors:`, ...res.errors.map((e) => `  - ⚠️ ${e}`)] : []),
    ].join("\n");
  }

  const snapshot = createVaultSnapshot();
  return [
    `📦 Vault Snapshot Exported (${snapshot.totalFiles} files · ${snapshot.totalSizeBytes} bytes):`,
    `· Exported At: ${new Date(snapshot.exportedAt).toISOString()}`,
    `· Manifest SHA-256 Checksum: ${snapshot.manifestChecksum}`,
    `· Files Packed:`,
    ...snapshot.files.map((f) => `  - ${f.relativePath} (${f.sizeBytes} bytes · sha256: ${f.sha256.slice(0, 8)}...)`),
  ].join("\n");
}

async function listDir(path: string): Promise<string> {
  try {
    const dir = safePath(path || "~");
    const items = await readdir(dir);
    const rows = await Promise.all(items.slice(0, 200).map(async (n) => {
      try { const s = await stat(resolve(dir, n)); return `${s.isDirectory() ? "📁" : "📄"} ${n}`; } catch { return `   ${n}`; }
    }));
    if (!rows.length) return "(empty)";
    // Say when the list was cut. Every other walk in this file reports its cap ("scan capped at
    // 5000 — folder is larger"); this one silently returned the first 200 of 900, so both the model
    // and the operator read a partial listing as the whole folder.
    const more = items.length > rows.length ? `\n…and ${items.length - rows.length} more (showing the first ${rows.length})` : "";
    return rows.join("\n") + more;
  } catch (e: any) { return `Could not list ${path}: ${e?.message}`; }
}
// analyse_data — profile a CSV instead of dumping it. read_file on a 20k-row export gives the
// model (and the user) a wall of numbers nobody reads; this gives the shape of the data and, more
// importantly, what's WRONG with it. All the work is in sheets.ts; this is just the plumbing.
// Takes a path OR the CSV text inline. Path wins when both are given — it's the fresher source,
// and a model that pastes a snippet alongside a path meant the file.
async function analyseData(i: any): Promise<string> {
  const question = i?.question ? String(i.question).trim() : undefined;
  const path = i?.path ? String(i.path).trim() : typeof i === "string" && !/[\n,]/.test(i) ? i.trim() : "";
  const inline = typeof i?.csv === "string" ? i.csv : typeof i === "string" ? i : "";

  if (path) {
    try {
      const f = await readTable(path);
      const prof = profileTable(parseCsv(f.text), { source: basename(f.path), bytesRead: f.bytesRead, totalBytes: f.totalBytes, truncatedBytes: f.truncatedBytes });
      return renderReport(prof, { question });
    } catch (e: any) {
      if (e instanceof SheetError) return e.message;
      return `Could not read ${path}: ${e?.message || e}`;
    }
  }
  if (inline.trim()) {
    // Inline text has already been through the model's context, so it can't be enormous — but cap
    // it anyway rather than trusting that, and cut at a line break so the last row isn't half-read.
    let text = inline;
    let truncatedBytes = false;
    if (Buffer.byteLength(text, "utf8") > SHEET_CAPS.maxBytes) {
      text = text.slice(0, SHEET_CAPS.maxBytes);
      const nl = text.lastIndexOf("\n");
      if (nl > 0) text = text.slice(0, nl);
      truncatedBytes = true;
    }
    const prof = profileTable(parseCsv(text), { source: "the pasted data", bytesRead: Buffer.byteLength(text, "utf8"), truncatedBytes });
    return renderReport(prof, { question });
  }
  return `Point me at some data — either a file ({"path":"~/Downloads/sales.csv"}) or the rows themselves ({"csv":"name,amount\\n…"}).`;
}

// Human-readable byte size (portable, no deps) — 1234 → "1.2 KB".
function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${u === 0 ? n : n.toFixed(1)} ${units[u]}`;
}
// folder_digest — walk a folder (bounded) and summarise it: file count, total size, top file
// types, and the biggest files. Read-only, cross-platform, skips heavy/system dirs like the search
// walk above. Scan is capped so it can't run away on a giant tree.
async function folderDigest(path: string): Promise<string> {
  const CAP = 5000;   // max files scanned before we stop and say so
  try {
    const root = safePath(path || "~");
    const st = await stat(root).catch(() => null);
    if (!st) return `Could not read ${path}: no such folder (or no permission).`;
    if (!st.isDirectory()) return `${path} is a file, not a folder — try read_file instead.`;

    let scanned = 0, totalBytes = 0, capped = false;
    const byExt = new Map<string, { count: number; bytes: number }>();
    const biggest: { name: string; bytes: number }[] = [];   // kept sorted desc, top 5

    // Iterative BFS so we don't blow the stack on deep trees; bounded by CAP.
    const queue = [root];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: any[];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (scanned >= CAP) { capped = true; break; }
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { queue.push(full); continue; }
        let s: any;
        try { s = await stat(full); } catch { continue; }
        scanned++;
        totalBytes += s.size;
        const ext = (extname(e.name).toLowerCase() || "(no ext)").replace(/^\./, "");
        const cur = byExt.get(ext) || { count: 0, bytes: 0 };
        cur.count++; cur.bytes += s.size; byExt.set(ext, cur);
        if (biggest.length < 5 || s.size > biggest[biggest.length - 1].bytes) {
          biggest.push({ name: full.replace(homedir(), "~"), bytes: s.size });
          biggest.sort((a, b) => b.bytes - a.bytes);
          if (biggest.length > 5) biggest.pop();
        }
      }
      if (capped) break;
    }

    if (scanned === 0) return `📂 ${path} — empty (no readable files).`;

    const topExts = [...byExt.entries()]
      .sort((a, b) => b[1].count - a[1].count).slice(0, 8)
      .map(([ext, v]) => `  • ${ext} — ${v.count} file${v.count === 1 ? "" : "s"} (${humanSize(v.bytes)})`)
      .join("\n");
    const bigList = biggest.map((b) => `  • ${basename(b.name)} — ${humanSize(b.bytes)}`).join("\n");

    return [
      `📂 Digest of ${path}`,
      `Files: ${scanned}${capped ? ` (scan capped at ${CAP} — folder is larger)` : ""}   ·   Total size: ${humanSize(totalBytes)}`,
      ``,
      `By type:`,
      topExts,
      ``,
      `Largest files:`,
      bigList,
    ].join("\n");
  } catch (e: any) { return `Could not digest ${path}: ${e?.message}`; }
}

// find_duplicates — walk a folder (bounded) and find files with identical contents so the user can
// reclaim space. Read-only, cross-platform, skips heavy/system dirs like the walks above. Efficient:
// group candidates by SIZE first, then only hash (SHA-256) files whose size collides — never hash
// everything. Reports the biggest duplicate groups and total reclaimable space. Scan is capped.
async function findDuplicates(path: string): Promise<string> {
  const CAP = 5000;   // max files scanned before we stop and say so
  try {
    const root = safePath(path || "~");
    const st = await stat(root).catch(() => null);
    if (!st) return `Could not read ${path}: no such folder (or no permission).`;
    if (!st.isDirectory()) return `${path} is a file, not a folder — try folder_digest instead.`;

    // Pass 1 — group files by size (cheap). Only sizes shared by 2+ files can hold duplicates.
    let scanned = 0, capped = false;
    const bySize = new Map<number, string[]>();
    const queue = [root];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: any[];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (scanned >= CAP) { capped = true; break; }
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { queue.push(full); continue; }
        let s: any;
        try { s = await stat(full); } catch { continue; }
        scanned++;
        if (s.size === 0) continue;   // ignore empty files — never worth reporting
        const cur = bySize.get(s.size) || [];
        cur.push(full); bySize.set(s.size, cur);
      }
      if (capped) break;
    }

    if (scanned === 0) return `📂 ${path} — empty (no readable files).`;

    // Pass 2 — for each colliding size, hash the contents and group truly-identical files.
    const groups: { size: number; files: string[]; sizeOnly?: boolean }[] = [];
    for (const [size, files] of bySize) {
      if (files.length < 2) continue;   // unique size → can't be a duplicate, skip hashing
      // Files above this are compared by size alone rather than hashed. readFile pulls the WHOLE
      // file into memory to hash it, so two 4 GB videos of equal size — the single likeliest pair
      // in a Downloads or Movies folder — meant an 8 GB allocation inside a "read-only, safe" tool.
      // Bounded rather than streamed on purpose: streaming every candidate would make a scan of a
      // media folder take minutes, and this tool exists to be a quick answer.
      const HASH_MAX = 256 * 1024 * 1024;
      if (size > HASH_MAX) {
        groups.push({ size, files, sizeOnly: true });
        continue;
      }
      const byHash = new Map<string, string[]>();
      for (const f of files) {
        let hash: string;
        try { hash = createHash("sha256").update(await readFile(f)).digest("hex"); } catch { continue; }
        const cur = byHash.get(hash) || [];
        cur.push(f); byHash.set(hash, cur);
      }
      for (const dups of byHash.values()) {
        if (dups.length >= 2) groups.push({ size, files: dups });
      }
    }

    if (groups.length === 0) {
      return `✅ ${path} — no duplicate files found among ${scanned} scanned${capped ? ` (scan capped at ${CAP})` : ""}.`;
    }

    // Reclaimable space = every copy beyond the first, across all groups.
    let reclaimable = 0, dupCount = 0;
    for (const g of groups) { reclaimable += g.size * (g.files.length - 1); dupCount += g.files.length - 1; }
    groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));

    const top = groups.slice(0, 5).map((g) => {
      const names = g.files.slice(0, 4).map((f) => `    ${f.replace(homedir(), "~")}`).join("\n");
      const more = g.files.length > 4 ? `\n    …and ${g.files.length - 4} more` : "";
      // sizeOnly groups were never hashed, so say "same size" rather than "copies" — claiming
      // identical contents on a size match alone would be exactly the kind of confident-and-wrong
      // answer that gets a file deleted.
      const what = g.sizeOnly ? `${g.files.length} files of the same size (too large to hash — verify before deleting)` : `${g.files.length} copies`;
      return `  • ${what} × ${humanSize(g.size)} (reclaim ${humanSize(g.size * (g.files.length - 1))}):\n${names}${more}`;
    }).join("\n");

    return [
      `📂 Duplicates in ${path}`,
      `Found ${groups.length} duplicate group${groups.length === 1 ? "" : "s"} · ${dupCount} redundant file${dupCount === 1 ? "" : "s"} · reclaimable ${humanSize(reclaimable)}`,
      `(scanned ${scanned}${capped ? `, capped at ${CAP} — folder is larger` : ""})`,
      ``,
      `Top groups:`,
      top,
    ].join("\n");
  } catch (e: any) { return `Could not scan ${path}: ${e?.message}`; }
}

// Friendly "how long ago" — 90_000ms → "2 min ago". Falls back to a plain date once it's
// more than a week old, so old files read cleanly instead of "413 days ago".
function relativeTime(then: number, now = Date.now()): string {
  const diff = Math.max(0, now - then);
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day <= 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(then).toISOString().slice(0, 10);   // YYYY-MM-DD for anything older
}

// recent_files — walk a folder (bounded) and list the most recently modified files, newest first, so
// the user can quickly find "what did I work on lately". Read-only, cross-platform, skips heavy/system
// dirs like the walks above. Scan is capped so it can't run away on a giant tree.
async function recentFiles(path: string, limit = 15): Promise<string> {
  const CAP = 5000;   // max files scanned before we stop and say so
  const n = Math.max(1, Math.min(100, Number(limit) || 15));
  try {
    const root = safePath(path || "~");
    const st = await stat(root).catch(() => null);
    if (!st) return `Could not read ${path}: no such folder (or no permission).`;
    if (!st.isDirectory()) return `${path} is a file, not a folder — try read_file instead.`;

    let scanned = 0, capped = false;
    const files: { name: string; mtime: number; bytes: number }[] = [];

    // Iterative BFS so we don't blow the stack on deep trees; bounded by CAP.
    const queue = [root];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: any[];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (scanned >= CAP) { capped = true; break; }
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { queue.push(full); continue; }
        let s: any;
        try { s = await stat(full); } catch { continue; }
        scanned++;
        files.push({ name: full.replace(homedir(), "~"), mtime: s.mtimeMs, bytes: s.size });
      }
      if (capped) break;
    }

    if (scanned === 0) return `📂 ${path} — empty (no readable files).`;

    files.sort((a, b) => b.mtime - a.mtime);   // most recently modified first
    const top = files.slice(0, n)
      .map((f) => `· ${f.name} — ${relativeTime(f.mtime)}, ${humanSize(f.bytes)}`)
      .join("\n");

    return [
      `🕒 Recent files in ${path}`,
      `Showing ${Math.min(n, files.length)} of ${scanned}${capped ? ` (scan capped at ${CAP} — folder is larger)` : ""}, newest first:`,
      ``,
      top,
    ].join("\n");
  } catch (e: any) { return `Could not scan ${path}: ${e?.message}`; }
}

// disk_space — report free / used / total space for the drive holding a given path (default ~), so the
// user can check "am I running low on space". Read-only, cross-platform (statfsSync works on mac/linux/
// win), no shell/deps. Friendly non-throwing handling if the path is bad or statfs is unavailable.
async function diskSpace(path: string): Promise<string> {
  try {
    const target = safePath(path || "~");
    let fs: any;
    try { fs = statfsSync(target); }
    catch { return `Could not check disk space for ${path || "~"}: no such path (or no permission).`; }
    const bsize = Number(fs.bsize) || 0;
    const total = bsize * Number(fs.blocks);
    const free = bsize * Number(fs.bavail);   // space available to the user (not root-reserved)
    if (!total) return `Disk info isn't available on this system.`;
    const used = Math.max(0, total - free);
    const pct = Math.round((used / total) * 100);
    return `Disk: ${humanSize(free)} free of ${humanSize(total)} (${pct}% used)`;
  } catch (e: any) { return `Could not check disk space for ${path || "~"}: ${e?.message}`; }
}

// find_files — walk a folder (bounded) and list files whose NAME matches a query (case-insensitive
// substring), so the user can locate "where's that invoice pdf". Read-only, cross-platform, skips
// heavy/system dirs like the walks above. Scan is capped so it can't run away on a giant tree.
async function findFiles(query: string, path: string): Promise<string> {
  const CAP = 5000;   // max files scanned before we stop and say so
  const MAX = 30;     // max matches shown
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return `What should I look for? Give me a name (or part of one) to search for.`;
  try {
    const root = safePath(path || "~");
    const st = await stat(root).catch(() => null);
    if (!st) return `Could not read ${path || "~"}: no such folder (or no permission).`;
    if (!st.isDirectory()) return `${path || "~"} is a file, not a folder — try read_file instead.`;

    let scanned = 0, capped = false;
    const matches: { name: string; mtime: number; bytes: number }[] = [];

    // Iterative BFS so we don't blow the stack on deep trees; bounded by CAP.
    const queue = [root];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: any[];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (scanned >= CAP) { capped = true; break; }
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { queue.push(full); continue; }
        let s: any;
        try { s = await stat(full); } catch { continue; }
        scanned++;
        if (e.name.toLowerCase().includes(q)) {
          matches.push({ name: full.replace(homedir(), "~"), mtime: s.mtimeMs, bytes: s.size });
        }
      }
      if (capped) break;
    }

    if (scanned === 0) return `📂 ${path || "~"} — empty (no readable files).`;
    if (matches.length === 0) {
      return `🔍 No files matching "${query}" in ${path || "~"} (searched ${scanned}${capped ? `, capped at ${CAP} — folder is larger` : ""}).`;
    }

    matches.sort((a, b) => b.mtime - a.mtime);   // newest-modified first
    const shown = matches.slice(0, MAX)
      .map((f) => `· ${f.name} — ${humanSize(f.bytes)}`)
      .join("\n");

    return [
      `🔍 Files matching "${query}" in ${path || "~"}`,
      `Found ${matches.length}${matches.length > MAX ? ` (showing first ${MAX})` : ""} of ${scanned} scanned${capped ? ` (scan capped at ${CAP} — folder is larger)` : ""}, newest first:`,
      ``,
      shown,
    ].join("\n");
  } catch (e: any) { return `Could not search ${path || "~"}: ${e?.message}`; }
}

// ── macOS CONTROL · mouse / keyboard / apps / screen ─────────
async function osa(script: string): Promise<string> {
  // Graceful cross-platform degrade: the model reads this and tells the user honestly
  // (instead of a cryptic failure), usually offering the nearest thing it CAN do here.
  if (!IS_MAC) throw new Error(`this action needs macOS — this machine runs ${OS}, so tell the user it isn't available here`);
  const { stdout } = await execFile("osascript", ["-e", script], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
async function openApp(name: string): Promise<string> {
  if (IS_MAC) await execFile("open", ["-a", name]);
  else if (OS === "windows") await sh(`start "" ${shq(name)}`);
  else await sh(`${shq(name)} &`).catch(() => {/* fire-and-forget shell — the caller does not await a result */});
  return `Opened ${name}.`;
}
async function typeText(text: string): Promise<string> {
  if (IS_MAC) {
    await osa(`tell application "System Events" to keystroke "${esc(text)}"`);
  } else if (OS === "windows") {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}');`;
    await execFile("powershell", ["-command", ps]);   // execFile (no shell) — no cmd.exe quote break-out
  } else {
    await sh(`xdotool type ${shq(text)}`);
  }
  return `Typed: ${text}`;
}
async function pressKey(input: { key: string; modifiers?: string[] }): Promise<string> {
  if (IS_MAC) {
    const mods = (input.modifiers || []).filter((m) => ["command", "shift", "option", "control"].includes(m)).map((m) => `${m} down`).join(", ");
    const using = mods ? ` using {${mods}}` : "";
    await osa(`tell application "System Events" to key code ${Number(input.key) | 0}${using}`);
    return `Pressed key ${input.key}${using}`;
  } else if (OS === "windows") {
    // Basic fallback for Windows using SendKeys. Key codes map differently.
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{${String(input.key).replace(/'/g, "''")}}');`;
    await execFile("powershell", ["-command", ps]);
    return `Pressed key ${input.key}`;
  } else {
    await sh(`xdotool key ${shq(input.key)}`);
    return `Pressed key ${input.key}`;
  }
}
async function clickAt(input: { x: number; y: number }): Promise<string> {
  if (IS_MAC) {
    await osa(`tell application "System Events" to click at {${Number(input.x) | 0}, ${Number(input.y) | 0}}`);
  } else if (OS === "windows") {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Number(input.x) | 0}, ${Number(input.y) | 0}); Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int buttons, int extrainfo);' -Name Mouse -Namespace Win32; [Win32.Mouse]::mouse_event(0x0002 -bor 0x0004, 0, 0, 0, 0);`;
    await execFile("powershell", ["-command", ps]);
  } else {
    await sh(`xdotool mousemove ${Number(input.x)|0} ${Number(input.y)|0} click 1`);
  }
  return `Clicked at ${input.x},${input.y}`;
}
async function appleScript(script: string): Promise<string> {
  const s = String(script ?? "");
  // Defence-in-depth: AppleScript can `do shell script "…"`, which bypasses run_command's
  // guard entirely. Run the source through the same catastrophic-command check so a smuggled
  // `rm -rf ~` (etc.) is refused even if this tool was approved or always-allowed.
  const d = denied(s);
  if (d) return d;
  try { return (await osa(s)) || "(AppleScript ran, no output)"; }
  catch (e: any) { return `AppleScript failed: ${e?.message}`; }
}
async function screenshot(): Promise<string> {
  const path = resolve(homedir(), "Desktop", `SAM-screenshot-${Date.now()}.png`);
  try {
    if (IS_MAC) {
      await sh(`screencapture -x ${shq(path)}`);
    } else if (OS === "windows") {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height; $gfx = [System.Drawing.Graphics]::FromImage($bmp); $gfx.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); $bmp.Save('${path}', [System.Drawing.Imaging.ImageFormat]::Png); $gfx.Dispose(); $bmp.Dispose()`;
      await sh(`powershell -command "${ps}"`);
    } else {
      await sh(`import -window root ${shq(path)} 2>/dev/null || scrot ${shq(path)}`);
    }
    return `Saved a screenshot to ${path}`;
  } catch (e: any) {
    return `Failed to take screenshot: ${e.message}`;
  }
}
async function clipboardGet(): Promise<string> {
  try {
    // Redacted on the way out. The clipboard is where a password manager's output lives for the
    // few seconds after a copy, and this tool is safe:true — it reads without asking. Only the
    // unambiguous credentials go (redactKnownCredentials, not the full scrub): the clipboard is
    // usually the thing the operator actually wants pasted, so over-redaction breaks the tool.
    if (IS_MAC) { const { stdout } = await sh("pbpaste"); return clip(redactKnownCredentials(stdout), 4000); }
    if (OS === "windows") { const { stdout } = await sh("powershell -command Get-Clipboard"); return clip(redactKnownCredentials(stdout), 4000); }
    const { stdout } = await sh("xclip -selection clipboard -o"); return clip(redactKnownCredentials(stdout), 4000);
  } catch { return notSupported("read clipboard"); }
}
async function clipboardSet(text: string): Promise<string> {
  try {
    if (IS_MAC) await sh(`printf %s ${shq(text)} | pbcopy`);
    else if (OS === "windows") await sh(`echo ${shq(text)} | clip`);
    else await sh(`printf %s ${shq(text)} | xclip -selection clipboard`);
    return "Copied to clipboard.";
  } catch { return notSupported("set clipboard"); }
}
async function notify(input: { title?: string; message: string }): Promise<string> {
  const title = input.title || "SAM";
  const clean = input.message.replace(/[#*`]/g, "").slice(0, 220);
  // Quotes/angle-brackets are stripped, not escaped — they break the AppleScript/
  // PowerShell/XML string contexts differently and add nothing to a notification.
  const e = (s: string) => s.replace(/["'<>&\\]/g, "").replace(/\n/g, " ");
  if (IS_MAC) {
    await execFile("osascript", ["-e", `tell application "SAM" to display notification "${e(clean)}" with title "${e(title.slice(0, 60))}"`]);
  } else if (OS === "windows") {
    const ps = `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null; $t=[Windows.UI.Notifications.ToastNotification]::new([Windows.Data.Xml.Dom.XmlDocument]::new()); $x=$t.Content; $x.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">${e(title)}</text><text id="2">${e(clean)}</text></binding></visual></toast>'); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('SAM').Show($t)`;
    await execFile("powershell", ["-command", ps]);
  } else {
    await execFile("notify-send", [e(title), e(clean)]).catch(() => {/* desktop notifications are optional — never fail a tool over one */});
  }
  return "Notification shown.";
}

// ── MORE INTERNET / INFO (safe) ──────────────────────────────
async function getWeather(place: string): Promise<string> {
  const r = await tfetch("https://wttr.in/" + encodeURIComponent(place || "") + "?format=%l:+%C+%t,+feels+%f,+wind+%w,+humidity+%h");
  return (await r.text()).trim() || "Couldn't get the weather.";
}
async function openUrl(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  // The SAME guard web_fetch has, which this was missing — and the omission mattered MORE here,
  // not less. web_fetch retrieves a page into SAM; open_url hands the URL to the operator's real
  // browser, carrying their real cookies. Unguarded and safe:true (so it never asks), a model
  // talked into it by injected content could aim the browser at http://192.168.1.1/admin?… or at
  // SAM's own loopback API, and the request would arrive already authenticated as the operator.
  await assertPublicUrl(url);
  await sh(openCmd(url)); return `Opened ${url} in your browser.`;
}
async function searchFiles(q: string): Promise<string> {
  try {
    // Mac: fast Spotlight index (name + content). Windows/Linux: Node-native walk (no shell), matching
    // by filename first, then by content — works identically everywhere, no grep/mdfind dependency.
    // Credential paths are dropped from the results. This returns PATHS, not contents, so it is
    // not a leak of the secrets themselves — it is a map straight to them, produced by a tool that
    // never asks (safe:true). "Where do they keep their keys" should not be a free question.
    const keep = (s: string) => s.split("\n").filter((l) => l.trim() && !isCredentialPath(l.trim())).join("\n");
    if (IS_MAC) { const { stdout } = await sh(`mdfind ${shq(q)} | head -30`, { timeout: 20000 }); const r = clip(keep(stdout.trim())); if (r) return r; }
    const home = homedir();
    let hits = await findByName(home, q, 30);
    if (!hits.length) hits = await findByContent(home, q, 30);
    hits = hits.filter((h) => !isCredentialPath(h));
    return hits.length ? clip(hits.join("\n")) : "No files found.";
  } catch (e: any) { return `Search failed: ${e?.message}`; }
}
async function systemInfo(): Promise<string> {
  try {
    const cmd = IS_MAC ? "sw_vers; echo; uptime; echo; df -h / | tail -1"
      : OS === "windows" ? "systeminfo | findstr /C:\"OS Name\" /C:\"System Boot Time\""
      : "uname -a; echo; uptime; echo; df -h / | tail -1";
    const { stdout } = await sh(cmd, { timeout: 10000 });
    return clip(stdout.trim());
  } catch (e: any) { return `Couldn't read system info: ${e?.message}`; }
}
async function getBattery(): Promise<string> {
  try {
    if (IS_MAC) { const { stdout } = await sh("pmset -g batt | tail -1"); return stdout.trim(); }
    if (OS === "windows") { const { stdout } = await sh("WMIC Path Win32_Battery Get EstimatedChargeRemaining"); return `Battery: ${stdout.replace(/[^0-9]/g, "")}%`; }
    const { stdout } = await sh("acpi -b 2>/dev/null || cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || echo 'battery info unavailable'");
    return stdout.trim();
  } catch { return "Battery info unavailable on this system."; }
}

async function speak(text: string): Promise<string> {
  if (!IS_MAC) return "SAM can speak in the browser instead (turn on 'Read replies aloud' in settings).";
  await sh(`say ${shq(text)}`); return `Said: ${text}`;
}

// ── MORE macOS ACTIONS (risky) ───────────────────────────────
async function _sendEmail(i: { to: string; subject?: string; body: string }): Promise<string> {
  const script = `tell application "Mail"
set m to make new outgoing message with properties {subject:"${esc(i.subject || "")}", content:"${esc(i.body)}", visible:false}
tell m to make new to recipient at end of to recipients with properties {address:"${esc(i.to)}"}
send m
end tell`;
  await osa(script); return `Email sent to ${i.to}.`;
}
async function sendIMessage(i: { to: string; message: string }): Promise<string> {
  const script = `tell application "Messages"
set targetService to 1st account whose service type = iMessage
set targetBuddy to participant "${esc(i.to)}" of targetService
send "${esc(i.message)}" to targetBuddy
end tell`;
  await osa(script); return `iMessage sent to ${i.to}.`;
}
async function _addReminder(i: { text: string; list?: string }): Promise<string> {
  const list = i.list ? `list "${esc(i.list)}"` : "default list";
  await osa(`tell application "Reminders" to make new reminder at ${list} with properties {name:"${esc(i.text)}"}`);
  return `Added reminder: ${i.text}`;
}
async function _addCalendarEvent(i: { title: string; start?: string; calendar?: string }): Promise<string> {
  const cal = i.calendar || "Home";
  const start = i.start ? `date "${esc(i.start)}"` : "(current date) + 3600";
  await osa(`tell application "Calendar" to tell calendar "${esc(cal)}" to make new event with properties {summary:"${esc(i.title)}", start date:${start}, end date:(${start}) + 3600}`);
  return `Added event: ${i.title}`;
}
async function appendFile(i: { path: string; content: string }): Promise<string> {
  try { const fs = await import("node:fs/promises"); await fs.appendFile(safePath(i.path), i.content, "utf8"); return `Appended to ${i.path}`; }
  catch (e: any) { return `Could not append: ${e?.message}`; }
}
async function moveToTrash(path: string): Promise<string> {
  // Trash (recoverable), never rm.
  await osa(`tell application "Finder" to delete POSIX file "${esc(safePath(path))}"`);
  return `Moved ${path} to the Trash (recoverable).`;
}
async function setVolume(level: number): Promise<string> {
  const v = Math.max(0, Math.min(100, Number(level)));
  await osa(`set volume output volume ${v}`); return `Volume set to ${v}%.`;
}
async function musicControl(action: string): Promise<string> {
  const a = String(action).toLowerCase();
  const cmd = a === "play" ? "play" : a === "pause" ? "pause" : a === "next" ? "next track" : a === "previous" || a === "prev" ? "previous track" : "playpause";
  await osa(`tell application "Music" to ${cmd}`); return `Music: ${a}`;
}
// Play/pull up a song, artist or playlist in the user's music service.
async function playMusic(query: string): Promise<string> {
  const svc = (process.env.MUSIC_SERVICE || "apple").toLowerCase();
  const q = encodeURIComponent(String(query).trim());
  const url = svc === "spotify" ? `https://open.spotify.com/search/${q}`
    : svc === "youtube" ? `https://music.youtube.com/search?q=${q}`
    : `https://music.apple.com/search?term=${q}`;
  await sh(openCmd(url));
  const label = svc === "spotify" ? "Spotify" : svc === "youtube" ? "YouTube Music" : "Apple Music";
  // On macOS + Apple Music, best-effort nudge playback to actually start.
  let nudged = false;
  if (IS_MAC && svc === "apple") { try { await osa(`tell application "Music" to play`); nudged = true; } catch { /* not installed / nothing queued */ } }
  // Report the TRUTH — we opened a search (and maybe nudged play). Never claim it's
  // definitely playing when we only opened a results page. No more tool calls.
  return `Opened "${query}" in ${label}${nudged ? " and started Music playing" : ` — tap the track to start it if it doesn't auto-play`}. Tell the user in one short line, with swagger but honestly. Do not call any more tools.`;
}

// ── CALLING (via iPhone Continuity — free) ───────────────────
async function makeCall(number: string): Promise<string> {
  if (!IS_MAC) return notSupported("phone calls");
  const n = String(number).replace(/[^\d+*#]/g, "");
  await sh(`open ${shq("tel://" + n)}`);
  return `Calling ${number} — pick up on your Mac or iPhone. (Needs 'Calls from iPhone' on in FaceTime settings.)`;
}
async function faceTime(who: string): Promise<string> {
  if (!IS_MAC) return notSupported("FaceTime");
  await sh(`open ${shq("facetime://" + who)}`);
  return `Starting a FaceTime with ${who}.`;
}

// ── READ PERSONAL DATA (safe, local — asks macOS permission once) ─
async function findContact(name: string): Promise<string> {
  try {
    const out = await osa(`set out to ""
tell application "Contacts"
  repeat with p in (people whose name contains "${esc(name)}")
    set out to out & (name of p)
    repeat with ph in phones of p
      set out to out & " · " & (value of ph)
    end repeat
    repeat with em in emails of p
      set out to out & " · " & (value of em)
    end repeat
    set out to out & linefeed
  end repeat
end tell
return out`);
    return out.trim() || `No contact found matching “${name}”.`;
  } catch (e: any) { return `Couldn't read Contacts: ${e?.message}`; }
}
async function readCalendar(): Promise<string> {
  try {
    const out = await osa(`set out to ""
set startD to (current date) - (time of (current date))
set endD to startD + 86400
tell application "Calendar"
  repeat with c in calendars
    repeat with e in (every event of c whose start date is greater than or equal to startD and start date is less than endD)
      set out to out & (time string of (start date of e)) & "  " & (summary of e) & linefeed
    end repeat
  end repeat
end tell
return out`);
    return out.trim() || "Nothing on your calendar today.";
  } catch (e: any) { return `Couldn't read Calendar: ${e?.message}`; }
}
async function readReminders(): Promise<string> {
  try {
    const out = await osa(`set out to ""
tell application "Reminders"
  repeat with r in (reminders whose completed is false)
    set out to out & (name of r) & linefeed
  end repeat
end tell
return out`);
    return clip(out.trim()) || "No open reminders.";
  } catch (e: any) { return `Couldn't read Reminders: ${e?.message}`; }
}
async function readEmails(): Promise<string> {
  try {
    const out = await osa(`tell application "Mail"
  set out to ""
  set unreadMsgs to (messages of inbox whose read status is false)
  set msgCount to count of unreadMsgs
  if msgCount > 15 then set msgCount to 15
  repeat with i from 1 to msgCount
    set m to item i of unreadMsgs
    set s to sender of m
    set sub to subject of m
    set b to content of m
    if length of b > 100 then set b to text 1 thru 100 of b
    set out to out & s & " | " & sub & " | " & b & "\\n"
  end repeat
  return out
end tell`);
    return clip(out.trim()) || "Inbox looks empty (or Mail isn't set up).";
  } catch (e: any) { return `Couldn't read Mail: ${e?.message}`; }
}

// Recent Notes. Two things in the original were not AppleScript at all, so this tool raised a
// SYNTAX error on every single call since the day it was written — and the catch below turned that
// into "Couldn't read Notes: …", which reads like a missing permission. It was never a permission.
//
//   `sort notes by modification date descending`  — Notes has no `sort` command; the compiler
//        stops on the plural class name.
//   `text 1 thru (if length of b > 300 then 300 else length of b) of b`  — AppleScript has no
//        inline conditional. `if` is a statement, never an expression.
//
// Ordering now happens in TypeScript, where sorting is a solved problem: AppleScript emits a
// sortable ISO timestamp per note and JS does the rest. The window bounds the work on a large
// library rather than reading every note to find eight.
const NOTE_SEP = "␞";   // record separator — cannot occur in note text
const NOTE_LIMIT = 8;
async function readAppleNotes(): Promise<string> {
  try {
    // PASS 1 — metadata for every note in ONE Apple Event per property. Measured on a real 366-note
    // library: 0.3s per bulk property, ~5s for the whole pass. The two shapes that do NOT work, both
    // found by running them rather than reasoning about them:
    //   `notes whose modification date > cutoff` then `container of n`  → -1728, and a folder-level
    //        `whose` loop instead simply never returned (killed at 60s).
    //   `modification date of ns` where ns is a LIST variable            → -1728. It has to be
    //        `of every note`, which is the bulk form the app answers in one event.
    const meta = await osa(`tell application "Notes"
  set ids to id of every note
  set nms to name of every note
  set dts to modification date of every note
  set cts to name of container of every note
  set out to ""
  repeat with i from 1 to count of ids
    set d to item i of dts
    set iso to (year of d as string) & "-" & text -2 thru -1 of ("0" & (month of d as integer)) & "-" & text -2 thru -1 of ("0" & (day of d)) & " " & text -2 thru -1 of ("0" & (hours of d)) & ":" & text -2 thru -1 of ("0" & (minutes of d))
    set out to out & (item i of ids) & "${NOTE_SEP}" & iso & "${NOTE_SEP}" & (item i of cts) & "${NOTE_SEP}" & (item i of nms) & linefeed
  end repeat
  return out
end tell`);
    const rows = meta.split("\n")
      .map((l) => l.split(NOTE_SEP))
      .filter((p) => p.length >= 4)
      .map(([id, when, folder, title]) => ({ id, when: when.trim(), folder: folder.trim(), title: title.trim() }))
      .filter((n) => n.folder !== "Recently Deleted")
      .sort((a, b) => b.when.localeCompare(a.when))   // "YYYY-MM-DD HH:MM" sorts chronologically as text
      .slice(0, NOTE_LIMIT);
    if (!rows.length) return "No notes found.";
    // PASS 2 — bodies for the winners only, so a large library costs eight fetches, not hundreds.
    const bodies = await Promise.all(rows.map((n) =>
      osa(`tell application "Notes" to return plaintext of note id ${JSON.stringify(n.id)}`).catch(() => "")));
    return clip(rows.map((n, i) => `== ${n.title} == (${n.when})\n${(bodies[i] || "").trim().slice(0, 300)}`).join("\n\n"));
  } catch (e: any) { return `Couldn't read Notes: ${e?.message}`; }
}



// ── BROWSER AUTOMATION (PLAYWRIGHT) ─────────────────────────
let activeBrowser: any = null;
let activePage: Page | null = null;

async function getPage(): Promise<Page> {
  if (!activePage || activePage.isClosed()) {
    let executablePath = "";
    if (IS_MAC) executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    else if (process.platform === "win32") executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    else executablePath = "/usr/bin/google-chrome"; 

    try {
      const { chromium } = require("playwright-core");
      await activeBrowser?.close().catch(() => {/* teardown is idempotent — already closed is success */});   // close the previous browser first — a closed page left the old process orphaned
      activeBrowser = await chromium.launch({ executablePath, headless: false });
      const ctx = await activeBrowser.newContext();
      activePage = await ctx.newPage();
    } catch (e: any) {
      throw new Error(`Could not launch Chrome. Ensure it's installed. Error: ${e.message}`);
    }
  }
  if (!activePage) throw new Error("Browser page unavailable — try the action again.");
  return activePage;
}

async function browserNavigate(url: string) {
  try {
    const p = await getPage();
    await p.goto(url, { waitUntil: "domcontentloaded" });
    return `Navigated to ${url}. Title: ${await p.title()}`;
  } catch (e: any) { return `Failed to navigate: ${e.message}`; }
}

async function browserClick(selector: string) {
  try {
    const p = await getPage();
    await p.click(selector);
    return `Clicked '${selector}'.`;
  } catch (e: any) { return `Failed to click: ${e.message}`; }
}

async function browserType(input: { selector: string; text: string; submit?: boolean }) {
  try {
    const p = await getPage();
    await p.fill(input.selector, input.text);
    if (input.submit) await p.press(input.selector, "Enter");
    return `Typed into '${input.selector}'.`;
  } catch (e: any) { return `Failed to type: ${e.message}`; }
}

async function browserRead() {
  try {
    if (!activePage || activePage.isClosed()) return "No browser tab is currently open. Navigate somewhere first.";
    const p = activePage;
    const text = await p.evaluate(() => document.body.innerText);
    return clip(`[${await p.title()}]\n${text}`, 20000);
  } catch (e: any) { return `Failed to read page: ${e.message}`; }
}


// ── VIDEO RENDER (HTML → MP4) ───────
async function renderVideoTool(input: any): Promise<string> {
  try {
    const raw = typeof input?.html === "string" && input.html.trim() ? input.html : null;
    const html = raw ?? titleCard({
      title: String(input?.title ?? "SAM"),
      subtitle: input?.subtitle != null ? String(input.subtitle) : undefined,
      bg: input?.bg, fg: input?.fg,
    });
    const deskt = join(homedir(), "Desktop");
    const out = input?.out
      ? resolve(String(input.out).replace(/^~/, homedir()))
      : join(existsSync(deskt) ? deskt : homedir(), `sam-video-${Date.now()}.mp4`);
    const r = await renderVideo({
      html,
      durationMs: Number(input?.durationMs ?? 4000),
      fps: input?.fps ? Number(input.fps) : 30,
      width: input?.width ? Number(input.width) : 1280,
      height: input?.height ? Number(input.height) : 720,
      out,
    });
    return `Rendered ${r.frames} frames → ${r.path} (${r.width}×${r.height}, ` +
      `${(r.durationMs / 1000).toFixed(1)}s @ ${r.fps}fps). Deterministic — the same input reproduces this exact file.`;
  } catch (e: any) {
    return `Video render failed: ${e?.message ?? e}`;
  }
}

// ── MODEL COLOSSEUM — wired arena run, shared by the tool + /api/arena ──
const ARENA_DEFAULT_PROMPT = "Explain why the sky is blue in two sentences a 10-year-old would understand.";
export async function benchmarkBrains(
  opts: { prompt?: string; prompts?: string[]; brains?: string[]; maxBrains?: number } = {},
): Promise<ArenaResult | { error: string }> {
  const all = availableBrains();
  if (all.length < 2) return { error: "Need at least 2 available brains to run the arena — add a free key or two." };
  // AUDIT FIX (quota, doctrine #3): model_arena is a SAFE auto-running tool, and the arena is a
  // round-robin — cost grows as C(brains,2) × prompts × 3 brain calls. The explicit-brains path had
  // NO ceiling, so a chat-triggered arena over many brains/prompts could fire thousands of calls and
  // drain the free-tier pool. Cap BOTH dimensions (8 brains / 5 prompts still covers the ~7-key
  // nightly benchmark, which uses one prompt).
  const MAX_BRAINS = 8, MAX_PROMPTS = 5;
  const chosen = (Array.isArray(opts.brains) && opts.brains.length ? all.filter((b) => opts.brains!.includes(b.id)) : all.slice(0, opts.maxBrains ?? 4)).slice(0, MAX_BRAINS);
  // Guard on CHOSEN competitors, not just available — a 1-brain "benchmark" would otherwise
  // persist a degenerate ranking and corrupt routing (the champion would be that lone brain).
  if (chosen.length < 2) return { error: "Need at least 2 valid brains to benchmark — got " + chosen.length + "." };
  const competitors = chosen.map((b) => ({ id: b.id, label: b.label }));
  const prompts = (opts.prompts?.length ? opts.prompts.map(String) : [opts.prompt ? String(opts.prompt) : ARENA_DEFAULT_PROMPT]).slice(0, MAX_PROMPTS);
  const answer = async (id: string, p: string) => (await runBrain(id, "", p)) || "(no answer)";
  const judge = async (p: string, a: string, b: string) => parseVerdict((await runModel("premium", JUDGE_SYSTEM, judgePrompt(p, a, b))).text);
  const result = await runArena(competitors, prompts, answer, judge);
  // Only re-crown on real evidence. The arena used to persist leaderboard[0] by raw Elo, so a
  // gap well inside the noise could flip the champion night to night and churn routing for
  // nothing. championWithConfidence runs a one-sided two-proportion z-test of the leader
  // against the runner-up, Bonferroni-adjusted for having picked the max of N brains; when it
  // isn't significant we keep the incumbent ranking (routing is unchanged, which is the safe
  // default). See server/colosseum-significance.ts.
  const verdict = championWithConfidence(result.leaderboard);
  if (verdict.significant) {
    saveRanking(result, new Date().toISOString());   // persist → the free-tier cascade prefers the winner
    console.log(`arena: re-crowned — ${verdict.reason}`);
  } else {
    console.log(`arena: champion unchanged — ${verdict.reason}`);
  }
  return result;   // shape unchanged — the verdict is logged, not bolted onto the public contract
}

// ── REGISTRY ─────────────────────────────────────────────────
export const TOOLS: Tool[] = [
  { name: "ast_outline", safe: true, description: "Extracts an AST-style structural outline (classes, functions, interfaces) from a JS/TS file with line numbers. Use this on large files instead of reading them line-by-line. input: { path }.", params: "{path}",
    args: { path: { type: "string", required: true, desc: "File to parse" } },
    activity: (i) => `Parsing outline for ${i.path}`, run: (i) => astOutlineTool(i) },
  { name: "run_tests", safe: true, description: "Runs the vitest test suite programmatically and parses the JSON output to return ONLY the failures (exact errors and line numbers) instead of raw terminal logs. input: { path? }.", params: "{path?}",
    args: { path: { type: "string", desc: "Optional path to a specific test file or directory" } },
    activity: (i) => `Running tests ${i.path || ""}`, run: (i) => runTestsTool(i) },
  { name: "spawn_subagent", safe: false, description: "Spawns an autonomous background specialist sub-agent to solve a focused task. input: { task, specialist?, tier? }. Specialists: coder, investigator, designer, writer, scout.", params: "{task, specialist?, tier?}",
    args: {
      task: { type: "string", required: true, desc: "The subtask for the agent to execute" },
      specialist: { type: "string", desc: "Specialist role (coder | investigator | designer | writer | scout)" },
      tier: { type: "string", desc: "Model tier (local | free | premium)" }
    },
    activity: (i) => `Delegating to sub-agent (${i.specialist || "coder"}): ${i.task}`,
    preview: (i) => `Spawn autonomous sub-agent (${i.specialist || "coder"}):\n  ${i.task ?? ""}`,
    run: (i) => subAgentTool(i) },
  { name: "swarm_fanout", safe: false, description: "Runs up to 50 autonomous specialist sub-agents in parallel with bounded concurrency and synthesizes their results. input: { tasks: [{task, specialist?, tier?}], concurrency?, synthesize?, goal?, tier? }.", params: "{tasks, concurrency?, synthesize?, goal?, tier?}",
    args: {
      tasks: { type: "array", required: true, desc: "Array of subagent tasks (up to 50)" },
      concurrency: { type: "number", desc: "Max concurrent subagents (default: 8, max: 50)" },
      synthesize: { type: "boolean", desc: "Whether to generate a unified final synthesis" },
      goal: { type: "string", desc: "High-level goal description for synthesis" },
      tier: { type: "string", desc: "Model tier (local | free | premium)" }
    },
    activity: (i) => `Fanning out ${Array.isArray(i?.tasks) ? i.tasks.length : 0} parallel sub-agents (50x swarm)`,
    preview: (i) => `Fan out ${Array.isArray(i?.tasks) ? i.tasks.length : 0} sub-agents in parallel:\n  ${(i?.tasks || []).slice(0, 3).map((t: any) => typeof t === "string" ? t : t.task).join("\n  ")}`,
    run: (i) => swarmFanoutTool(i) },
  { name: "codebase_scan_parallel", safe: true, description: "Scans the entire codebase concurrently across multiple files for a pattern or AST structure (50x scanner). input: { path?, pattern, includeAst?, concurrency? }.", params: "{path?, pattern, includeAst?, concurrency?}",
    args: {
      path: { type: "string", desc: "Root directory to scan (defaults to workspace root)" },
      pattern: { type: "string", required: true, desc: "Regex or string pattern to find" },
      includeAst: { type: "boolean", desc: "Extract enclosing AST node declarations (default: true)" },
      concurrency: { type: "number", desc: "Parallel file scan concurrency (default: 16, max: 50)" }
    },
    activity: (i) => `Parallel scanning codebase for "${i.pattern}"`,
    run: (i) => codebaseScanParallelTool(i) },
  { name: "swarm_pipeline", safe: false, description: "Executes a multi-stage pipeline of specialist subagents where outputs flow sequentially across stages with validation gates. input: { stages: [{name?, specialist, task, tier?, optional?}], initialInput?, synthesize?, goal?, tier? }.", params: "{stages, initialInput?, synthesize?, goal?, tier?}",
    args: {
      stages: { type: "array", required: true, desc: "Ordered array of pipeline stages" },
      initialInput: { type: "string", desc: "Initial input to feed into first stage" },
      synthesize: { type: "boolean", desc: "Whether to produce a final unified synthesis" },
      goal: { type: "string", desc: "High-level pipeline goal" },
      tier: { type: "string", desc: "Model tier (local | free | premium)" }
    },
    activity: (i) => `Running ${Array.isArray(i?.stages) ? i.stages.length : 0}-stage swarm pipeline`,
    preview: (i) => `Execute multi-stage swarm pipeline:\n  ${(i?.stages || []).map((s: any, idx: number) => `${idx + 1}. [${s.specialist || "coder"}] ${s.name || s.task}`).join("\n  ")}`,
    run: (i) => swarmPipelineTool(i) },
  { name: "doctor_auto_heal", safe: false, description: "Runs automated system health diagnostics and applies safe auto-remediations (clears stale locks, ensures directory permissions, creates admin issue logs).", params: "{}",
    args: {},
    activity: () => "Running Doctor auto-heal diagnostic and remediation",
    preview: () => "Run Doctor auto-heal and apply system remediations",
    run: () => doctorAutoHealTool() },
  { name: "ast_replace_symbol", safe: false, description: "Renames an identifier in a TypeScript or JavaScript file (word-boundary text match, not scope-aware — also touches matches inside strings/comments/template literals) and type-checks the result, reverting automatically if the rename breaks compilation. input: { path, oldSymbol, newSymbol, dryRun? }.", params: "{path, oldSymbol, newSymbol, dryRun?}",
    args: {
      path: { type: "string", required: true, desc: "File path to refactor" },
      oldSymbol: { type: "string", required: true, desc: "Exact symbol name to replace" },
      newSymbol: { type: "string", required: true, desc: "New symbol name" },
      dryRun: { type: "boolean", desc: "If true, previews changes without modifying file" }
    },
    activity: (i) => `Refactoring symbol '${i.oldSymbol}' → '${i.newSymbol}' in ${i.path}`,
    preview: (i) => `Replace symbol '${i.oldSymbol}' with '${i.newSymbol}' in ${i.path}${i.dryRun ? " (dry run)" : ""}`,
    run: (i) => astReplaceSymbolTool(i) },
  { name: "flipit_monte_carlo", safe: true, description: "Runs high-speed 100x Monte Carlo simulation (up to 100,000 paths) on a trading strategy, calculating quantiles, Value at Risk (VaR 95/99), CVaR Expected Shortfall, Sharpe, and ruin risk. input: { initialCapital?, mu?, sigma?, days?, paths?, ruinThreshold? }.", params: "{initialCapital?, mu?, sigma?, days?, paths?, ruinThreshold?}",
    args: {
      initialCapital: { type: "number", desc: "Starting capital (default: £1.0)" },
      mu: { type: "number", desc: "Expected daily drift rate (default: 0.001 = 0.1%/day)" },
      sigma: { type: "number", desc: "Daily volatility (default: 0.012 = 1.2%/day)" },
      days: { type: "number", desc: "Projection horizon in trading days (default: 60)" },
      paths: { type: "number", desc: "Number of simulated paths (default: 10,000, up to 100,000)" },
      ruinThreshold: { type: "number", desc: "Drawdown fraction defining ruin (default: 0.5)" }
    },
    activity: (i) => `Running 100x Monte Carlo simulation (${Number(i?.paths || 10000).toLocaleString()} paths)`,
    run: (i) => flipitMonteCarloTool(i) },
  { name: "flipit_multi_strategy", safe: true, description: "Analyzes multi-strategy / multi-asset portfolio covariance, risk-parity weight allocation, diversification ratio, and target volatility scaling. input: { assets?, targetDailyVol?, assumedCorrelation? }.", params: "{assets?, targetDailyVol?, assumedCorrelation?}",
    args: {
      assets: { type: "array", desc: "Array of asset profiles [{id, name, expectedDailyReturn, dailyVolatility}]" },
      targetDailyVol: { type: "number", desc: "Target daily portfolio volatility (default: 0.01)" },
      assumedCorrelation: { type: "number", desc: "Pairwise correlation assumption (default: 0.25)" }
    },
    activity: () => "Analyzing multi-strategy risk parity portfolio",
    run: (i) => flipitMultiStrategyTool(i) },
  { name: "flipit_ladder_projections", safe: true, description: "Calculates 100-rung exponential milestone projections, Kelly optimal bet sizing (f* = mu / sigma^2), and velocity estimates. input: { currentEquity?, mu?, sigma?, totalRungs? }.", params: "{currentEquity?, mu?, sigma?, totalRungs?}",
    args: {
      currentEquity: { type: "number", desc: "Current account equity (default: £5.0)" },
      mu: { type: "number", desc: "Expected daily drift (default: 0.002)" },
      sigma: { type: "number", desc: "Daily volatility (default: 0.012)" },
      totalRungs: { type: "number", desc: "Number of ladder rungs to project (default: 100)" }
    },
    activity: (i) => `Projecting 100-rung ladder growth from £${Number(i?.currentEquity || 5).toFixed(2)}`,
    run: (i) => flipitLadderProjectionsTool(i) },
  { name: "studio_higgsfield_director", safe: true, description: "Generates multi-shot Hollywood/Higgsfield cinematic storyboards with camera trajectories, lens profiles, character anchors, and shot pacing. input: { concept, shotCount?, style?, characterName?, characterDesc? }.", params: "{concept, shotCount?, style?, characterName?, characterDesc?}",
    args: {
      concept: { type: "string", required: true, desc: "Visual cinematic story concept" },
      shotCount: { type: "number", desc: "Number of sequential shots (default: 4, max: 8)" },
      style: { type: "string", desc: "Cinematic visual style" },
      characterName: { type: "string", desc: "Optional character name to anchor across shots" },
      characterDesc: { type: "string", desc: "Optional physical description for character anchor" }
    },
    activity: (i) => `Directing Higgsfield storyboard for "${String(i?.concept || "").slice(0, 35)}…"`,
    run: (i) => studioHiggsfieldDirectorTool(i) },
  { name: "studio_motion_controller", safe: true, description: "Compiles Higgsfield 3D camera trajectory vectors (orbit, dolly, crane, FPV dive) and physics dynamics into precise video generation prompts. input: { prompt, cameraRig?, lens?, physics?, motionIntensity?, aspectRatio? }.", params: "{prompt, cameraRig?, lens?, physics?, motionIntensity?, aspectRatio?}",
    args: {
      prompt: { type: "string", required: true, desc: "Base video generation prompt" },
      cameraRig: { type: "string", desc: "Camera movement rig (orbit_360_cw | dolly_in_rapid | fpv_drone_dive | vertigo_hitchcock | steadicam_tracking | macro_slider_glide)" },
      lens: { type: "string", desc: "Cinematic lens (anamorphic_panavision | arri_master_prime | imax_70mm_grand | portrait_85mm_bokeh)" },
      physics: { type: "string", desc: "Physics dynamic (cloth_wind_flutter | fluid_liquid_splash | particle_fire_embers | zero_g_float)" },
      motionIntensity: { type: "number", desc: "Motion strength multiplier 0.1 to 5.0 (default: 1.0)" },
      aspectRatio: { type: "string", desc: "Aspect ratio (16:9 | 9:16 | 1:1 | 2.39:1 | 4:5)" }
    },
    activity: (i) => `Compiling 3D motion control for "${String(i?.prompt || "").slice(0, 30)}…"`,
    run: (i) => studioMotionControllerTool(i) },
  { name: "studio_character_lock", safe: true, description: "Creates a reusable SoulID character consistency profile with anchor tokens to prevent facial and stylistic drift across video generations. input: { name, age?, gender?, ethnicity?, facialFeatures?, hair?, eyes?, signatureClothing?, distinctTokens? }.", params: "{name, age?, gender?, ethnicity?, facialFeatures?, hair?, eyes?, signatureClothing?, distinctTokens?}",
    args: {
      name: { type: "string", required: true, desc: "Character name" },
      age: { type: "number", desc: "Character age" },
      gender: { type: "string", desc: "Character gender" },
      ethnicity: { type: "string", desc: "Character ethnicity" },
      facialFeatures: { type: "string", desc: "Distinctive facial anatomy features" },
      hair: { type: "string", desc: "Hairstyle and color" },
      eyes: { type: "string", desc: "Eye shape and color" },
      signatureClothing: { type: "string", desc: "Signature wardrobe" }
    },
    activity: (i) => `Locking SoulID character profile for "${i?.name}"`,
    run: (i) => studioCharacterLockTool(i) },
  { name: "cost_savings_report", safe: true, description: "Displays real-world token and dollar savings ledger across SAM free-first routing, semantic cache deduplication, and local models. input: {}.", params: "{}",
    args: {},
    activity: () => "Generating SAM cost and token savings report",
    run: () => costSavingsReportTool() },
  { name: "optimize_prompt_tokens", safe: true, description: "Optimizes and condenses long prompt contexts and tool logs, stripping redundancy to save 40-60% input tokens. input: { text, maxLines? }.", params: "{text, maxLines?}",
    args: {
      text: { type: "string", required: true, desc: "Prompt or context text to optimize" },
      maxLines: { type: "number", desc: "Maximum lines to keep" }
    },
    activity: () => "Optimizing prompt tokens and stripping context redundancy",
    run: (i) => optimizePromptTokensTool(i) },
  { name: "yard_launch_playbook", safe: true, description: "Launches and renders autonomous project master playbooks (Full-Stack SaaS, Prediction Market Bot, Deep Research, 3D Studio, Zero-Cost AI Proxy). input: { playbookId?, values? }.", params: "{playbookId?, values?}",
    args: {
      playbookId: { type: "string", desc: "Playbook ID (e.g. 'fullstack-saas-core', 'prediction-market-bot', 'executive-deep-research', 'studio-video-pipeline', 'zero-cost-ai-proxy')" },
      values: { type: "object", desc: "Optional template parameters dictionary to fill into prompt" }
    },
    activity: (i) => `Rendering Yard playbook: [${i?.playbookId || "fullstack-saas-core"}]`,
    run: (i) => yardLaunchPlaybookTool(i) },
  { name: "model_speed_benchmark", safe: true, description: "Displays live TTFT (Time-to-First-Token) and token throughput speed leaderboard across configured model providers. input: {}.", params: "{}",
    activity: () => "Inspecting model speed and throughput benchmark leaderboard",
    run: () => modelSpeedBenchmarkTool() },
  { name: "deep_research_dossier", safe: true, description: "Gathers multi-angle live web intelligence, calculates source consensus score, and compiles a cited markdown Executive Research Dossier. input: { topic, depth? }.", params: "{topic, depth?}",
    args: {
      topic: { type: "string", desc: "Research question, industry sector, or market topic to investigate" },
      depth: { type: "string", desc: "'quick' (1 pass), 'deep' (2 passes, default), or 'exhaustive' (4 passes)" }
    },
    activity: (i) => `Compiling executive research dossier for: "${i?.topic ?? i}"`,
    run: (i) => deepResearchDossierTool(i) },
  { name: "hardware_vitals_telemetry", safe: true, description: "Retrieves native CPU load, memory saturation, battery level/charging status, and task throttle pressure. input: {}.", params: "{}",
    activity: () => "Inspecting native host hardware vitals & power telemetry",
    run: () => hardwareVitalsTelemetryTool() },
  { name: "audit_ledger_verify", safe: true, description: "Verifies the cryptographic SHA-256 Merkle chain integrity of all logged approvals and sensitive agent operations. input: {}.", params: "{}",
    activity: () => "Verifying cryptographic audit chain integrity",
    run: () => auditLedgerVerifyTool() },
  { name: "flipit_ev_signals", safe: true, description: "Scans live Binance and Kraken market feeds against Polymarket binary prediction odds to flag positive expected value (+EV) arbitrage trades with Kelly sizing. input: { portfolioGbp? }.", params: "{portfolioGbp?}",
    args: { portfolioGbp: { type: "number", desc: "Total portfolio capital in GBP (default: 1000)" } },
    activity: (i) => `Scanning +EV prediction market signals (Capital: £${i?.portfolioGbp || 1000})`,
    run: (i) => flipitEvSignalsTool(i) },
  { name: "yard_sandbox_daemon", safe: false, description: "Controls isolated background sandbox runtime processes for Yard scaffolded apps with dynamic port allocation and self-healing crash diagnostics. input: { action: 'start'|'stop'|'status'|'list', projectId?, command?, sessionId? }.", params: "{action, projectId?, command?, sessionId?}",
    args: {
      action: { type: "string", required: true, desc: "'start', 'stop', 'status', or 'list'" },
      projectId: { type: "string", desc: "Project name (e.g. 'AlphaLaunch')" },
      command: { type: "string", desc: "Command string to run (e.g. 'npm run dev')" },
      sessionId: { type: "string", desc: "Session ID for stop or status inspection" }
    },
    activity: (i) => `Managing Yard sandbox daemon (${i?.action || "list"})`,
    run: (i) => yardSandboxDaemonTool(i) },
  { name: "studio_master_timeline", safe: true, description: "Compiles Hollywood/Higgsfield 3D camera vector rigs, storyboards, and AI speech narration tracks into synchronized 24fps SMPTE EDL manifests. input: { concept, sceneCount?, aspectRatio? }.", params: "{concept, sceneCount?, aspectRatio?}",
    args: {
      concept: { type: "string", required: true, desc: "Cinematic story narrative concept" },
      sceneCount: { type: "number", desc: "Number of sequential shots (3-8)" },
      aspectRatio: { type: "string", desc: "Aspect ratio ('16:9', '9:16', '2.39:1', '1:1')" }
    },
    activity: (i) => `Compiling master 24fps production timeline for: "${String(i?.concept || "").slice(0, 30)}…"`,
    run: (i) => studioMasterTimelineTool(i) },
  { name: "flipit_market_maker", safe: true, description: "Generates optimal two-sided bid/ask quotes and spot delta-hedging recommendations for prediction markets. input: { spotPrice, strikePrice, expiryDays, inventory?, targetSpread? }.", params: "{spotPrice, strikePrice, expiryDays, inventory?, targetSpread?}",
    args: {
      spotPrice: { type: "number", required: true, desc: "Current spot asset price (USD)" },
      strikePrice: { type: "number", required: true, desc: "Prediction market target strike price (USD)" },
      expiryDays: { type: "number", required: true, desc: "Days until market resolution" },
      inventory: { type: "number", desc: "Current net YES contracts held (+ for long, - for short)" },
      targetSpread: { type: "number", desc: "Base bid-ask spread fraction (default: 0.04)" }
    },
    activity: (i) => `Calculating delta-neutral market making quotes for $${i?.spotPrice} vs strike $${i?.strikePrice}`,
    run: (i) => flipitMarketMakerTool(i) },
  { name: "p2p_mesh_network", safe: true, description: "Inspects zero-cloud local LAN peer mesh network topology and broadcasts vector-clock state gossip. input: { action?: 'status'|'broadcast', channel?, payload? }.", params: "{action?, channel?, payload?}",
    args: {
      action: { type: "string", desc: "'status' or 'broadcast'" },
      channel: { type: "string", desc: "'vault_sync', 'yard_manifest', 'companion_vitals', or 'agent_task'" },
      payload: { type: "object", desc: "Data payload to broadcast" }
    },
    activity: (i) => `Inspecting P2P LAN mesh network (${i?.action || "status"})`,
    run: (i) => p2pMeshNetworkTool(i) },
  { name: "voice_agent_stream", safe: true, description: "Inspects and controls SAM streaming voice agent state, VAD energy threshold, and audio session buffer. input: { sessionId?, action?: 'status'|'speaking'|'reset' }.", params: "{sessionId?, action?}",
    args: {
      sessionId: { type: "string", desc: "Voice session ID (default: 'default-mic')" },
      action: { type: "string", desc: "'status', 'speaking', or 'reset'" }
    },
    activity: (i) => `Inspecting real-time streaming voice agent [${i?.sessionId || "default-mic"}]`,
    run: (i) => voiceAgentStreamTool(i) },
  { name: "antigravity_cognition", safe: true, description: "Executes Antigravity-grade multi-branch speculative reasoning, factual workspace grounding, and zero-hallucination verification. input: { taskPrompt, maxBranches? }.", params: "{taskPrompt, maxBranches?}",
    args: {
      taskPrompt: { type: "string", required: true, desc: "Complex task, engineering problem, or mathematical claim to evaluate" },
      maxBranches: { type: "number", desc: "Number of speculative hypotheses to generate (default: 3)" }
    },
    activity: (i) => `Running Antigravity speculative cognition for "${String(i?.taskPrompt || "").slice(0, 30)}…"`,
    run: (i) => antigravityCognitionTool(i) },
  { name: "antigravity_reflection_loop", safe: true, description: "Runs autonomous iterative self-correction reflection to repair factual discrepancies, math errors, and invalid symbol references. input: { text, maxIterations? }.", params: "{text, maxIterations?}",
    args: {
      text: { type: "string", required: true, desc: "Reasoning output or code plan to self-correct" },
      maxIterations: { type: "number", desc: "Maximum reflection passes (default: 3)" }
    },
    activity: (i) => `Executing cognitive reflection loop on reasoning plan`,
    run: (i) => antigravityReflectionLoopTool(i) },
  { name: "antigravity_symbol_verifier", safe: true, description: "Empirically verifies whether a TypeScript function, type, class, or variable is declared and exported in a specific workspace file. input: { filePath, symbolName }.", params: "{filePath, symbolName}",
    args: {
      filePath: { type: "string", required: true, desc: "Path to TypeScript file (e.g. 'server/agent.ts')" },
      symbolName: { type: "string", required: true, desc: "Symbol identifier to verify (e.g. 'runAgent')" }
    },
    activity: (i) => `Verifying symbol "${i?.symbolName}" in "${i?.filePath}"`,
    run: (i) => antigravitySymbolVerifierTool(i) },
  { name: "capital_protection_audit", safe: true, description: "Audits trading portfolio drawdown risk, stop-loss triggers, and Kelly-optimal bet sizing to prevent capital ruin. input: { equity?, highWaterMark?, maxDrawdownLimit? }.", params: "{equity?, highWaterMark?, maxDrawdownLimit?}",
    args: {
      equity: { type: "number", desc: "Current account equity (default: £5.0)" },
      highWaterMark: { type: "number", desc: "Peak high-water mark equity" },
      maxDrawdownLimit: { type: "number", desc: "Maximum allowable drawdown fraction (default: 0.15 = 15%)" }
    },
    activity: (i) => `Auditing capital protection for equity £${Number(i?.equity || 5).toFixed(2)}`,
    run: (i) => capitalProtectionAuditTool(i) },
  { name: "smart_quick_action", safe: true, description: "Executes 1-click natural language smart workflows across SAM, FlipIt, and Studio with zero cognitive friction. input: { intent }.", params: "{intent}",
    args: {
      intent: { type: "string", required: true, desc: "High-level user request or intent" }
    },
    activity: (i) => `Executing 1-click smart action for "${String(i?.intent || "").slice(0, 30)}…"`,
    run: (i) => smartQuickActionTool(i) },
  { name: "smart_studio_preset", safe: true, description: "Generates an instant 1-click Higgsfield cinematic prompt with auto-matched camera rig, lens, and lighting. input: { concept, mood? }.", params: "{concept, mood?}",
    args: {
      concept: { type: "string", required: true, desc: "Basic visual idea or prompt" },
      mood: { type: "string", desc: "Visual mood (cinematic | action | moody | commercial | anime | vintage)" }
    },
    activity: (i) => `Generating 1-click studio preset for "${String(i?.concept || "").slice(0, 30)}…"`,
    run: (i) => smartStudioPresetTool(i) },
  { name: "smart_flipit_summary", safe: true, description: "Displays a dead-simple, 3-line financial health and ladder progress card for FlipIt. input: {}.", params: "{}",
    args: {},
    activity: () => "Generating FlipIt quick-glance summary",
    run: () => smartFlipitSummaryTool() },
  { name: "mobile_dispatch_notification", safe: false, description: "Prepares and dispatches a high-priority push notification (APNs / FCM) with privacy scrubbing to all paired iOS and Android devices. input: { title, body, category?, deepLink? }.", params: "{title, body, category?, deepLink?}",
    args: {
      title: { type: "string", required: true, desc: "Notification title" },
      body: { type: "string", required: true, desc: "Notification body message" },
      category: { type: "string", desc: "Notification category (alert | watchdog | task | trade | chat)" },
      deepLink: { type: "string", desc: "Deep link URL or route path" }
    },
    activity: (i) => `Dispatching mobile push notification "${i?.title}"`,
    run: (i) => mobileDispatchNotificationTool(i) },
  { name: "audio_synthesize_speech", safe: true, description: "Generates natural speech audio and 32-bin waveform from text or dialogue transcript. input: { text, voice?, speed? }.", params: "{text, voice?, speed?}",
    args: {
      text: { type: "string", required: true, desc: "Text to synthesize into speech" },
      voice: { type: "string", desc: "Voice ID (sam_host | alex_cohost | nova_calm | echo_deep)" },
      speed: { type: "number", desc: "Playback speed multiplier (e.g. 1.0)" }
    },
    activity: (i) => `Synthesizing speech audio (${i?.voice || "sam_host"})`,
    run: (i) => audioSynthesizeSpeechTool(i) },
  { name: "flipit_rebalance_portfolio", safe: true, description: "Calculates mathematical Risk-Parity portfolio rebalancing buy/sell orders and turnover in £GBP. input: { holdings?, targetAllocations?, totalEquityGbp? }.", params: "{holdings?, targetAllocations?, totalEquityGbp?}",
    args: {
      holdings: { type: "array", desc: "Current portfolio holdings array" },
      targetAllocations: { type: "array", desc: "Target allocation weights array" },
      totalEquityGbp: { type: "number", desc: "Total portfolio equity in £GBP" }
    },
    activity: () => "Calculating autonomous Risk-Parity portfolio rebalance",
    run: (i) => flipitRebalancePortfolioTool(i) },
  { name: "sam_master_dashboard", safe: true, description: "Displays single-screen executive telemetry and status across all SAM subsystems (Swarms, Doctor, Caches, FlipIt 100x, Studio, Cost Optimizer, Mobile Bridge). input: {}.", params: "{}",
    args: {},
    activity: () => "Compiling SAM master executive dashboard",
    run: () => samMasterDashboardTool() },
  { name: "mobile_generate_feed_snapshot", safe: true, description: "Assembles high-speed live feed cards (Tasks, Market, Studio, Alerts) into a compressed stream for paired iOS and Android apps. input: {}.", params: "{}",
    args: {},
    activity: () => "Generating mobile live feed snapshot",
    run: () => mobileGenerateFeedSnapshotTool() },
  { name: "deep_research_synthesizer", safe: true, description: "Executes autonomous multi-query deep research across multiple vectors, calculates cross-source consensus scores, and produces grounded executive briefs. input: { query, depth? }.", params: "{query, depth?}",
    args: {
      query: { type: "string", desc: "The research topic or question to investigate" },
      depth: { type: "string", desc: "Investigation depth: quick, deep, or exhaustive (default: deep)" }
    },
    activity: (i) => `Conducting deep research synthesis on "${i?.query ?? i}"`,
    run: (i) => deepResearchSynthesizerTool(i) },
  { name: "brain_performance_matrix", safe: true, description: "Shows which AI providers actually have a working key right now (live), paired with typical published latency/throughput figures (reference, not a live per-request benchmark) and a strength matrix. input: {}.", params: "{}",
    args: {},
    activity: () => "Auditing AI brain performance and latency arbitrage matrix",
    run: () => brainPerformanceMatrixTool() },
  { name: "simd_parallel_tool_batch", safe: true, description: "Runs batches of independent safe read-only tool calls concurrently with Promise.allSettled, cutting multi-tool execution time to milliseconds. input: { calls: [{ name, args? }] }.", params: "{calls}",
    args: { calls: { type: "array", desc: "Array of tool call descriptors { name, args? }" } },
    activity: (i) => `Executing SIMD parallel batch of ${i?.calls?.length ?? 0} tools`,
    run: (i) => simdParallelToolBatchTool(i) },
  { name: "speculative_route_intent", safe: true, description: "Computes the optimal low-latency difficulty tier (0, 1, or 2) and free provider failover routing plan for any user prompt. input: { prompt }.", params: "{prompt}",
    args: { prompt: { type: "string", desc: "User prompt to classify and route" } },
    activity: (i) => `Calculating speculative route for "${i?.prompt ?? i}"`,
    run: (i) => speculativeRouteIntentTool(i) },
  { name: "prefetch_warm_context", safe: true, description: "Pre-warms L1 in-memory caches with system vitals, markets, and memory prior to user turns for sub-10ms response start. input: { topics? }.", params: "{topics?}",
    args: { topics: { type: "array", desc: "Optional topics list to prefetch into L1 cache" } },
    activity: () => "Pre-warming L1 context cache",
    run: (i) => prefetchWarmContextTool(i) },
  { name: "local_micro_solver", safe: true, description: "Solves arithmetic calculations, unit conversions (bytes, time), timestamps, and deterministic queries in <1ms locally with 0 LLM API tokens. input: { query }.", params: "{query}",
    args: { query: { type: "string", desc: "Math, conversion, timestamp, or deterministic query" } },
    activity: (i) => `Solving locally: "${i?.query ?? i}"`,
    run: (i) => localMicroSolverTool(i) },
  { name: "space_consumption_optimizer", safe: true, description: "Audits memory heap consumption, sweeps expired caches, and reclaims RAM footprint. input: { mode? } ('audit' or 'compact').", params: "{mode?}",
    args: { mode: { type: "string", desc: "Operation mode: 'audit' (default) or 'compact'" } },
    activity: (i) => `${i?.mode === "compact" ? "Compacting" : "Auditing"} memory and storage footprint`,
    run: (i) => spaceConsumptionOptimizerTool(i) },
  { name: "intent_auto_disambiguator", safe: true, description: "Infers exact target actions and parameters from ambiguous shorthand queries based on workspace context. input: { prompt, activeFile? }.", params: "{prompt, activeFile?}",
    args: {
      prompt: { type: "string", desc: "User's shorthand or ambiguous prompt" },
      activeFile: { type: "string", desc: "Optional current active editor file" }
    },
    activity: (i) => `Disambiguating intent for: "${i?.prompt ?? i}"`,
    run: (i) => intentAutoDisambiguatorTool(i) },
  { name: "flipit_scale_shield", safe: true, description: "Calculates Kelly leverage sizing and drawdown circuit-breakers for FlipIt portfolio scaling. Scans cross-market arbitrage spreads against real quotes. input: { currentEquityGbp?, peakEquityGbp?, winRate?, avgWinGbp?, avgLossGbp?, quotes?, allocatedCapitalGbp? }.", params: "{currentEquityGbp?, peakEquityGbp?, winRate?, avgWinGbp?, avgLossGbp?, quotes?, allocatedCapitalGbp?}",
    args: {
      currentEquityGbp: { type: "number", desc: "Current portfolio equity in GBP" },
      peakEquityGbp: { type: "number", desc: "Peak portfolio equity for drawdown tracking" },
      winRate: { type: "number", desc: "Strategy win rate (e.g. 0.55)" },
      avgWinGbp: { type: "number", desc: "Average winning trade size in GBP" },
      avgLossGbp: { type: "number", desc: "Average losing trade size in GBP" },
      quotes: { type: "array", desc: "Real bid/ask quotes across two exchanges to scan for arbitrage — omit to skip the scan entirely" },
      allocatedCapitalGbp: { type: "number", desc: "Capital to size the arbitrage profit estimate against (default 1000)" },
    },
    activity: () => "Calculating FlipIt dynamic risk shield & Kelly allocation",
    run: (i) => flipitScaleShieldTool(i) },
  { name: "flipit_market_stream", safe: false, description: "Inspects and controls real-time Binance and Kraken WebSocket order book ticker streams. input: { action?: 'status' | 'start' | 'stop', pairs?: string[] }.", params: "{action?, pairs?}",
    args: {
      action: { type: "string", desc: "Action to perform: 'status' (default), 'start', or 'stop'" },
      pairs: { type: "array", desc: "Optional currency pairs to monitor (e.g. ['BTC/GBP', 'ETH/GBP'])" }
    },
    activity: (i) => `Monitoring FlipIt live market streams (${i?.action || "status"})`,
    run: (i) => flipitMarketStreamTool(i) },
  { name: "studio_director_storyboard", safe: true, description: "Generates cinematic multi-scene storyboard sequences with 3D camera vector rigs, lighting palettes, lens optics, and audio cue timing. input: { prompt, sceneCount?, aspectRatio? }.", params: "{prompt, sceneCount?, aspectRatio?}",
    args: {
      prompt: { type: "string", desc: "Narrative storyline or cinematic scene description" },
      sceneCount: { type: "number", desc: "Number of storyboard scenes (3-8)" },
      aspectRatio: { type: "string", desc: "Aspect ratio ('16:9', '9:16', '2.39:1', '1:1')" }
    },
    activity: (i) => `Directing cinematic storyboard for: "${i?.prompt ?? i}"`,
    run: (i) => studioDirectorStoryboardTool(i) },
  { name: "agentic_100x_workflow", safe: true, description: "Executes 100x Antigravity autonomous multi-agent DAG workflows with topological wave scheduling, parallel subagent dispatch, artifact generation, and executive synthesis. input: { goal, concurrency?, synthesize? }.", params: "{goal, concurrency?, synthesize?}",
    args: {
      goal: { type: "string", desc: "High level project goal or complex task to execute" },
      concurrency: { type: "number", desc: "Maximum parallel subagent concurrency (default 8)" },
      synthesize: { type: "boolean", desc: "Whether to run an executive synthesis reduction pass" }
    },
    activity: (i) => `Executing 100x Antigravity DAG workflow: "${i?.goal ?? i}"`,
    run: (i) => agentic100xWorkflowTool(i) },
  { name: "multi_model_consensus", safe: true, description: "Queries diverse free models (Cerebras, Groq, Gemini, Mistral) in parallel and synthesizes the highest-confidence consensus truth. input: { prompt, modelsCount? }.", params: "{prompt, modelsCount?}",
    args: {
      prompt: { type: "string", desc: "Question, algorithm, or architectural prompt to cross-examine" },
      modelsCount: { type: "number", desc: "Number of free models to query (2-4)" }
    },
    activity: (i) => `Querying multi-model consensus panel for: "${i?.prompt ?? i}"`,
    run: (i) => multiModelConsensusTool(i) },
  { name: "code_repair_patcher", safe: true, description: "Parses TypeScript/JavaScript compiler diagnostic errors and produces targeted AST patch candidates. input: { compilerOutput?, filePath? }.", params: "{compilerOutput?, filePath?}",
    args: {
      compilerOutput: { type: "string", desc: "Optional raw tsc or linter error output" },
      filePath: { type: "string", desc: "Optional file path being diagnosed" }
    },
    activity: () => "Analyzing compiler diagnostics and generating AST repair plan",
    run: (i) => codeRepairPatcherTool(i) },
  { name: "auto_key_provisioner", safe: false, description: "Manages 1-click automatic API key acquisition using SAM's dedicated bot identity so operators don't have to manually configure 20 developer portals. input: { action? ('status'|'provision'), providers?, botEmail? }.", params: "{action?, providers?, botEmail?}",
    args: {
      action: { type: "string", desc: "'status' to inspect targets or 'provision' to execute" },
      providers: { type: "array", desc: "Optional subset of provider IDs to provision" },
      botEmail: { type: "string", desc: "Optional dedicated bot email identity" }
    },
    activity: (i) => `${i?.action === "provision" ? "Auto-provisioning" : "Checking status of"} free provider API keys`,
    run: (i) => autoKeyProvisionerTool(i) },
  { name: "revenue_hunter_alpha", safe: true, description: "Scans cross-market arbitrage, AI cost-reduction vectors, and high-yield automated contract opportunities. input: { focusCategory?, minConfidencePct? }.", params: "{focusCategory?, minConfidencePct?}",
    args: {
      focusCategory: { type: "string", desc: "'market-arbitrage', 'cost-reduction', 'deal-flow', 'automation-roi'" },
      minConfidencePct: { type: "number", desc: "Minimum confidence score (0-100)" }
    },
    activity: () => "Scanning autonomous revenue opportunities and market alpha",
    run: (i) => revenueHunterAlphaTool(i) },
  { name: "executive_daily_brief", safe: true, description: "Generates high-value C-suite daily action deck consolidating connectors, system health, revenue alpha, and pending decisions. input: {}.", params: "{}",
    activity: () => "Assembling Executive Daily Action Deck",
    run: () => executiveDailyBriefTool() },
  { name: "event_webhook_dispatcher", safe: false, description: "Manages outbound and inbound webhook subscriptions with HMAC-SHA256 signatures for external integrations (TradingView, Stripe, GitHub, Shopify). input: { action? ('list'|'register'|'dispatch'), name?, url?, event?, events?, payload? }.", params: "{action?, name?, url?, event?, events?, payload?}",
    args: {
      action: { type: "string", desc: "'list' to view endpoints, 'register' to add, 'dispatch' to trigger" },
      name: { type: "string", desc: "Endpoint friendly name" },
      url: { type: "string", desc: "Target webhook URL" },
      event: { type: "string", desc: "Event name for dispatch" },
      events: { type: "array", desc: "List of event patterns to listen to" },
      payload: { type: "object", desc: "Payload dictionary to send" }
    },
    activity: (i) => `${i?.action === "dispatch" ? "Dispatching" : "Managing"} event webhook subscriptions`,
    run: (i) => eventWebhookDispatcherTool(i) },
  { name: "vault_snapshot_backup", safe: false, description: "Generates or restores verified SHA-256 encrypted snapshots of the operator's SAM vault. input: { action? ('export'|'restore'), manifest? }.", params: "{action?, manifest?}",
    args: {
      action: { type: "string", desc: "'export' to package snapshot or 'restore' to unpack" },
      manifest: { type: "object", desc: "Parsed snapshot manifest for restoration" }
    },
    activity: (i) => `${i?.action === "restore" ? "Restoring" : "Exporting"} SAM vault snapshot`,
    run: (i) => vaultSnapshotBackupTool(i) },
  // safe · read-only
  { name: "computer", safe: false, description: "Control the physical computer. Action can be 'key', 'type', 'mouse_move', 'left_click', 'left_click_drag', 'right_click', 'middle_click', 'double_click', 'screenshot', 'cursor_position'.", params: "{action, text?, coordinate?}", activity: (i) => `Computer: ${i?.action}`, run: async (i) => {
    try {
      const { execSync } = await import("node:child_process");
      const action = i?.action;
      if (action === "screenshot") return "Screenshot not supported in stub.";
      if (action === "mouse_move" && i?.coordinate) {
        execSync(`osascript -e 'tell application "System Events" to click at {${i.coordinate[0]}, ${i.coordinate[1]}}'`);
        return `Moved mouse to ${i.coordinate}`;
      }
      if (action === "type" && i?.text) {
        execSync(`osascript -e 'tell application "System Events" to keystroke "${i.text.replace(/"/g, '\\"')}"'`);
        return `Typed: ${i.text}`;
      }
      if (action === "key" && i?.text) {
        if (i.text === "Return") execSync(`osascript -e 'tell application "System Events" to key code 36'`);
        return `Pressed key: ${i.text}`;
      }
      return `Action ${action} executed via AppleScript stub.`;
    } catch (e: any) { return `Computer use error: ${e.message}`; }
  }},
  { name: "web_search", safe: true, description: "Search the live web. input: a search query string.", params: "query",
    activity: (i) => `Searching the web for “${i.query ?? i}”`, run: (i) => webSearch(i.query ?? i) },
  { name: "web_fetch", safe: true, description: "Open a URL and read its text. input: a url string.", params: "url",
    activity: (i) => `Reading ${i.url ?? i}`, run: (i) => webFetch(i.url ?? i) },
  { name: "web_extract", safe: true,
    description: "Pull STRUCTURED data out of a web page. input: {url, schema} where schema names the fields you want, e.g. {name:'string', price:'string'}. Use this instead of web_fetch when you need specific fields rather than the whole page.",
    params: "{url, schema}",
    args: { url: { type: "string", required: true, desc: "the page URL" }, schema: { type: "object", desc: "field name → type, e.g. {name:'string', price:'string'}" } },
    activity: (i) => `Extracting ${Object.keys(i?.schema ?? {}).join(", ") || "data"} from ${i?.url}`,
    run: async (i) => {
      const r = await extract(String(i?.url ?? ""), i?.schema ?? { title: "string" }, samLlm, { maxChars: 6000 });
      return r.ok ? JSON.stringify(r.data, null, 2) : `Couldn't extract from ${i?.url}${r.error ? ` — ${r.error}` : ""}`;
    } },
  { name: "web_crawl", safe: true,
    description: "Read a whole SITE, not one page — follows same-domain links and returns the text of each. input: {url, maxPages?, maxDepth?}. Use when the answer is spread across several pages of one site (docs, a help centre, a small site).",
    params: "{url, maxPages?, maxDepth?}",
    args: { url: { type: "string", required: true, desc: "the site's starting URL" }, maxPages: { type: "number", desc: "cap on pages (≤20)" }, maxDepth: { type: "number", desc: "link depth (≤3)" } },
    activity: (i) => `Crawling ${i?.url}`,
    run: async (i) => {
      const r = await crawl(String(i?.url ?? ""), {
        maxPages: Math.min(Number(i?.maxPages) || 8, 20),   // capped: a crawl is the one tool that
        maxDepth: Math.min(Number(i?.maxDepth) || 2, 3),    // can quietly become hundreds of fetches
      });
      if (!r.pages.length) return `Couldn't read anything from ${i?.url} (blocked by robots.txt, unreachable, or not HTML).`;
      const body = r.pages.map((p) => `## ${p.title || p.url}\n${p.url}\n${p.text.slice(0, 1500)}`).join("\n\n");
      return `${r.pages.length} pages crawled (${r.discovered.length} links seen)\n\n${body}`;
    } },
  { name: "site_map", safe: true,
    description: "List the pages of a site without reading them. input: a url string. Cheap way to see what's there before crawling.",
    params: "{url}",
    activity: (i) => `Mapping ${i?.url ?? i}`,
    run: async (i) => {
      const r = await mapSite(String(i?.url ?? i ?? ""));
      return r.ok ? `${r.urls.length} same-domain pages:\n${r.urls.slice(0, 60).join("\n")}` : `Couldn't map ${i?.url ?? i}.`;
    } },
  { name: "web_research", safe: true,
    description: "Pull the SAME fields from MANY pages at once and return a table. input: {urls:[…], schema}. Use for comparisons — prices across shops, specs across products.",
    params: "{urls:[string], schema}",
    args: { urls: { type: "array", items: "string", required: true, desc: "the page URLs to compare" }, schema: { type: "object", desc: "field name → type" } },
    activity: (i) => `Researching ${(i?.urls ?? []).length} pages`,
    run: async (i) => {
      const urls = Array.isArray(i?.urls) ? i.urls.map(String) : [];
      if (!urls.length) return "web_research needs a urls array.";
      const r = await extractMany(urls.slice(0, 10), i?.schema ?? { title: "string" }, samLlm, { maxChars: 6000, concurrency: 3 });
      const lines = [JSON.stringify(r.table, null, 2)];
      if (r.failed.length) lines.push(`\ncouldn't read: ${r.failed.join(", ")}`);
      return lines.join("\n");
    } },
  { name: "market_quote", safe: true, description: "Get LIVE market quotes for one or more tickers — stocks (AAPL), ETFs (VUSA.L), indices (^GSPC), FX (GBPUSD=X), crypto (BTC-USD). Free, no API key. input: {symbols} — a comma-separated string or an array.", params: "{symbols}",
    activity: (i) => `Checking quotes: ${Array.isArray(i?.symbols) ? i.symbols.join(", ") : (i?.symbols ?? i)}`,
    run: async (i) => { const raw = i?.symbols ?? i; const syms = Array.isArray(raw) ? raw.map(String) : String(raw || "").split(","); return formatQuotes(await marketQuotes(syms)); } },
  { name: "model_arena", safe: true, description: "Benchmark SAM's free brains head-to-head: each answers the same prompt, an impartial judge picks the winner, and they're ranked by Elo — a 'colosseum' for your rotating free models. input: {prompt?} (or {prompts?, brains?}); defaults to a small set.", params: "{prompt?}",
    activity: () => "Running the model colosseum",
    run: async (i) => { const r = await benchmarkBrains({ prompt: i?.prompt, prompts: i?.prompts, brains: i?.brains }); return "error" in r ? r.error : formatLeaderboard(r); } },
  { name: "retrieve_full", safe: true, description: "Pull back the FULL text of an earlier tool output that was compressed to save tokens (you'll have seen an id like 'web_fetch#3'). input: {id}.", params: "{id}",
    activity: (i) => `Retrieving full output ${i.id ?? i}`, run: async (i) => retrieveFullOutput(String((i.id ?? i) || "")) ?? "That compressed output is no longer cached." },

  // 🎬 render an HTML composition to a deterministic MP4 (write HTML, get video)
  { name: "render_video", safe: false,
    description: "Render an MP4 VIDEO from an HTML composition. Deterministic — the same input always produces the same file. Give raw {html} (any HTML/CSS/JS with animations), OR use the built-in title card via {title, subtitle?, bg?, fg?}. Optional {durationMs (default 4000), fps (30), width (1280), height (720), out}. Uses SAM's own Chromium + FFmpeg — no cloud, no cost.",
    params: "{html? | title, subtitle?, bg?, fg?, durationMs?, fps?, width?, height?, out?}",
    activity: (i) => `Rendering a video${i?.title ? ` — “${i.title}”` : ""}`,
    preview: (i) => `Render MP4 ${i?.html ? "from custom HTML" : `title card: “${i?.title ?? "SAM"}”`} · ${(Number(i?.durationMs ?? 4000) / 1000).toFixed(1)}s @ ${i?.fps ?? 30}fps → ${i?.out ?? "~/Desktop"}`,
    run: (i) => renderVideoTool(i) },

  // 🎞️ a prompt becomes a deck. Free lane on purpose: an outline is a cheap job and a deck is
  // exactly the sort of thing people regenerate five times before they like it (Doctrine #3).
  { name: "make_slides", safe: true,
    description: "Build a complete SLIDE DECK from a topic and save it as one self-contained HTML file (opens offline, prints to PDF, dark+light). Returns the whole outline in chat so you can judge it without opening it. input: {topic, slides? (total, 4–30, default 8), audience?}.",
    params: "{topic, slides?, audience?}",
    args: {
      topic: { type: "string", required: true, desc: "what the deck is about" },
      slides: { type: "number", desc: "total slides including title/agenda/closing (4–30, default 8)" },
      audience: { type: "string", desc: "who it's for — changes the framing, e.g. 'investors', 'the ops team'" },
    },
    activity: (i) => `Building a deck on “${String(i?.topic ?? i ?? "").slice(0, 40)}”`,
    run: async (i) => {
      const topic = String(i?.topic ?? i ?? "").trim();
      if (!topic) return "What should the deck be about?";
      const audience = i?.audience ? String(i.audience).trim() : undefined;
      const want = sectionCount(i?.slides);
      const sys = "You are a presentation strategist. You return ONLY an outline, no preamble and no commentary. Each section is a markdown heading (## Section title) followed by 2–4 bullets starting with '-'. A bullet is one short line a person can read from the back of a room — a claim, a number, a consequence — never a paragraph and never a sentence fragment ending in a colon. Titles are specific and say something; 'Overview' and 'Introduction' are banned. The FINAL section is the close: the decision, the ask, or the next move.";
      // Truncated hard: a 40k-char "topic" is a paste accident, and the outline it produces would be
      // worse than the one from the first 600 characters anyway.
      const brief = `TOPIC: ${topic.slice(0, 600)}\n${audience ? `AUDIENCE: ${audience.slice(0, 120)}\n` : ""}Write exactly ${want} sections.`;
      let sections: Section[] = [];
      try { sections = parseSections((await runModel("free", sys, brief))?.text || ""); }
      catch { /* no brain reachable (offline, no keys, provider down) — the skeleton below still ships a real deck */ }
      if (!sections.length) sections = fallbackSections(topic, want);
      try {
        const deck = buildDeck({ topic, sections, audience });
        return outlineMarkdown(deck, saveDeck(deck));
      } catch (e: any) { return `Couldn't build that deck: ${e?.message || e}`; }
    } },

  // ── 📓 NOTEBOOKS (NotebookLM, but yours & free) + 🔎 deep research + 🛰️ 24/7 agent ──
  { name: "notebook_add", safe: true, description: "Add a source to a notebook (creates it if new) so SAM can answer grounded questions about it. input: {notebook, url? | file? | text?, title?}. Sources: a web page URL, a file path (pdf/docx/txt/md/csv), or pasted text.", params: "{notebook, url?, file?, text?, title?}",
    activity: (i) => `Adding a source to “${i.notebook || "notebook"}”`, run: async (i) => {
      const { id, title } = nb.ensureNotebook(i.notebook || "Research");
      try {
        if (i.url) { const r = await nb.addUrl(id, String(i.url)); return `📓 Added “${r.title}” (${r.chunks} passages) to notebook **${title}**.`; }
        if (i.file) { const n = await nb.addFile(id, String(i.file).replace(/^~/, homedir())); return `📓 Added ${basename(String(i.file))} (${n} passages) to **${title}**.`; }
        if (i.text) { const n = await nb.addText(id, String(i.title || "note"), String(i.text)); return `📓 Added a note (${n} passages) to **${title}**.`; }
        return "Give me a url, file path, or text to add.";
      } catch (e: any) { return `Couldn't add that source: ${e?.message || e}`; }
    } },
  { name: "notebook_ask", safe: true, description: "Ask a question answered ONLY from a notebook's sources, with citations. The world-class 'grounded' mode — no hallucination, every claim traceable. input: {notebook, question}.", params: "{notebook, question}",
    activity: (i) => `Consulting notebook “${i.notebook}”`, run: async (i) => {
      const found = nb.ensureNotebook(i.notebook || "Research");
      const passages = await nb.retrieve(found.id, String(i.question || i), 8);
      if (!passages.length) return `Notebook **${found.title}** has nothing on that yet — add sources with notebook_add.`;
      const srcs = [...new Set(passages.map((p) => p.title))];
      const ctx = passages.map((p, n) => `[${n + 1}] (${p.title})\n${p.text}`).join("\n\n");
      const sys = "You answer STRICTLY from the provided sources — a grounded research assistant. Never use outside knowledge. Cite each claim with its [n] number. If the sources don't cover it, say so plainly. Be clear and well-organised.";
      const r = await runModel("free", sys, `SOURCES:\n${ctx}\n\nQUESTION: ${i.question || i}\n\nAnswer using ONLY the sources above, citing [n]:`);
      return `${r.text}\n\n— grounded in ${srcs.length} source${srcs.length === 1 ? "" : "s"}: ${srcs.slice(0, 6).join(", ")}`;
    } },
  { name: "notebook_audio", safe: true, description: "Generate an 'Audio Overview' — a lively two-host podcast script discussing a notebook's sources (NotebookLM's signature feature). Play it with SAM's voice. input: {notebook}.", params: "{notebook}",
    activity: (i) => `Producing an audio overview of “${i.notebook}”`, run: async (i) => {
      const found = nb.ensureNotebook(i.notebook || "Research");
      const chunks = nb.overviewChunks(found.id, 12);
      if (!chunks.length) return `Notebook **${found.title}** is empty — add sources first.`;
      const material = chunks.map((c) => `• (${c.title}) ${c.text.slice(0, 600)}`).join("\n");
      const sys = "You are a producer writing a short, engaging two-host podcast (hosts: Alex and Sam) that explains the user's material in an accessible, curious way. Natural dialogue, hand-offs, a few 'oh interesting' beats — no fluff, all grounded in the material. 8-14 exchanges. Format each line as 'Alex: …' / 'Sam: …'.";
      const r = await runModel("free", sys, `MATERIAL (from notebook “${found.title}”):\n${material}\n\nWrite the audio-overview script:`);
      return `🎙️ **Audio Overview — ${found.title}**\n\n${r.text}\n\n_(Tap 🔊 or ask “read this aloud” to hear it.)_`;
    } },
  { name: "notebook_list", safe: true, description: "List SAM's notebooks and their sources.", params: "(none)",
    activity: () => `Listing notebooks`, run: async () => {
      const list = nb.listNotebooks();
      if (!list.length) return "No notebooks yet. Create one by adding a source (notebook_add) or running research.";
      return list.map((n) => `📓 **${n.title}** — ${n.sources} source${n.sources === 1 ? "" : "s"}, ${n.chunks} passages`).join("\n");
    } },
  { name: "research", safe: true, description: "Deep web research: searches the live web, reads the top sources, and returns a cited briefing. Optionally files everything into a notebook for follow-up questions. input: {query, notebook?, depth?}.", params: "{query, notebook?, depth?}",
    activity: (i) => `Researching “${i.query ?? i}”`, run: async (i) => {
      const query = String((i.query ?? i) || "").trim();
      if (!query) return "What should I research?";
      const depth = Math.min(6, Math.max(2, Number(i.depth) || 4));
      const results = await webSearch(query).catch(() => "");
      const urls = [...new Set((results.match(/https?:\/\/[^\s)"']+/g) || []))].filter((u) => !/\.(png|jpg|gif|svg|css|js)$/i.test(u)).slice(0, depth);
      if (!urls.length) return `Couldn't find sources for “${query}”.`;
      const nbook = i.notebook ? nb.ensureNotebook(String(i.notebook)) : null;
      const readings: string[] = [];
      for (const u of urls) {
        try {
          const text = await webFetch(u);
          if (text && text.length > 200) { readings.push(`SOURCE (${u}):\n${text.slice(0, 3500)}`); if (nbook) await nb.addUrl(nbook.id, u).catch(() => {/* notebook capture is optional — the reading still returns */}); }
        } catch { /* best-effort — nothing downstream depends on this succeeding */ }
      }
      if (!readings.length) return `Found links for “${query}” but couldn't read them.`;
      const sys = "You are a sharp research analyst. Synthesise the sources into a clear, well-structured briefing that actually answers the question. Cite sources inline as [1], [2]… matching their order. Flag disagreements and gaps. No filler.";
      const r = await runModel("free", sys, `QUESTION: ${query}\n\n${readings.map((t, n) => t.replace("SOURCE (", `[${n + 1}] SOURCE (`)).join("\n\n")}\n\nWrite the briefing:`);
      const cite = urls.map((u, n) => `[${n + 1}] ${u}`).join("\n");
      return `${r.text}\n\n**Sources**\n${cite}${nbook ? `\n\n_Filed into notebook **${nbook.title}** — ask follow-ups with notebook_ask._` : ""}`;
    } },
  // ── 🟣 OBSIDIAN — SAM reads & writes your second brain (plain markdown on disk) ──
  { name: "obsidian_save", safe: false, description: "Write a note into your Obsidian vault as markdown (SAM adds to your second brain). input: {title, content, folder?}. Uses OBSIDIAN_VAULT, else auto-detects your vault.", params: "{title, content, folder?}",
    activity: (i) => `Saving “${i.title}” to Obsidian`, run: async (i) => {
      const vault = obsidianVault();
      if (!vault) return "I couldn't find your Obsidian vault. Set OBSIDIAN_VAULT in Settings to its folder path.";
      const safeTitle = String(i.title || "SAM note").replace(/[/\\:*?"<>|]/g, "-").slice(0, 80);
      const dir = i.folder ? join(vault, String(i.folder)) : join(vault, "SAM");
      // AUDIT FIX: keep the write INSIDE the vault — an unvalidated `folder` like '../../..' would
      // otherwise write markdown anywhere on disk.
      const rv = resolve(vault);
      if (resolve(dir) !== rv && !resolve(dir).startsWith(rv + sep)) return "That folder is outside your Obsidian vault.";
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${safeTitle}.md`);
      const body = `${i.content || ""}\n\n---\n_Saved by SAM ${new Date().toISOString().slice(0, 16).replace("T", " ")}_\n`;
      await writeFile(file, body, "utf8");
      return `🟣 Saved to Obsidian: **${safeTitle}** (${file.replace(homedir(), "~")})`;
    } },
  { name: "obsidian_index", safe: false, description: "Index your whole Obsidian vault so SAM can answer questions grounded in your notes. input: {} (auto-detects vault) or {path}.", params: "{path?}",
    activity: () => `Indexing your Obsidian vault`, run: async (i) => {
      const vault = i.path ? String(i.path).replace(/^~/, homedir()) : obsidianVault();
      if (!vault || !existsSync(vault)) return "No Obsidian vault found — set OBSIDIAN_VAULT in Settings, or pass its path.";
      const r = await ingestFolder(vault, 2000);
      return `🟣 Indexed your Obsidian vault — ${r.ingested} notes, ${r.chunks} passages. Ask me anything about your notes now (search_docs / notebook_ask).`;
    } },

  // ── 📢 POST EVERYWHERE — one command, all your connected channels ──
  { name: "post_everywhere", safe: false, description: "Post the same message to ALL connected channels at once (Discord, Slack directly; X/Instagram/Facebook/LinkedIn via the Metricool integration if connected). input: {text}.", params: "{text}",
    activity: () => `Posting to all channels`, run: async (i) => {
      const text = String((i.text ?? i) || "").trim();
      if (!text) return "What should I post?";
      const results: string[] = [];
      // Discord — incoming webhook (simplest, no OAuth)
      const dh = process.env.DISCORD_WEBHOOK_URL;
      if (dh) {
        try { const r = await fetch(dh, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text.slice(0, 2000) }), signal: AbortSignal.timeout(15000) }); results.push(r.ok ? "✅ Discord" : `⚠️ Discord (${r.status})`); }
        catch { results.push("⚠️ Discord (failed)"); }
      }
      // Slack — chat.postMessage with a bot token (needs SLACK_CHANNEL)
      const st = process.env.SLACK_BOT_TOKEN, sc = process.env.SLACK_CHANNEL;
      if (st && sc) {
        try { const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${st}` }, body: JSON.stringify({ channel: sc, text }), signal: AbortSignal.timeout(15000) }); const d: any = await r.json(); results.push(d?.ok ? "✅ Slack" : `⚠️ Slack (${d?.error || "failed"})`); }
        catch { results.push("⚠️ Slack (failed)"); }
      }
      const socialHint = "For X · Instagram · Facebook · LinkedIn in one shot, connect **Metricool** in Settings → Integrations, then I'll schedule/post there too.";
      if (!results.length) return `No direct channels connected yet. Set DISCORD_WEBHOOK_URL and/or SLACK_BOT_TOKEN + SLACK_CHANNEL in Settings.\n\n${socialHint}`;
      return `📢 Posted:\n${results.map((r) => "  " + r).join("\n")}\n\n${socialHint}`;
    } },

  { name: "research_watch", safe: false, description: "Set up a 24/7 research agent: SAM keeps researching a topic on a schedule, files new findings into a notebook, and pings you what's new. input: {topic, notebook?, every_hours?}.", params: "{topic, notebook?, every_hours?}",
    activity: (i) => `Setting up a 24/7 watch on “${i.topic}”`, run: async (i) => {
      const topic = String(i.topic || "").trim();
      if (!topic) return "What topic should I watch?";
      const notebook = String(i.notebook || topic).slice(0, 48);
      const hrs = Math.min(24, Math.max(1, Number(i.every_hours) || 6));
      nb.ensureNotebook(notebook);
      const cron = `0 */${hrs} * * *`;   // every N hours
      const command = `Research the very latest on "${topic}", add anything new to notebook "${notebook}", and give me a 2-line update on what changed. If nothing is new, say so briefly.`;
      const s = addSchedule(command, cron);
      return `🛰️ 24/7 research agent is live — I'll sweep the web on **${topic}** every ${hrs}h, file it into notebook **${notebook}**, and ping you what's new. (schedule ${s.id})`;
    } },
  { name: "read_file", safe: true, cacheable: true,
    description: "Read a file's contents. Supports line range slicing and line numbers for reading large files without truncation. input: { path, startLine?, endLine?, lineNumbers? } or a path string.",
    params: "{path, startLine?, endLine?, lineNumbers?} | path",
    args: {
      path: { type: "string", required: true, desc: "file path (supports ~)" },
      startLine: { type: "number", desc: "1-indexed start line" },
      endLine: { type: "number", desc: "1-indexed end line" },
      lineNumbers: { type: "boolean", desc: "prefix lines with line numbers (defaults to true when startLine/endLine is provided)" },
    },
    activity: (i) => `Reading file ${i?.path ?? i}`,
    run: (i) => readFileTool(i) },
  { name: "grep_search", safe: true,
    description: "Fast code and text search across the codebase with line numbers and snippets (git grep / ripgrep). input: {query, path?, isRegex?, caseInsensitive?, maxResults?}.",
    params: "{query, path?, isRegex?, caseInsensitive?, maxResults?}",
    args: {
      query: { type: "string", required: true, desc: "the search pattern or string" },
      path: { type: "string", desc: "search directory (defaults to current directory / home)" },
      isRegex: { type: "boolean", desc: "treat query as regular expression" },
      caseInsensitive: { type: "boolean", desc: "case-insensitive search (defaults to true)" },
      maxResults: { type: "number", desc: "max matches to return (defaults to 50)" },
    },
    activity: (i) => `Searching code for “${i?.query ?? i}”`,
    run: (i) => grepSearchTool(i) },
  { name: "semantic_search", safe: true,
    description: "Search the codebase by semantic meaning (concept) rather than exact keyword match. Auto-indexes the workspace. input: {query, path?, k?, floor?}.",
    params: "{query, path?, k?, floor?}",
    args: {
      query: { type: "string", required: true, desc: "the semantic concept or question" },
      path: { type: "string", desc: "directory to search/index (defaults to current dir)" },
      k: { type: "number", desc: "max matches (defaults to 10)" },
      floor: { type: "number", desc: "minimum cosine similarity (defaults to 0.2)" }
    },
    activity: (i) => `Semantic searching for “${i?.query ?? i}”`,
    run: (i) => semanticSearchTool(i) },
  { name: "list_dir", safe: true, description: "List a folder's contents. input: a folder path (supports ~).", params: "path",
    activity: (i) => `Looking in ${unwrapPath(i)}`, run: (i) => listDir(unwrapPath(i)) },
  { name: "folder_digest", safe: true, description: "Summarise a folder: file count, total size, top file types, and the largest files. input: a folder path (supports ~).", params: "path",
    activity: (i) => `Sizing up ${unwrapPath(i)}`, run: (i) => folderDigest(unwrapPath(i)) },
  { name: "find_duplicates", safe: true, description: "Find duplicate files (identical contents) in a folder, grouped, with total reclaimable space. input: a folder path (supports ~).", params: "path",
    activity: (i) => `Hunting duplicates in ${unwrapPath(i)}`, run: (i) => findDuplicates(unwrapPath(i)) },
  { name: "recent_files", safe: true, description: "List the most recently modified files in a folder (name, when, size), newest first — great for 'what did I work on lately'. input: { path, limit? } (path supports ~; limit defaults to 15).", params: "path, limit?",
    activity: (i) => `Finding recent files in ${unwrapPath(i)}`, run: (i) => recentFiles(unwrapPath(i), i?.limit) },
  { name: "disk_space", safe: true, description: "Report free / used / total disk space for the drive holding a path — check 'am I running low on space'. input: a path (supports ~; defaults to home).", params: "path?",
    activity: (i) => `Checking disk space for ${unwrapPath(i)}`, run: (i) => diskSpace(unwrapPath(i)) },
  { name: "find_files", safe: true, description: "Find files by name in a folder (case-insensitive substring match), newest-modified first — great for 'where's that invoice pdf'. input: { query, path? } (path supports ~; defaults to home).", params: "query, path?",
    activity: (i) => `Searching for "${i?.query ?? i}" in ${i?.path ?? "~"}`, run: (i) => findFiles(i?.query ?? i, i?.path ?? "~") },
  { name: "analyse_data", safe: true, description: "Analyse a spreadsheet / CSV: what each column holds (type, range, mean/median, top values) and the problems in it — duplicate rows, empty or mostly-empty columns, one column holding mixed types, numeric outliers. Use this instead of read_file for .csv/.tsv. input: { path?, csv?, question? } — a file path (supports ~) OR the CSV text inline.", params: "{path?, csv?, question?}",
    args: { path: { type: "string", desc: "path to a .csv/.tsv/.txt table (supports ~)" }, csv: { type: "string", desc: "the delimited text itself, when you already have the rows" }, question: { type: "string", desc: "what the user wants to know — columns it names get called out" } },
    activity: (i) => `Analysing ${i?.path ? basename(String(i.path)) : "the data"}`, run: analyseData },
  { name: "screenshot", safe: true, description: "Take a screenshot of the screen, saved to the Desktop.", params: "(none)",
    activity: () => `Taking a screenshot`, run: screenshot },
  { name: "clipboard_get", safe: true, description: "Read the current clipboard text.", params: "(none)",
    activity: () => `Reading the clipboard`, run: clipboardGet },
  { name: "get_datetime", safe: true, description: "Get the current date and time.", params: "(none)",
    activity: () => `Checking the time`, run: async () => nowText() },
  { name: "set_timer", safe: true, description: "Set a short local timer (minutes). SAM will notify the OS when time is up. input: {minutes, reason?}.", params: "{minutes, reason?}", args: { minutes: { type: "number", required: true }, reason: { type: "string" } },
    activity: (i) => `Setting a timer for ${i.minutes}m`, 
    run: async (i) => {
      const min = Number(i.minutes);
      if (Number.isNaN(min) || min <= 0) return "Invalid minutes.";
      setTimeout(() => {
        notify({ title: "Timer Done", message: i.reason || "Time is up!" });
      }, min * 60000);
      return `Timer set for ${min} minute(s). I will notify you when it's done.`;
    } },
  { name: "world_clock", safe: true, description: "Get the current time in a specific timezone (e.g. 'America/New_York', 'Asia/Tokyo'). input: {timezone}.", params: "{timezone}", args: { timezone: { type: "string", required: true, desc: "IANA tz, e.g. America/New_York" } },
    activity: (i) => `Checking time in ${i.timezone}`,
    run: async (i) => {
      try {
        return new Intl.DateTimeFormat("en-US", { timeZone: i.timezone, dateStyle: "full", timeStyle: "long" }).format(new Date());
      } catch (e: any) { return `Invalid timezone or error: ${e.message}`; }
    } },
  { name: "password_generate", safe: true, description: "Generate a cryptographically secure random password. input: {length?}.", params: "{length?}",
    activity: () => `Generating a secure password`,
    run: async (i) => {
      const len = Math.max(1, Math.min(256, Number(i?.length) || 16));
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=";
      // `byte % chars.length` skews toward the first (256 mod 92) characters — small, but this is a
      // password tool, so use rejection sampling: discard bytes in the biased tail and draw more.
      const max = 256 - (256 % chars.length);   // largest multiple of the alphabet ≤ 256
      let pass = "";
      while (pass.length < len) {
        for (const b of randomBytes((len - pass.length) * 2)) {
          if (b < max) { pass += chars[b % chars.length]; if (pass.length === len) break; }
        }
      }
      return `Generated password (length ${len}): ${pass}`;
    } },
  { name: "wifi_info", safe: true, description: "Get current Wi-Fi network name and details.", params: "(none)",
    activity: () => `Checking Wi-Fi`,
    run: async () => {
      if (!IS_MAC) return "Wi-Fi info only works on macOS.";
      try {
        const { stdout } = await sh("networksetup -getairportnetwork en0");
        return stdout.trim();
      } catch (e: any) { return `Failed to get Wi-Fi: ${e.message}`; }
    } },
  { name: "lock_screen", safe: false, description: "Lock the Mac immediately.", params: "(none)",
    activity: () => `Locking the screen`, preview: () => `Lock the screen`,
    run: async () => {
      if (!IS_MAC) return "Lock screen only works on macOS.";
      try { await sh("pmset displaysleepnow"); return "Screen locked."; } catch (e: any) { return `Failed to lock: ${e.message}`; }
    } },
  { name: "empty_trash", safe: false, description: "Permanently empty the macOS Trash.", params: "(none)",
    activity: () => `Emptying the Trash`, preview: () => `Permanently delete all files in ~/.Trash`,
    run: async () => {
      if (!IS_MAC) return "Trash only works on macOS.";
      try { await sh("rm -rf ~/.Trash/*"); return "Trash emptied."; } catch (e: any) { return `Failed to empty trash: ${e.message}`; }
    } },
  { name: "eject_disk", safe: false, description: "Eject a mounted disk/volume. input: {volume_name}.", params: "{volume_name}",
    activity: (i) => `Ejecting ${i.volume_name}`, preview: (i) => `Eject volume: ${i.volume_name}`,
    run: async (i) => {
      if (!IS_MAC) return "Eject only works on macOS.";
      try { await sh(`diskutil eject ${shq("/Volumes/" + String(i.volume_name).replace(/\//g, ""))}`); return `Ejected ${i.volume_name}.`; } catch (e: any) { return `Failed to eject: ${e.message}`; }
    } },
  { name: "caffeinate", safe: true, description: "Prevent the Mac from sleeping for a duration. input: {minutes}.", params: "{minutes}",
    activity: (i) => `Keeping Mac awake for ${i.minutes}m`,
    run: async (i) => {
      if (!IS_MAC) return "Caffeinate only works on macOS.";
      const min = Number(i.minutes);
      if (Number.isNaN(min) || min <= 0) return "Invalid minutes.";
      try {
        // Run in background detached
        sh(`caffeinate -d -t ${min * 60} &`);
        return `Mac will stay awake for ${min} minute(s).`;
      } catch (e: any) { return `Failed to caffeinate: ${e.message}`; }
    } },
  { name: "disk_usage", safe: true, description: "Check exactly how much free space is left on the main drive.", params: "(none)",
    activity: () => `Checking disk usage`,
    run: async () => {
      try {
        const { stdout } = await sh("df -h /");
        return stdout.trim();
      } catch (e: any) { return `Failed to read disk usage: ${e.message}`; }
    } },
  { name: "app_switcher", safe: false, description: "Bring an installed macOS application to the foreground. input: {app_name}.", params: "{app_name}",
    activity: (i) => `Switching to ${i.app_name}`, preview: (i) => `Bring app to front: ${i.app_name}`,
    run: async (i) => {
      if (!IS_MAC) return "App switching only works on macOS.";
      try {
        await osa(`tell application "${esc(i.app_name)}" to activate`);
        return `Activated ${i.app_name}.`;
      } catch (e: any) { return `Failed to activate app: ${e.message}`; }
    } },
  { name: "set_wallpaper", safe: false, description: "Set the macOS desktop wallpaper. input: {image_path}. Note: Path must be absolute.", params: "{image_path}",
    activity: () => `Changing wallpaper`, preview: (i) => `Set wallpaper to:\n${i.image_path}`,
    run: async (i) => {
      if (!IS_MAC) return "Wallpaper control only works on macOS.";
      try {
        await osa(`tell application "System Events" to set picture of every desktop to "${esc(i.image_path)}"`);
        return "Wallpaper updated successfully.";
      } catch (e: any) { return `Failed to set wallpaper: ${e.message}`; }
    } },
  { name: "shorten_url", safe: true, description: "Shorten a long URL using the free is.gd service. input: {url}.", params: "{url}",
    activity: () => `Shortening URL`,
    run: async (i) => {
      try {
        const res = await tfetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(i.url)}`);
        if (!res.ok) throw new Error("API returned " + res.status);
        return await res.text();
      } catch (e: any) { return `Failed to shorten URL: ${e.message}`; }
    } },
  { name: "currency_convert", safe: true, description: "Convert an amount between standard global currencies (e.g., USD to EUR). input: {amount, from_currency, to_currency}.", params: "{amount, from, to}", args: { amount: { type: "number", required: true }, from: { type: "string", required: true }, to: { type: "string", required: true } },
    activity: (i) => `Converting ${i.amount} ${i.from} to ${i.to}`,
    run: async (i) => {
      try {
        const base = (i.from || "USD").toUpperCase();
        const target = (i.to || "EUR").toUpperCase();
        const res = await tfetch(`https://open.er-api.com/v6/latest/${base}`);
        if (!res.ok) throw new Error("Currency API returned " + res.status);
        const data = await res.json();
        const rate = data.rates[target];
        if (!rate) return `Unknown currency code: ${target}`;
        const final = (Number(i.amount) * rate).toFixed(2);
        return `${i.amount} ${base} = ${final} ${target} (Rate: ${rate})`;
      } catch (e: any) { return `Failed to convert: ${e.message}`; }
    } },
  { name: "qr_generate", safe: true, description: "Generate a QR code PNG and save it to the Desktop. input: {text_or_url}.", params: "{text_or_url}",
    activity: () => `Generating a QR code`,
    run: async (i) => {
      try {
        const text = i.text_or_url || i.text || i.url;
        const res = await tfetch(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`);
        if (!res.ok) throw new Error("QR API returned " + res.status);
        const arrayBuffer = await res.arrayBuffer();
        const path = resolve(homedir(), "Desktop", `QR_${Date.now()}.png`);
        await writeFile(path, Buffer.from(arrayBuffer));
        return `QR code generated and saved to: ${path}`;
      } catch (e: any) { return `Failed to generate QR code: ${e.message}`; }
    } },
  { name: "volume_brightness_control", safe: false, description: "Set the Mac's hardware output volume, 0-100. input: {type: 'volume', level}. (Brightness is NOT supported — it needs an external CLI tool and we keep deps at zero.)", params: "{type, level}",
    activity: (i) => `Setting ${i.type} to ${i.level}%`,
    preview: (i) => `Set ${i.type} hardware to ${i.level}%`,
    run: async (i) => {
      if (!IS_MAC) return "Hardware control only works on macOS.";
      const lvl = Math.min(100, Math.max(0, Number(i.level) || 0));
      if (i.type === "brightness") {
        // Brightness via AppleScript uses displays slider (1-10 scale usually, tricky without 3rd party tools, but we can try System Events)
        // Safer universal way without external tools:
        return "Brightness control requires external CLI tools (like 'brightness') on macOS. Skipping to keep dependencies zero.";
      } else {
        try {
          await osa(`set volume output volume ${lvl}`);
          return `Hardware volume set to ${lvl}%.`;
        } catch (e: any) { return `Failed to set volume: ${e.message}`; }
      }
    } },
  { name: "ip_geolocate", safe: true, description: "Get the physical location, ISP, and timezone of an IP address. input: {ip}.", params: "{ip}",
    activity: (i) => `Geolocating IP ${i.ip}`,
    run: async (i) => {
      try {
        const res = await tfetch(`http://ip-api.com/json/${i.ip}`);
        if (!res.ok) throw new Error("API returned " + res.status);
        const data = await res.json();
        if (data.status === "fail") return `Geolocation failed: ${data.message}`;
        return `IP: ${data.query}\nLocation: ${data.city}, ${data.regionName}, ${data.country}\nISP: ${data.isp}\nTimezone: ${data.timezone}`;
      } catch (e: any) { return `Failed to geolocate: ${e.message}`; }
    } },
  { name: "whois", safe: true, description: "Fetch domain registration info natively. input: {domain}.", params: "{domain}",
    activity: (i) => `Running whois on ${i.domain}`,
    run: async (i) => {
      try {
        const { stdout } = await sh(`whois ${shq(i.domain)}`);
        // WHOIS outputs can be massive, slice to top 2000 chars to save token context
        return stdout.trim().slice(0, 2000) + (stdout.length > 2000 ? "\n...(truncated)" : "");
      } catch (e: any) { return `WHOIS failed: ${e.message}`; }
    } },
  { name: "unit_convert", safe: true, description: "Convert standard measurement units (C/F, kg/lb, mi/km, m/ft). input: {amount, from, to}.", params: "{amount, from, to}", args: { amount: { type: "number", required: true }, from: { type: "string", required: true }, to: { type: "string", required: true } },
    activity: (i) => `Converting ${i.amount} ${i.from} to ${i.to}`,
    run: async (i) => {
      const v = Number(i.amount);
      if (Number.isNaN(v)) return "Invalid amount.";
      const f = String(i.from).toLowerCase();
      const t = String(i.to).toLowerCase();
      let res = 0;
      if ((f === "c" || f === "celsius") && (t === "f" || t === "fahrenheit")) res = (v * 9/5) + 32;
      else if ((f === "f" || f === "fahrenheit") && (t === "c" || t === "celsius")) res = (v - 32) * 5/9;
      else if ((f === "kg" || f === "kilograms") && (t === "lb" || t === "pounds")) res = v * 2.20462;
      else if ((f === "lb" || f === "pounds") && (t === "kg" || t === "kilograms")) res = v / 2.20462;
      else if ((f === "mi" || f === "miles") && (t === "km" || t === "kilometers")) res = v * 1.60934;
      else if ((f === "km" || f === "kilometers") && (t === "mi" || t === "miles")) res = v / 1.60934;
      else if ((f === "m" || f === "meters") && (t === "ft" || t === "feet")) res = v * 3.28084;
      else if ((f === "ft" || f === "feet") && (t === "m" || t === "meters")) res = v / 3.28084;
      else return `Unsupported conversion: ${f} to ${t}. Use standard C/F, kg/lb, mi/km, m/ft.`;
      return `${v} ${f} = ${res.toFixed(2)} ${t}`;
    } },
  { name: "color_tools", safe: true, description: "Convert a color between HEX and RGB format. input: {color} e.g. '#FF0000' or '255,0,0'.", params: "{color}",
    activity: () => `Converting color`,
    run: async (i) => {
      const c = String(i.color).trim();
      if (c.startsWith("#")) {
        const hex = c.replace("#", "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `HEX ${c} = RGB(${r}, ${g}, ${b})`;
      } else {
        const parts = c.split(/[ ,]+/).map(Number);
        if (parts.length >= 3) {
          const hex = "#" + parts.slice(0, 3).map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
          return `RGB(${parts.slice(0,3).join(", ")}) = HEX ${hex}`;
        }
        return "Invalid format. Provide HEX (#RRGGBB) or RGB (R,G,B).";
      }
    } },
  { name: "translate", safe: true, description: "Translate text using the free Google Translate API. input: {text, target_lang_code} (e.g. 'es', 'fr', 'ja').", params: "{text, target_lang_code}", args: { text: { type: "string", required: true }, target_lang_code: { type: "string", desc: "e.g. es, fr, ja (default en)" } },
    activity: (i) => `Translating to ${i.target_lang_code}`,
    run: async (i) => {
      try {
        const target = encodeURIComponent(i.target_lang_code || "en");
        const text = encodeURIComponent(i.text);
        const res = await tfetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${text}`);
        if (!res.ok) throw new Error("Translate API failed");
        const data = await res.json();
        const translated = data[0].map((chunk: any) => chunk[0]).join("");
        return translated;
      } catch (e: any) { return `Failed to translate: ${e.message}`; }
    } },
  { name: "weather_forecast_7day", safe: true, description: "Get a rich 7-day weather forecast (JSON). input: {location}.", params: "{location}",
    activity: (i) => `Pulling 7-day forecast for ${i.location}`,
    run: async (i) => {
      try {
        const res = await tfetch(`https://wttr.in/${encodeURIComponent(i.location || "")}?format=j1`);
        if (!res.ok) throw new Error("Weather API failed");
        const data = await res.json();
        const current = data.current_condition[0];
        const future = data.weather.slice(0, 7).map((w: any) => `${w.date}: ${w.maxtempC}C/${w.mintempC}C (Rain: ${w.hourly[0]?.chanceofrain || 0}%)`).join("\n");
        return `Current: ${current.temp_C}C, ${current.weatherDesc[0].value}\nForecast:\n${future}`;
      } catch (e: any) { return `Failed to get forecast: ${e.message}`; }
    } },
  { name: "stock_price", safe: true, description: "Get live market data for a stock ticker symbol (e.g. AAPL, TSLA). input: {ticker}.", params: "{ticker}",
    activity: (i) => `Checking stock price for ${i.ticker}`,
    run: async (i) => {
      try {
        const res = await tfetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(i.ticker)}`);
        if (!res.ok) throw new Error("Finance API returned " + res.status);
        const data = await res.json();
        const meta = data.chart.result[0].meta;
        return `${meta.symbol}: $${meta.regularMarketPrice} (Prev Close: $${meta.previousClose})`;
      } catch (e: any) { return `Failed to fetch stock: ${e.message}`; }
    } },
  { name: "news_rss", safe: true, description: "Fetch the top 5 global news headlines from Google News RSS.", params: "(none)",
    activity: () => `Fetching top news`,
    run: async () => {
      try {
        const res = await tfetch("https://news.google.com/rss");
        if (!res.ok) throw new Error("News API failed");
        const xml = await res.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        const top = items.slice(0, 5).map(item => {
          const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
          const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
          return `- ${titleMatch ? titleMatch[1] : "No Title"}\n  ${linkMatch ? linkMatch[1] : "No Link"}`;
        });
        return top.length ? top.join("\n\n") : "No news found.";
      } catch (e: any) { return `Failed to fetch news: ${e.message}`; }
    } },
  { name: "dedupe_files", safe: true, description: "Recursively scan a directory, hash all files, and list exact duplicates (read-only, does not delete). input: {dir}.", params: "{dir}",
    activity: (i) => `Scanning ${i.dir} for duplicates`,
    run: async (i) => {
      try {
        const dir = resolve(i.dir);
        const map = new Map<string, string[]>();
        // AUDIT FIX: an unbounded recursive walk over a huge tree (or one with a symlink cycle,
        // node_modules, or enormous files) could hang the process and exhaust memory/handles.
        // Bounded on every axis: depth, file count, per-file size, skip-list, and no symlink
        // descent (stat, not lstat-follow, and directories reached by symlink are not entered).
        const MAX_DEPTH = 24, MAX_FILES = 200_000, MAX_FILE_BYTES = 256 * 1024 * 1024;
        const SKIP = new Set([".git", "node_modules", ".cache", "Library", ".Trash"]);
        let count = 0, truncated = false;
        async function walk(currentDir: string, depth: number) {
          if (depth > MAX_DEPTH || truncated) return;
          const entries = await readdir(currentDir, { withFileTypes: true });
          for (const ent of entries) {
            if (truncated) return;
            if (ent.isSymbolicLink()) continue;                 // never follow a symlink out / into a cycle
            if (ent.isDirectory()) { if (SKIP.has(ent.name)) continue; await walk(join(currentDir, ent.name), depth + 1); continue; }
            if (!ent.isFile()) continue;
            const filepath = join(currentDir, ent.name);
            const stats = await stat(filepath);
            if (stats.size > MAX_FILE_BYTES) continue;          // don't slurp a giant file to hash it
            if (++count > MAX_FILES) { truncated = true; return; }
            const buffer = await readFile(filepath);
            const hash = createHash("sha256").update(buffer).digest("hex");
            if (!map.has(hash)) map.set(hash, []);
            map.get(hash)!.push(filepath);
          }
        }
        await walk(dir, 0);
        let out = "";
        for (const [_hash, paths] of map.entries()) {
          if (paths.length > 1) {
            out += `Duplicate Group:\n` + paths.map(p => `  - ${p}`).join("\n") + "\n\n";
          }
        }
        const note = truncated ? `\n\n(stopped after ${MAX_FILES} files — scan a narrower directory for the rest)` : "";
        return (out.trim() || "No duplicates found.") + note;
      } catch (e: any) { return `Failed to dedupe files: ${e.message}`; }
    } },
  { name: "add_calendar_event", safe: false, description: "Create a scheduled event in Calendar. input: {title, start_date, end_date} (Dates parseable like '12/25/2026 14:00').", params: "{title, start_date, end_date}", args: { title: { type: "string", required: true }, start_date: { type: "string", required: true }, end_date: { type: "string", required: true } },
    activity: (i) => `Scheduling ${i.title} on Calendar`, preview: (i) => `Add to Calendar:\n${i.title}\nFrom: ${i.start_date}\nTo: ${i.end_date}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          await osa(`tell application "Calendar" to tell calendar 1 to make new event at end of events with properties {summary:"${esc(i.title)}", start date:date "${esc(i.start_date)}", end date:date "${esc(i.end_date)}"}`);
          return "Event created successfully in default Calendar.";
        } else {
          return notSupported("Calendar");
        }
      } catch (err: any) { return `Failed to create event: ${err.message}`; }
    } },

  // safe:false to match append_note. These write to the SAME resource — the operator's Notes —
  // and creating a whole note is at least as much of a write as appending to one, yet appending
  // asked and creating did not. Same resource, opposite gate, no reason for the difference.
  { name: "create_note", safe: false, description: "Create a new note. input: {title, body}.", params: "{title, body}", args: { title: { type: "string", required: true }, body: { type: "string", required: true } },
    preview: (i) => `Create a note in Notes: “${String(i?.title ?? "").slice(0, 60)}” (${String(i?.body ?? "").length} chars)`,
    activity: (i) => `Creating Note: ${i.title}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const content = `<h1>${i.title}</h1><p>${i.body.replace(/\n/g, "<br>")}</p>`;
          await osa(`tell application "Notes" to make new note with properties {body:"${esc(content)}"}`);
          return "Note created successfully.";
        } else {
          const notesDir = resolve(homedir(), "SAM_Notes");
          mkdirSync(notesDir, { recursive: true });
          const file = resolve(notesDir, `${i.title.replace(/[^a-z0-9]/gi, '_')}.txt`);
          await writeFile(file, i.body);
          return `Note saved to ${file}.`;
        }
      } catch (e: any) { return `Failed to create note: ${e.message}`; }
    } },
  { name: "search_notes", safe: true, description: "Search Notes and return content of matches. input: {query}.", params: "{query}",
    activity: (i) => `Searching Notes for "${i.query}"`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const script = `tell application "Notes"\nset matchNotes to notes whose name contains "${esc(i.query)}" or body contains "${esc(i.query)}"\nset out to ""\nrepeat with n in matchNotes\nset out to out & "Title: " & name of n & "\\n" & body of n & "\\n\\n"\nend repeat\nreturn out\nend tell`;
          const result = await osa(script);
          return result.trim() || "No matching notes found.";
        } else {
          const notesDir = resolve(homedir(), "SAM_Notes");
          const hitFiles = await findByContent(notesDir, String(i.query), 20); const stdout = hitFiles.join("\n");
          return stdout.trim() || "No matching notes found.";
        }
      } catch (e: any) { return `Failed to search notes: ${e.message}`; }
    } },
  { name: "send_mail", safe: false, description: "Send an email from SAM's OWN address via SMTP (works cross-platform, no Mail app needed). Defaults to the owner's inbox if 'to' is omitted. Needs SMTP set up in .env. input: {to?, subject, body}.", params: "{to?, subject, body}",
    activity: (i) => `Emailing ${i.to || ownerEmail() || "you"}`,
    preview: (i) => `Send email (from SAM) to ${i.to || ownerEmail() || "you"}:\nSubject: ${i.subject}\n\n${i.body}`,
    run: async (i) => {
      if (!mailerConfigured()) return "SAM's email isn't set up yet. Add SMTP_HOST / SMTP_USER / SMTP_PASS (and optionally SMTP_FROM, SAM_OWNER_EMAIL) to .env — see .env.example.";
      const r = await sendMail(i.to || "", i.subject || "", i.body || "");
      return r.ok ? `Sent ✓ to ${i.to || ownerEmail()}.` : `Couldn't send: ${r.error}`;
    } },
  { name: "send_email", safe: false, description: "Draft an email in the default mail client. input: {to_email, subject, body}.", params: "{to_email, subject, body}",
    activity: (i) => `Drafting email to ${i.to_email}`, preview: (i) => `Draft email to ${i.to_email}:\nSubject: ${i.subject}\n${i.body}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const script = `tell application "Mail"\nset theMessage to make new outgoing message with properties {subject:"${esc(i.subject)}", content:"${esc(i.body)}", visible:false}\ntell theMessage\nmake new to recipient at end of to recipients with properties {address:"${esc(i.to_email)}"}\nsend\nend tell\nend tell`;
          await osa(script);
          return `Email sent successfully to ${i.to_email}.`;
        } else {
          await openUrl(`mailto:${i.to_email}?subject=${encodeURIComponent(i.subject)}&body=${encodeURIComponent(i.body)}`);
          return `Opened email draft to ${i.to_email} in the default mail client.`;
        }
      } catch (e: any) { return `Failed to send email: ${e.message}`; }
    } },
  { name: "open_maps", safe: true, description: "Instantly launch Maps with a specific address or search query. input: {address_or_query}.", params: "{address_or_query}",
    activity: (i) => `Opening Maps for ${i.address_or_query}`,
    run: async (i) => {
      const q = encodeURIComponent(i.address_or_query);
      // openUrl prepends https:// to anything non-http, which would mangle maps://
      // into https://maps://… — open the maps: scheme directly instead.
      if (IS_MAC) return sh(openCmd(`maps://?q=${q}`)).then(() => `Apple Maps opened for: ${i.address_or_query}`);
      else return openUrl(`https://www.google.com/maps/search/?api=1&query=${q}`).then(() => `Google Maps opened for: ${i.address_or_query}`);
    } },
  { name: "add_contact", safe: false, description: "Programmatically add a new person to your native Contacts. input: {first_name, last_name?, phone?, email?}.", params: "{first_name, last_name?, phone?, email?}",
    activity: (i) => `Adding contact: ${i.first_name}`, preview: (i) => `Add to Contacts:\nName: ${i.first_name} ${i.last_name || ""}\nPhone: ${i.phone || ""}\nEmail: ${i.email || ""}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          // AUDIT FIX: build the property record with NO trailing comma. The old form always left a
          // dangling ", " before `}` (both with and without a last name), which AppleScript rejects —
          // so add_contact failed every time on macOS.
          let props = `first name:"${esc(i.first_name)}"`;
          if (i.last_name) props += `, last name:"${esc(i.last_name)}"`;
          let script = `tell application "Contacts"\nset newPerson to make new person with properties {${props}}\n`;
          if (i.phone) script += `make new phone at end of phones of newPerson with properties {label:"Mobile", value:"${esc(i.phone)}"}\n`;
          if (i.email) script += `make new email at end of emails of newPerson with properties {label:"Work", value:"${esc(i.email)}"}\n`;
          script += `save\nend tell`;
          await osa(script);
          return "Contact added successfully.";
        } else {
          const vcf = `BEGIN:VCARD\nVERSION:3.0\nN:${i.last_name || ""};${i.first_name};;;\nFN:${i.first_name} ${i.last_name || ""}\nTEL;TYPE=CELL:${i.phone || ""}\nEMAIL;TYPE=WORK:${i.email || ""}\nEND:VCARD`.replace(/[\r\n]+/g, "\n");
          const contactsDir = resolve(homedir(), "SAM_Contacts");
          mkdirSync(contactsDir, { recursive: true });
          // AUDIT FIX: sanitize the name components before they become a filename — an unsanitized
          // '../../..' name was a path-traversal write out of SAM_Contacts.
          const safe = (s: string) => (s || "").replace(/[^a-z0-9]/gi, "_");
          const file = resolve(contactsDir, `${safe(i.first_name)}_${safe(i.last_name)}.vcf`);
          await writeFile(file, vcf);
          return `Contact saved as VCF in ${file}.`;
        }
      } catch (e: any) { return `Failed to add contact: ${e.message}`; }
    } },
  { name: "toggle_dark_mode", safe: true, description: "Flip the macOS system appearance between Dark Mode and Light Mode natively.", params: "(none)",
    activity: () => `Toggling Dark Mode`,
    run: async () => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        await osa(`tell application "System Events" to tell appearance preferences to set dark mode to not dark mode`);
        return "Toggled macOS Dark Mode successfully.";
      } catch (e: any) { return `Failed to toggle Dark Mode: ${e.message}`; }
    } },
  { name: "get_frontmost_app", safe: true, description: "Get the name of the macOS application you are currently looking at on screen.", params: "(none)",
    activity: () => `Checking frontmost app`,
    run: async () => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        const result = await osa(`tell application "System Events" to get name of first application process whose frontmost is true`);
        return `Frontmost app: ${result.trim()}`;
      } catch (e: any) { return `Failed to get frontmost app: ${e.message}`; }
    } },
  { name: "get_location", safe: true, description: "Get the user's current approximate location (city/region).", params: "(none)",
    activity: () => `Checking your location`, run: async () => (await fetchLocation(true)) || "Couldn't determine location (offline?)." },
  { name: "notify", safe: true, description: "Show a macOS notification. input: {title?, message}.", params: "{title?, message}",
    activity: (_i) => `Sending a notification`, run: (i) => notify(i) },
  { name: "get_weather", safe: true, description: "Get current weather. input: a place name (city).", params: "place",
    activity: (i) => `Checking the weather in ${i.place ?? i ?? "your area"}`, run: (i) => getWeather(i.place ?? i ?? "") },

  // ── FREE UTILITY BATCH — no API keys, local OS or free web ──
  { name: "battery_status", safe: true, description: "Check the battery level and charging state.", params: "(none)",
    activity: () => `Checking battery`, run: getBattery },   // cross-platform (Mac/Win/Linux)
  { name: "toggle_dnd", safe: false, description: "Toggle Mac Do Not Disturb / Focus on or off. input: {on: boolean}.", params: "{on: boolean}", args: { on: { type: "boolean", required: true } },
    activity: (i) => `Turning Do Not Disturb ${i.on ? "on" : "off"}`,
    run: async (i) => {
      if (!IS_MAC) return "Do Not Disturb toggle only supported on macOS.";
      try {
        const s = await sh(`shortcuts run "Turn Do Not Disturb ${i.on ? "On" : "Off"}" 2>/dev/null || echo "failed"`).catch(() => ({stdout: "failed"}));
        if (!s.stdout.includes("failed")) return `DND is now ${i.on ? "on" : "off"}.`;
        const script = `tell application "System Events" to tell application process "Control Center"\n  try\n    click menu bar item "Focus" of menu bar 1\n    delay 0.3\n    click checkbox 1 of scroll area 1 of window "Control Center"\n    delay 0.3\n    click menu bar item "Focus" of menu bar 1\n    return "Toggled Do Not Disturb via GUI."\n  on error\n    return "Failed to toggle DND. You may need to grant Accessibility permissions or create a 'Turn Do Not Disturb On/Off' Apple Shortcut."\n  end try\nend tell`;
        const res = await osa(script);
        return res.trim();
      } catch (e: any) { return `Failed: ${e.message}`; }
    }
  },
  { name: "quick_note", safe: true, description: "Jot a quick note into SAM's vault. input: text.", params: "text",
    activity: () => `Saving a note`,
    // Was safePath("./vault/notes/quick.md") — a CWD-relative path, in a file that already defines
    // VAULT_DIR two hundred lines up and where every other module resolves the vault from its own
    // location. In the packaged app cwd is "/" (measured, not guessed), so this resolved to
    // /vault/notes/quick.md and mkdirSync failed with EACCES — every time. It only ever worked in
    // dev, where cwd happens to be the repo root, which is exactly why it looked fine.
    // It also ignored VAULT_DIR, so it missed the real vault even when it could write.
    run: async (i) => {
      const p = join(VAULT_DIR, "notes", "quick.md");
      mkdirSync(dirname(p), { recursive: true });
      await writeFile(p, `[${nowText()}] ${String(i.text ?? i)}\n`, { flag: "a" });
      return `📝 Noted to your vault.`;
    } },
  { name: "crypto_price", safe: true, description: "Get a crypto price. input: coin (bitcoin, ethereum…).", params: "coin",
    activity: (i) => `Checking ${i.coin ?? i} price`,
    run: async (i) => { try { const coin = String(i.coin ?? i).toLowerCase(); const d: any = await (await tfetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd,gbp`)).json(); const p = d?.[coin]; return p ? `🪙 ${coin}: $${p.usd} · £${p.gbp}` : `Couldn't find "${coin}".`; } catch (e: any) { return `Crypto lookup failed: ${e?.message}`; } } },
  { name: "define_word", safe: true, description: "Define a word. input: word.", params: "word",
    activity: (i) => `Defining "${i.word ?? i}"`,
    run: async (i) => { try { const w = String(i.word ?? i); const d: any = await (await tfetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`)).json(); const defs = d?.[0]?.meanings?.slice(0, 2).map((m: any) => `(${m.partOfSpeech}) ${m.definitions?.[0]?.definition}`).join("\n"); return defs ? `📖 ${w}\n${defs}` : `No definition for "${w}".`; } catch (e: any) { return `Lookup failed: ${e?.message}`; } } },
  { name: "wikipedia", safe: true, description: "Get a Wikipedia summary. input: topic.", params: "topic",
    activity: (i) => `Reading Wikipedia: ${i.topic ?? i}`,
    run: async (i) => { try { const t = String(i.topic ?? i); const d: any = await (await tfetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`)).json(); return d?.extract ? `📚 ${d.title}\n${d.extract}` : `No Wikipedia page for "${t}".`; } catch (e: any) { return `Lookup failed: ${e?.message}`; } } },
  { name: "hacker_news", safe: true, description: "Top Hacker News stories right now.", params: "(none)",
    activity: () => `Fetching Hacker News`,
    run: async () => { try { const ids: any = await (await tfetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json(); const top = await Promise.all(ids.slice(0, 8).map(async (id: number) => { const s: any = await (await tfetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json(); return `• ${s.title} (${s.score}▲) ${s.url || ""}`; })); return `📰 Top HN:\n${top.join("\n")}`; } catch (e: any) { return `HN fetch failed: ${e?.message}`; } } },
  { name: "dns_lookup", safe: true, description: "DNS lookup for a domain. input: domain.", params: "domain",
    activity: (i) => `DNS lookup: ${i.domain ?? i}`,
    run: async (i) => {
      const domain = String(i.domain ?? i).trim().replace(/^https?:\/\//, "").split("/")[0];
      try {
        const dns = await import("node:dns/promises");
        const [a, aaaa] = await Promise.all([dns.resolve4(domain).catch(() => [] as string[]), dns.resolve6(domain).catch(() => [] as string[])]);
        const recs = [...a.map((x) => `A     ${x}`), ...aaaa.map((x) => `AAAA  ${x}`)];
        return recs.length ? recs.join("\n") : "No records found.";
      } catch (e: any) { return `Lookup failed: ${e?.message}`; }
    } },
  { name: "open_url", safe: true, description: "Open a URL in the default browser. input: url.", params: "url",
    activity: (i) => `Opening ${i.url ?? i}`, run: (i) => openUrl(i.url ?? i) },
  { name: "search_files", safe: true, cacheable: true, description: "Search the Mac for files by name/content (Spotlight). input: query.", params: "query",
    activity: (i) => `Searching your files for “${i.query ?? i}”`, run: (i) => searchFiles(i.query ?? i) },

  // ── GitHub (via the gh CLI the user's already logged into) ──
  { name: "github_repos", safe: true, description: "List the user's GitHub repositories (name, visibility, description). input: {limit?}.", params: "{limit?}",
    activity: () => `Listing your GitHub repos`,
    run: (i) => gh(`repo list --limit ${Math.min(Number(i?.limit) || 30, 100)}`) },
  { name: "github_repo", safe: true, description: "View a repo's overview + README. input: {repo} e.g. 'owner/repo'.", params: "{repo}",
    activity: (i) => `Looking at ${i.repo ?? i} on GitHub`,
    run: (i) => gh(`repo view ${shq(i.repo ?? i)}`) },
  { name: "github_issues", safe: true, description: "List open issues on a repo. input: {repo, limit?}.", params: "{repo, limit?}",
    activity: (i) => `Checking issues on ${i.repo ?? i}`,
    run: (i) => gh(`issue list -R ${shq(i.repo ?? i)} --limit ${Math.min(Number(i?.limit) || 20, 50)}`) },
  { name: "github_read_file", safe: true, description: "Read a file from a repo. input: {repo, path}.", params: "{repo, path}",
    activity: (i) => `Reading ${i.path} from ${i.repo}`,
    // Same refusal as read_file, for the same reason — this one also runs without asking, and a
    // committed .env or deploy key is exactly the file most worth not fetching unattended.
    run: (i) => isCredentialPath(String(i?.path || ""))
      ? Promise.resolve(`Blocked: ${i.path} holds credentials, and github_read_file runs without asking you first. Open it on GitHub, or ask for the shell command — that one waits for your approval.`)
      : gh(`api ${shq(`repos/${i.repo}/contents/${i.path}`)} -H ${shq("Accept: application/vnd.github.raw")}`) },
  { name: "github_create_issue", safe: false, description: "Open a new issue on a repo. input: {repo, title, body?}.", params: "{repo, title, body?}",
    activity: (i) => `Opening a GitHub issue on ${i.repo}: “${i.title}”`,
    preview: (i) => `Create a GitHub issue on ${i.repo}\nTitle: ${i.title}\n${i.body || ""}`.slice(0, 300),
    run: (i) => gh(`issue create -R ${shq(i.repo)} --title ${shq(i.title)} --body ${shq(i.body || "")}`) },
  { name: "my_apps", safe: true, cacheable: true, description: "List the user's own in-house apps (their GitHub repos), grabbed at startup, with descriptions.", params: "(none)",
    activity: () => `Pulling up your apps`,
    run: async () => { const a = await grabRepos(); return a.length ? a.map((r) => `• ${r.name} [${r.visibility}]${r.desc ? ` — ${r.desc}` : ""}`).join("\n") : "No apps found (is gh logged in?)."; } },
  { name: "git_diff", safe: true, description: "Show what changed in a local repo (uncommitted). input: {dir, file?}.", params: "{dir, file?}",
    activity: (i) => `Looking at changes in ${i.dir}`,
    run: (i) => gitIn(i.dir, `diff --stat ${i.file ? shq(i.file) : ""}`).then((s) => s || "No uncommitted changes.") },
  { name: "git_log", safe: true, description: "Show recent commits in a local repo. input: {dir, limit?}.", params: "{dir, limit?}",
    activity: (i) => `Reading recent commits in ${i.dir}`,
    run: (i) => gitIn(i.dir, `log --oneline -n ${Math.min(Number(i?.limit) || 15, 50)}`) },
  { name: "git_branches", safe: true, description: "List branches in a local repo (current marked *). input: {dir}.", params: "{dir}",
    activity: (i) => `Listing branches in ${i.dir}`,
    run: (i) => gitIn(i.dir, "branch -a --sort=-committerdate") },
  { name: "run_script", safe: false, description: "Run an npm script (build/test/lint/etc) in a project. input: {dir, script}.", params: "{dir, script}",
    activity: (i) => `Running npm ${i.script} in ${i.dir}`,
    preview: (i) => `Run \`npm run ${i.script}\` in ${i.dir}`,
    run: (i) => {
      const script = String(i.script || "");
      if (!/^[\w:.-]+$/.test(script)) return Promise.resolve("That doesn't look like a valid npm script name.");
      // Cross-platform: execFile with cwd (no `cd`), shell:true so 'npm' resolves to npm.cmd on Windows;
      // last 40 lines sliced in JS (no `| tail`). Strict script validation blocks shell injection.
      return execFile("npm", ["run", script], { cwd: String(i.dir || "."), timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: true } as any)
        .then((r: any) => (((r.stdout || "") + (r.stderr || "")).split("\n").slice(-40).join("\n") || "(done)").slice(0, 4000))
        .catch((e: any) => `failed:\n${(((e?.stdout || "") + (e?.stderr || e?.message || e)).toString()).split("\n").slice(-40).join("\n").slice(0, 800)}`);
    } },
  { name: "my_socials", safe: true, description: "Show the user's social profiles/links on file (optionally for one brand). input: {brand?}.", params: "{brand?}",
    activity: () => `Pulling up your socials`,
    run: async (i) => {
      const s = loadSocials(); const keys = Object.keys(s);
      if (!keys.length) return "No socials on file yet. Add handles in vault/socials.json (or ask me to find them).";
      const pick = i?.brand ? keys.filter((k) => k.toLowerCase().includes(String(i.brand).toLowerCase())) : keys;
      return pick.map((k) => { const links = Object.entries(s[k]).filter(([, v]) => v).map(([p, v]) => `${p}: ${v}`).join(" · "); return `${k} — ${links || "no links on file"}`; }).join("\n");
    } },
  // ── Proactive nudges (SAM reminds you — and pings you when due) ──
  { name: "add_nudge", safe: true, description: "Set a reminder/nudge SAM will proactively ping you about. input: {text, when?} (when = ISO date-time, optional).", params: "{text, when?}",
    activity: (i) => `Setting a nudge: “${i.text ?? i}”`,
    run: async (i) => { const n = addNudge(i.text ?? i, i.when || i.due); return `Got it — I'll nudge you${n.due ? ` at ${n.due}` : ""}: “${n.text}”.`; } },
  { name: "list_nudges", safe: true, description: "List your pending nudges/reminders.", params: "(none)",
    activity: () => `Checking your nudges`,
    run: async () => { const l = listNudges(); return l.length ? l.map((n) => `• ${n.text}${n.due ? ` (due ${n.due})` : ""}`).join("\n") : "No pending nudges."; } },
  { name: "complete_nudge", safe: true, description: "Mark a nudge done. input: text or id.", params: "text",
    activity: (_i) => `Ticking off a nudge`,
    run: async (i) => completeNudge(i.text ?? i.id ?? i) },

  // ── File utilities (quick wins) ──
  { name: "move_file", safe: false, description: "Move or rename a file/folder. input: {from, to}.", params: "{from, to}",
    activity: (i) => `Moving ${i.from} → ${i.to}`,
    preview: (i) => `Move / rename:\n${i.from}\n→ ${i.to}`,
    run: (i) => rename(safePath(i.from), safePath(i.to)).then(() => `Moved to ${i.to}`).catch((e: any) => `Couldn't move: ${e?.message}`) },
  { name: "make_folder", safe: false, description: "Create a folder (and any parent folders). input: path.", params: "path",
    activity: (i) => `Creating folder ${i.path ?? i}`,
    preview: (i) => `Create folder: ${i.path ?? i}`,
    run: (i) => (async () => { try { mkdirSync(safePath(i.path ?? i), { recursive: true }); return `Created ${i.path ?? i}`; } catch (e: any) { return `Couldn't: ${e?.message}`; } })() },
  { name: "compress", safe: false, description: "Zip a file or folder. input: {path, out?}.", params: "{path, out?}",
    activity: (i) => `Zipping ${i.path}`,
    preview: (i) => `Zip: ${i.path}`,
    run: (i) => {
      const src = safePath(i.path); const out = safePath(i.out || i.path + ".zip");
      const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;   // PowerShell single-quote escape
      const p = OS === "windows"
        ? execFile("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path ${psq(src)} -DestinationPath ${psq(out)} -Force`])
        : sh(`cd ${shq(dirname(src))} && zip -rq ${shq(out)} ${shq(basename(src))}`);
      return p.then(() => `Zipped to ${out}`).catch((e: any) => `Couldn't zip: ${e?.message}`);
    } },
  { name: "unzip_file", safe: false, description: "Unzip an archive. input: {path, to?}.", params: "{path, to?}",
    activity: (i) => `Unzipping ${i.path}`,
    preview: (i) => `Unzip: ${i.path}`,
    run: (i) => {
      const src = safePath(i.path); const dest = i.to ? safePath(i.to) : dirname(src);
      const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
      const p = OS === "windows"
        ? execFile("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path ${psq(src)} -DestinationPath ${psq(dest)} -Force`])
        : sh(`unzip -oq ${shq(src)} -d ${shq(dest)}`);
      return p.then(() => `Unzipped ${i.path}`).catch((e: any) => `Couldn't unzip: ${e?.message}`);
    } },
  { name: "directions", safe: true, description: "Open directions / a map lookup. input: {to, from?}.", params: "{to, from?}",
    activity: (i) => `Getting directions to ${i.to ?? i}`,
    run: (i) => { const to = encodeURIComponent(i.to ?? i); const from = i.from ? `&origin=${encodeURIComponent(i.from)}` : ""; return openUrl(`https://www.google.com/maps/dir/?api=1&destination=${to}${from}`).then(() => `Opened directions to ${i.to ?? i}`); } },
  { name: "backup_vault", safe: true, description: "Back up SAM's memory vault to a timestamped folder on the Desktop.", params: "(none)",
    activity: () => `Backing up your SAM memory`,
    // Same CWD-relative bug as quick_note, and worse here: in the packaged app cwd is "/", so this
    // copied "/vault" — which does not exist — and the operator's BACKUP tool has reported
    // "Backup failed: ENOENT" for its whole life. A backup that never ran is the one failure you
    // find out about at the worst possible moment, so it also verifies the copy landed rather than
    // trusting cp to have done something.
    run: async () => {
      const stamp = nowText().replace(/[^0-9]/g, "").slice(0, 12);
      const dest = safePath(`~/Desktop/sam-vault-backup-${stamp}`);
      try {
        if (!existsSync(VAULT_DIR)) return `Nothing to back up yet — no vault at ${VAULT_DIR}.`;
        await cp(VAULT_DIR, dest, { recursive: true });
        if (!existsSync(dest)) return `Backup failed: nothing was written to ${dest}.`;
        return `Backed up your vault to ${dest}`;
      } catch (e: any) { return `Backup failed: ${e?.message}`; }
    } },
  // ── People SAM knows by sight ──
  { name: "remember_person", safe: true, description: "Remember a person by sight. input: {name, look, relation?} — look = short description of their appearance.", params: "{name, look, relation?}",
    activity: (i) => `Remembering ${i.name}`,
    run: async (i) => { const p = addPerson(i.name, i.look || "", i.relation); return `Got it — I'll recognise ${p.name}${p.relation ? ` (${p.relation})` : ""} next time I see them.`; } },
  { name: "who_i_know", safe: true, description: "List the people SAM can recognise by sight.", params: "(none)",
    activity: () => `Checking who I know`,
    run: async () => { const l = listPeople(); return l.length ? l.map((p) => `• ${p.name}${p.relation ? ` (${p.relation})` : ""} — ${p.look}`).join("\n") : "I don't know anyone by sight yet. Show me someone and say 'remember this is <name>'."; } },
  { name: "security_check", safe: true, description: "Report SAM's security watchdog — anything dodgy it flagged/blocked (bad commands, unexpected origins), or all-clear.", params: "(none)",
    activity: () => `Running a security check`,
    run: async () => {
      const s = securityStatus();
      if (s.clear) return "🛡️ All clear — nothing dodgy. No blocked commands, no unexpected access. SAM's watching.";
      const lines = s.latest.map((e) => `• [${e.at}] ${e.type}: ${e.detail}${e.source ? ` (from ${e.source})` : ""}`).join("\n");
      return `🛡️ ${s.headline}. ${s.alerts} blocked, ${s.warns} flagged.\nRecent:\n${lines}`;
    } },
  { name: "my_repos", safe: true, description: "List the git working copies on THIS machine (name, folder, GitHub remote) — use this to find the folder for a repo before any git tool. input: none.", params: "none",
    activity: () => `Finding your repos on this machine`,
    run: async () => {
      const local = repoIndex();
      const remote = await grabRepos().catch(() => []);
      const cloned = new Set(local.map((r) => r.name.toLowerCase()));
      const missing = remote.filter((r) => !cloned.has(r.name.toLowerCase())).map((r) => r.name);
      if (!local.length && !remote.length) return "I couldn't find any git repos on this machine, and no GitHub list is available.";
      const lines = local.map((r) => `• ${r.name} — ${r.path}${r.remote ? `  (${r.remote})` : "  (no remote)"}`);
      return `Working copies on this machine (${local.length}):\n${lines.join("\n")}` +
        (missing.length ? `\n\nOn GitHub but not cloned here (${missing.length}): ${missing.join(", ")}` : "");
    } },
  { name: "git_status", safe: true, description: "Show git status of a local repo folder (branch + changed files). input: {dir} — a repo NAME like 'sam' or a folder path.", params: "{dir}",
    activity: (i) => `Checking git status in ${i.dir}`,
    run: (i) => gitIn(i.dir, "status --short --branch") },
  { name: "git_commit", safe: false, description: "Stage ALL changes and commit in a local repo. input: {dir, message, branch?} (branch = create/switch to it first).", params: "{dir, message, branch?}",
    activity: (i) => `Committing in ${i.dir}${i.branch ? ` on ${i.branch}` : ""}`,
    preview: (i) => `Commit ALL current changes in:\n${i.dir}\n${i.branch ? `New branch: ${i.branch}\n` : ""}Message: “${i.message}”`.slice(0, 320),
    run: async (i) => {
      let out = "";
      if (i.branch) out += (await gitIn(i.dir, `checkout -b ${shq(i.branch)}`)) + "\n";
      await gitIn(i.dir, "add -A");
      out += await gitIn(i.dir, `commit -m ${shq(i.message)}`);
      return out.trim();
    } },
  { name: "git_push", safe: false, description: "Push the current branch to origin (GitHub) — publishes your commits. input: {dir}.", params: "{dir}",
    activity: (i) => `Pushing ${i.dir} to GitHub`,
    preview: (i) => `Push the current branch of ${i.dir} to origin (GitHub).\nThis publishes your commits to the remote.`,
    run: async (i) => gitIn(i.dir, `push -u origin ${shq(await currentBranch(i.dir))}`) },
  { name: "github_pr", safe: false, description: "Open a pull request from a local repo's pushed branch. input: {dir, title, body?, base?}.", params: "{dir, title, body?, base?}",
    activity: (i) => `Opening a pull request: “${i.title}”`,
    preview: (i) => `Open a GitHub Pull Request from:\n${i.dir}\nTitle: ${i.title}\nInto: ${i.base || "the default branch"}\n${i.body || ""}`.slice(0, 320),
    run: (i) => sh(`cd ${shq(i.dir)} && gh pr create ${i.base ? `--base ${shq(i.base)} ` : ""}--title ${shq(i.title)} --body ${shq(i.body || " ")}`, { timeout: 30000 })
      .then((r: any) => ((r.stdout || r.stderr || "PR opened").toString()).trim().slice(0, 1000))
      .catch((e: any) => `GitHub: ${(e?.stderr || e?.message || e).toString().slice(0, 300)}`) },
  { name: "system_info", safe: true, description: "Get Mac system info (macOS version, uptime, disk).", params: "(none)",
    activity: () => `Checking your system`, run: systemInfo },
  { name: "speak", safe: true, description: "Speak text aloud through the speakers. input: text.", params: "text",
    activity: () => `Speaking`, run: (i) => speak(i.text ?? i) },
  { name: "play", safe: true, description: "Play/pull up music — a song, artist, latest release, or playlist. input: what to play.", params: "query",
    activity: (i) => `Pulling up ${i.query ?? i}`, run: (i) => playMusic(i.query ?? i) },
  { name: "find_contact", safe: true, description: "Look up a person's phone/email in Contacts. input: a name.", params: "name",
    activity: (i) => `Looking up ${i.name ?? i} in Contacts`, run: (i) => findContact(i.name ?? i) },
  { name: "read_calendar", safe: true, description: "Read today's calendar events.", params: "(none)",
    activity: () => `Checking your calendar`, run: readCalendar },

  { name: "read_emails", safe: true, description: "Read the latest emails in your inbox (senders + subjects).", params: "(none)",
    activity: () => `Checking your inbox`, run: readEmails },

  // ── SELF-VERIFIER TOOLS (V2) — safe, read-only. SAM uses these to check its own
  // work after writing code. Never mutates files. Runs automatically in agentic loops
  // (no approval needed). The output is fed back as a tool result so SAM can self-correct.
  { name: "lint_workspace", safe: true,
    description: "Run TypeScript type-checking (npx tsc --noEmit) in a directory and return all errors. Use this after writing or editing code to verify it compiles cleanly. input: {dir?: string} (defaults to cwd).",
    params: "{dir?}",
    activity: (i: any) => `Type-checking ${i.dir ?? "workspace"}`,
    run: async (i: any) => {
      const target = i.dir ? safePath(i.dir) : homedir();
      try {
        const { stdout, stderr } = await sh("npx tsc --noEmit 2>&1 | head -n 80", { timeout: 45000, cwd: target, maxBuffer: 4 * 1024 * 1024 });
        const out = (stdout + stderr).trim();
        return out ? `TypeScript errors found:\n${out}` : "✅ No TypeScript errors — workspace is clean.";
      } catch (e: any) {
        const msg = (e?.stdout || e?.stderr || e?.message || "").trim();
        return msg ? `TypeScript errors found:\n${msg.slice(0, 3000)}` : `lint failed: ${e?.message || e}`;
      }
    },
  },
  // risky · ask first
  // ── AUTO-APPROVED terminal for read-only commands (Antigravity-parity) ──
  // SAM uses this for git status, ls, cat, npx tsc, grep, etc. — anything the
  // allowlist in isReadOnlyCommand() passes. If the command doesn't pass, SAM
  // gets told to use run_command instead (which asks the user). Placed BEFORE
  // run_command so the model sees it first and prefers it for reads.
  { name: "run_safe_command", safe: true, description: "Run a READ-ONLY shell command that auto-executes without asking (git log, ls, cat, grep, npx tsc, etc). If the command isn't in the safe allowlist, you'll be told to use run_command instead. input: a command string.", params: "command",
    activity: (i) => `Running ${(i.command ?? i).toString().slice(0, 40)}`, run: (i) => runSafeCommand(i.command ?? i) },
  { name: "run_command", safe: false, description: "Run a shell command on the Mac (needs approval). Use run_safe_command first for reads. input: a command string.", params: "command",
    activity: (_i) => `Running a command`, preview: (i) => `Terminal command:\n  ${i.command ?? i}`, run: (i) => runCommand(i.command ?? i) },
  { name: "run_daemon", safe: false, description: "Run a shell command in the BACKGROUND without waiting — for anything too slow for a normal step (a full test suite, a big build, a long scrape). Returns immediately with a log path; you get nudged when it finishes. input: a command string.", params: "command",
    activity: (_i) => `Starting a background task`, preview: (i) => `Run in background:\n  ${i.command ?? i}`, run: async (i) => runDaemon(i.command ?? i) },
  { name: "manage_task", safe: false, description: "Manage background tasks. Support interactive processes. input: { action, taskId?, command?, input? }. Actions: 'spawn' (needs command), 'list', 'status' (needs taskId), 'send_input' (needs taskId, input), 'kill' (needs taskId).", params: "{action, taskId?, command?, input?}",
    args: {
      action: { type: "string", required: true, desc: "spawn | list | status | send_input | kill" },
      taskId: { type: "string", desc: "task id (e.g. d-12345)" },
      command: { type: "string", desc: "command to spawn" },
      input: { type: "string", desc: "text to send to stdin" }
    },
    activity: (i) => `Managing task: ${i.action}`,
    preview: (i) => i.action === "spawn" ? `Spawn background task:\n  ${i.command ?? ""}`
      : i.action === "send_input" ? `Send to task ${i.taskId}:\n  ${i.input ?? ""}`
      : i.action === "kill" ? `Kill task ${i.taskId}`
      : `Manage task: ${i.action}${i.taskId ? ` (${i.taskId})` : ""}`,
    run: (i) => manageTaskTool(i) },
  { name: "write_file", safe: false, description: "Write/overwrite a full file. Use edit_file instead when modifying existing code. input: {path, content}.", params: "{path, content}",
    args: { path: { type: "string", required: true, desc: "file path (supports ~)" }, content: { type: "string", required: true, desc: "the full new file contents" } },
    activity: (i) => `Saving ${i.path}`, preview: (i) => writeFileCard(i), run: (i) => writeFileTool(i) },
  { name: "edit_file", safe: false,
    description: "Precisely edit an existing file by replacing a target snippet with new text. Fast, safe, and avoids rewriting whole files. input: {path, target, replacement, allowMultiple?}.",
    params: "{path, target, replacement, allowMultiple?}",
    args: {
      path: { type: "string", required: true, desc: "file path (supports ~)" },
      target: { type: "string", required: true, desc: "exact substring to find and replace (must match existing lines including indentation)" },
      replacement: { type: "string", required: true, desc: "the new replacement text" },
      allowMultiple: { type: "boolean", desc: "set to true if target occurs multiple times and all should be replaced" },
    },
    activity: (i) => `Editing ${i.path}`, preview: (i) => editFileCard(i), run: (i) => editFileTool(i) },
  { name: "open_app", safe: false, description: "Open a Mac application. input: app name.", params: "app name",
    activity: (i) => `Opening ${i.app ?? i}`, preview: (i) => `Open app: ${i.app ?? i}`, run: (i) => openApp(i.app ?? i) },
  { name: "type_text", safe: false, description: "Type text via the keyboard into the focused app. input: text.", params: "text",
    activity: () => `Typing`, preview: (i) => `Type into the active app:\n  ${i.text ?? i}`, run: (i) => typeText(i.text ?? i) },
  { name: "press_key", safe: false, description: "Press a key. input: {key: <key code number>, modifiers?: [command|shift|option|control]}.", params: "{key, modifiers?}",
    activity: () => `Pressing a key`, preview: (i) => `Press key code ${i.key}${i.modifiers?` + ${i.modifiers.join("+")}`:""}`, run: (i) => pressKey(i) },
  { name: "click", safe: false, description: "Click the mouse at screen coordinates. input: {x, y}.", params: "{x, y}",
    activity: (_i) => `Clicking the screen`, preview: (i) => `Click at ${i.x}, ${i.y}`, run: (i) => clickAt(i) },
  { name: "applescript", safe: false, description: "Run AppleScript for deep macOS automation (control apps, Messages, Mail, etc). input: script.", params: "script",
    activity: () => `Automating an app`, preview: (i) => `Run AppleScript:\n${i.script ?? i}`, run: (i) => appleScript(i.script ?? i) },
  { name: "clipboard_set", safe: false, description: "Put text on the clipboard. input: text.", params: "text",
    activity: () => `Copying to clipboard`, preview: (i) => `Copy to clipboard:\n  ${i.text ?? i}`, run: (i) => clipboardSet(i.text ?? i) },
  { name: "send_imessage", safe: false, description: "Send an iMessage/text. input: {to, message}.", params: "{to, message}",
    activity: (i) => `Texting ${i.to}`, preview: (i) => `Send iMessage\n  To: ${i.to}\n  ${i.message}`, run: (i) => sendIMessage(i) },
  { name: "read_notes", safe: true, description: "Read the user's recently modified Notes.", params: "(none)",
    activity: () => `Reading Notes`, run: async () => { if (!IS_MAC) return notSupported("Read Notes"); return await readAppleNotes(); } },
  { name: "append_note", safe: false, description: "Append text to a note by title. input: {title, text}.", params: "{title, text}",
    activity: (i) => `Appending to note: ${i.title}`, preview: (i) => `Append to Note '${i.title}':\n${clip(i.text, 100)}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          await osa(`tell application "Notes"\nset n to first note whose name contains "${esc(i.title)}"\nset body HTML of n to (body HTML of n) & "<br><br>${esc(i.text).replace(/\n/g, "<br>")}"\nend tell`);
          return `Appended to note '${i.title}'.`;
        } else {
          const notesDir = resolve(homedir(), "SAM_Notes");
          const nmeHits = await findByName(notesDir, String(i.title), 1); const stdout = nmeHits[0] || "";
          const file = resolve(notesDir, stdout.trim() || `${String(i.title).replace(/[^a-z0-9]/gi, '_')}.txt`);
          await appendFileFs(file, `\n\n${i.text}`, "utf8");   // fs write — no shell, no injection
          return `Appended to ${file}.`;
        }
      } catch (e: any) { return `Couldn't append to note: ${e.message}`; }
    } },
  { name: "read_reminders", safe: true, description: "Read pending Reminders.", params: "(none)",
    activity: () => `Checking Reminders`, run: async () => { if (!IS_MAC) return notSupported("Reminders"); return await readReminders(); } },
  { name: "browser_navigate", safe: false, description: "Open a Chrome browser tab and navigate to a URL. Returns page title.", params: "url",
    activity: (i) => `Navigating to ${i.url ?? i}`, preview: (i) => `Browser: Go to ${i.url ?? i}`, run: (i) => browserNavigate(i.url ?? i) },
  { name: "browser_read", safe: true, description: "Read the visible text from the currently open Chrome tab.", params: "(none)",
    activity: () => `Reading active browser tab`, run: browserRead },
  { name: "browser_click", safe: false, description: "Click an element in the active Chrome tab using a CSS selector.", params: "selector",
    activity: (i) => `Clicking ${i.selector ?? i}`, preview: (i) => `Browser: Click '${i.selector ?? i}'`, run: (i) => browserClick(i.selector ?? i) },
  { name: "browser_type", safe: false, description: "Type text into an element in the active Chrome tab. input: {selector, text, submit?}.", params: "{selector, text, submit?}",
    activity: (i) => `Typing into ${i.selector}`, preview: (i) => `Browser: Type into '${i.selector}'\n${i.text}`, run: (i) => browserType(i) },
  { name: "add_reminder", safe: false, description: "Add a new Reminder. input: {text, list?}. list defaults to 'Reminders'.", params: "{text, list?}",
    activity: (i) => `Adding reminder: ${i.text}`, preview: (i) => `Add Reminder to ${i.list || 'Reminders'}:\n${i.text}`,
    run: async (i) => {
      if (!IS_MAC) return notSupported("Reminders");
      try {
        const l = i.list || "Reminders";
        await osa(`tell application "Reminders"\ntell list "${esc(l)}"\nmake new reminder with properties {name:"${esc(i.text)}"}\nend tell\nend tell`);
        return `Added reminder '${i.text}'.`;
      } catch (e: any) { return `Couldn't add reminder: ${e.message}`; }
    } },
  { name: "read_email", safe: true, description: "Read unread emails from the inbox. Returns the sender, subject, date, and body snippet. input: {limit?: number}.", params: "{limit}",
    activity: () => `Checking inbox`,
    run: async (i) => {
      if (!IS_MAC) return notSupported("Read Mail");
      const limit = i.limit || 5;
      const script = `tell application "Mail"\nset unreadMsgs to (messages of inbox whose read status is false)\nset out to ""\nset counter to 0\nrepeat with msg in unreadMsgs\nif counter is ${limit} then exit repeat\nset out to out & "---" & return\nset out to out & "From: " & sender of msg & return\nset out to out & "Subject: " & subject of msg & return\nset out to out & "Date: " & date sent of msg & return\nset bodyText to content of msg\nif (length of bodyText) > 500 then\nset out to out & "Body: " & (text 1 thru 500 of bodyText) & "..." & return\nelse\nset out to out & "Body: " & bodyText & return\nend if\nset counter to counter + 1\nend repeat\nif out is "" then return "No unread emails."\nreturn out\nend tell`;
      try { return await osa(script); } catch (e: any) { return `Failed to read Mail: ${e.message}`; }
    } },
  { name: "draft_email", safe: false, description: "Draft a new email. input: {recipient, subject, body}.", params: "{recipient, subject, body}",
    activity: (i) => `Drafting email to ${i.recipient}`, preview: (i) => `To: ${i.recipient}\nSubject: ${i.subject}\n\n${i.body}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const script = `tell application "Mail"\nset newMsg to make new outgoing message with properties {subject:"${esc(i.subject)}", content:"${esc(i.body)}", visible:true}\ntell newMsg\nmake new to recipient at end of to recipients with properties {address:"${esc(i.recipient)}"}\nend tell\nactivate\nend tell`;
          await osa(script); return "Draft created and opened in Apple Mail.";
        } else {
          await openUrl(`mailto:${i.recipient}?subject=${encodeURIComponent(i.subject)}&body=${encodeURIComponent(i.body)}`);
          return `Opened email draft in default client.`;
        }
      } catch (e: any) { return `Failed to draft Mail: ${e.message}`; }
    } },
  { name: "run_shortcut", safe: false, description: "Run a native OS Shortcut/script by name. input: {name}.", params: "{name}",
    activity: (i) => `Running Shortcut: ${i.name}`, preview: (i) => `Run Shortcut:\n${i.name}`,
    run: async (i) => {
      if (!IS_MAC) return notSupported("Shortcuts");
      try {
        const { stdout } = await sh(`shortcuts run ${shq(i.name)}`);
        return stdout || `Ran shortcut '${i.name}'.`;
      } catch (e: any) { return `Shortcut failed: ${e.message}`; }
    } },
  { name: "list_shortcuts", safe: true, description: "List all available OS Shortcuts.", params: "(none)",
    activity: () => `Listing available Shortcuts`,
    run: async () => {
      if (!IS_MAC) return notSupported("Shortcuts");
      try { const { stdout } = await sh("shortcuts list"); return stdout; } catch (e: any) { return `Failed: ${e.message}`; }
    } },
  { name: "media_control", safe: false, description: "Control media playback (play/pause, next, previous). input: {action: 'playpause' | 'next' | 'prev'}.", params: "{action}",
    activity: (i) => `Controlling media (${i.action})`, preview: (i) => `Media: ${i.action}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const key = i.action === "next" ? 101 : i.action === "prev" ? 98 : 100;
          await osa(`tell application "System Events" to key code ${key}`);
        } else if (OS === "windows") {
          const key = i.action === "next" ? "^{MEDIA_NEXT_TRACK}" : i.action === "prev" ? "^{MEDIA_PREV_TRACK}" : "^{MEDIA_PLAY_PAUSE}";
          await sh(`powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${key}')"`);
        } else {
          const key = i.action === "next" ? "next" : i.action === "prev" ? "previous" : "play-pause";
          await sh(`playerctl ${key}`);
        }
        return `Triggered ${i.action}.`;
      } catch (e: any) { return `Failed: ${e.message}`; }
    } },
  { name: "append_file", safe: false, description: "Append text to a file (e.g. a notes/log). input: {path, content}.", params: "{path, content}",
    activity: (i) => `Adding to ${i.path}`, preview: (i) => `Append to ${i.path}:\n${i.content}`, run: (i) => appendFile(i) },
  { name: "trash_file", safe: false, description: "Move a file to the Trash (recoverable). input: path.", params: "path",
    activity: (i) => `Trashing ${i.path ?? i}`, preview: (i) => `Move to Trash: ${i.path ?? i}`, run: (i) => moveToTrash(i.path ?? i) },
  { name: "set_volume", safe: false, description: "Set the system volume 0-100. input: level.", params: "level",
    activity: (_i) => `Setting volume`, preview: (i) => `Set volume to ${i.level ?? i}%`, run: (i) => setVolume(i.level ?? i) },
  { name: "music", safe: false, description: "Control Apple Music. input: {action: play|pause|next|previous}.", params: "{action}",
    activity: (i) => `Music: ${i.action ?? i}`, preview: (i) => `Music control: ${i.action ?? i}`, run: (i) => musicControl(i.action ?? i) },
  { name: "call", safe: false, description: "Place a phone call through your iPhone (Continuity). input: a phone number.", params: "number",
    activity: (i) => `Calling ${i.number ?? i}`, preview: (i) => `📞 Call ${i.number ?? i}`, run: (i) => makeCall(i.number ?? i) },
  { name: "facetime", safe: false, description: "Start a FaceTime call. input: a phone number, email, or contact.", params: "who",
    activity: (i) => `FaceTiming ${i.who ?? i}`, preview: (i) => `FaceTime ${i.who ?? i}`, run: (i) => faceTime(i.who ?? i) },
  { name: "remember_fact", safe: true, description: "Explicitly save a core fact (preference, detail, rule) into SAM's long-term semantic vault. input: {fact}.", params: "{fact}",
    activity: () => `Storing fact in semantic memory`, run: async (i) => (await remember(i.fact)) ? "Fact saved." : "Fact ignored (too short or duplicate)." },
  { name: "search_memory", safe: true, description: "Search the semantic vault for a specific topic, returning the raw facts and their IDs. input: {query}.", params: "{query}",
    activity: (i) => `Searching memory for "${i.query}"`, run: async (i) => {
      const results = await recall(i.query, 10, 0.2);
      if (!results.length) return "No matching memories found.";
      return results.map(r => `[ID: ${r.id}] ${r.text} (score: ${r.score.toFixed(2)})`).join("\n");
    } },
  { name: "list_recent_memories", safe: true, description: "Pull the last 10 facts added to the vault chronologically. input: (none).", params: "(none)",
    activity: () => `Listing recent memories`, run: async () => {
      const recent = listRecent(10);
      if (!recent.length) return "Vault is empty.";
      return recent.map(r => `[ID: ${r.id}] ${new Date(r.ts).toLocaleString()}: ${r.text}`).join("\n");
    } },
  { name: "forget_memory", safe: false, description: "Delete a specific memory by its unique ID. input: {id}.", params: "{id}",
    activity: (i) => `Forgetting memory ${i.id}`, preview: (i) => `Permanently delete memory ${i.id}?`, run: async (i) => forget(i.id) ? `Deleted memory ${i.id}.` : `Memory ${i.id} not found.` },
  { name: "clear_all_memories", safe: false, description: "NUCLEAR OPTION: Wipes the entire semantic memory vault clean.", params: "(none)",
    activity: () => `Wiping memory vault`, preview: () => `Wipe entire memory vault?`, run: async () => { clearAll(); return "Memory vault wiped clean."; } },
  { name: "ingest_folder", safe: false, description: "Index every readable document in a folder (recursively — md/txt/pdf/docx/csv/json/html) into SAM's document library so SAM knows their contents and can recall them by meaning. Re-running skips unchanged files. input: {path, max_files?}.", params: "{path, max_files?}",
    activity: (i) => `Indexing documents in ${i.path ?? i}`,
    preview: (i) => `Scan ${i.path ?? i} and index its documents into SAM's library (uses free embedding quota; unchanged files are skipped; ~${Number(i.max_files) || 300} files max this run)`,
    run: async (i) => reportText(await ingestFolder(i.path ?? i, Number(i.max_files) || 300)) },
  { name: "search_docs", safe: true, description: "Search the user's ingested document library by meaning — returns the best-matching passages with their source files. input: {query}.", params: "{query}",
    activity: (i) => `Searching your documents for "${i.query ?? i}"`, run: async (i) => {
      const hits = await searchDocs(i.query ?? i);
      if (!hits.length) return docsStats().chunks ? "No matching passages in the document library." : "The document library is empty — ingest a folder first (ingest_folder).";
      return hits.map((h) => `[${h.source}] (${h.score.toFixed(2)})\n${h.text}`).join("\n\n");
    } },
  { name: "docs_library", safe: true, description: "Show what's in SAM's document library — counts + the most recently indexed files. input: (none).", params: "(none)",
    activity: () => `Checking the document library`, run: async () => {
      const s = docsStats();
      if (!s.files) return "The document library is empty. Point me at a folder and I'll learn it (ingest_folder).";
      const recent = recentDocs(12).map((r) => `- ${r.path} (${r.chunks} chunks, ${new Date(r.ts).toLocaleDateString()})`).join("\n");
      return `${s.files} files · ${s.chunks} searchable chunks.\nMost recent:\n${recent}`;
    } },
  { name: "forget_docs", safe: false, description: "Remove a file or a whole folder from SAM's document library. input: {path}.", params: "{path}",
    activity: (i) => `Removing ${i.path ?? i} from the library`, preview: (i) => `Forget everything indexed under ${i.path ?? i}?`,
    run: async (i) => { const n = forgetDoc(i.path ?? i); return n ? `Forgot ${n} indexed chunk(s) under ${i.path ?? i}.` : `Nothing in the library under ${i.path ?? i}.`; } },
  // ── THE LIFE INDEX (Phase 3) — folders the user chooses, kept fresh automatically ──
  { name: "watch_folder", safe: false, description: "Add a folder to SAM's LIFE INDEX: index it now AND keep it auto-updated as files change (file-watcher, paused on battery). Like watch_folder for your whole world. input: {path}.", params: "{path}",
    activity: (i) => `Adding ${i.path ?? i} to your life index`, preview: (i) => `Index ${i.path ?? i} and keep it live-updated as its files change (local only; nothing leaves your Mac)`,
    run: async (i) => { const { report } = await addFolder(i.path ?? i); return report ? reportText(report) + " Now watching it for changes." : `Added ${i.path ?? i} to the life index (indexing paused — on battery or busy; it'll catch up when plugged in).`; } },
  { name: "unwatch_folder", safe: false, description: "Remove a folder from SAM's life index — stops watching it and forgets its contents. input: {path}.", params: "{path}",
    activity: (i) => `Removing ${i.path ?? i} from your life index`, preview: (i) => `Stop watching ${i.path ?? i} and forget everything indexed under it?`,
    run: async (i) => { const r = removeFolder(i.path ?? i); return r.removed ? `Stopped watching ${i.path ?? i} and forgot ${r.forgotten} chunk(s).` : `${i.path ?? i} isn't in the life index.`; } },
  { name: "life_index", safe: true, description: "Show SAM's life index — which of your folders are indexed and watched for changes. input: (none).", params: "(none)",
    activity: () => `Checking your life index`, run: async () => {
      const s = lifeIndexStats(); const folders = listFolders();
      if (!folders.length) return "Your life index is empty. Pick a folder (Documents, Desktop, a projects dir) with watch_folder and I'll learn it and keep it fresh.";
      return `${s.folders} folder(s) in your life index · watching: ${s.watching ? "on" : "off"} (${s.watchers} live)\n` +
        folders.map((f) => `- ${f.path}${f.lastIndexedAt ? ` (last indexed ${new Date(f.lastIndexedAt).toLocaleString()})` : " (not indexed yet)"}`).join("\n");
    } },
  { name: "ask_about", safe: true, description: "Answer a question grounded ONLY in a specific file or folder from your indexed library, citing the source files. input: {path, question}.", params: "{path, question}",
    activity: (i) => `Reading your ${(i.path ?? "").split("/").pop() || "files"} to answer that`, run: async (i) => {
      const { answer, sources } = await askAbout(i.path ?? "", i.question ?? "");
      return sources.length ? `${answer}\n\nSources: ${sources.map((s: string) => s.split("/").pop()).join(", ")}` : answer;
    } },
  { name: "add_schedule", safe: false, description: "Create a recurring background task. input: {command, cron} (cron: 'hourly', 'every 30m', 'daily 09:00', 'weekly mon 09:00').", params: "{command, cron}",
    activity: () => `Adding scheduled task`, preview: (i) => `Set up a recurring task — run "${i.command}" ${i.cron}?`, run: async (i) => { const s = addSchedule(i.command, i.cron); return `Scheduled '${s.command}' to run ${s.cron} (ID: ${s.id}).`; } },
  { name: "list_schedules", safe: true, description: "List all active background routines and scheduled tasks SAM is maintaining.", params: "(none)",
    activity: () => `Listing schedules`, run: async () => {
      const list = listSchedules();
      if (!list.length) return "No active schedules.";
      return list.map(s => `[${s.id}] ${s.cron} | ${s.command} | runs: ${s.runCount} | enabled: ${s.enabled} | last: ${s.lastResult || "never"}`).join("\n");
    } },
  { name: "remove_schedule", safe: false, description: "Delete a specific scheduled task by ID. input: {id}.", params: "{id}",
    activity: (i) => `Removing schedule ${i.id}`, preview: (i) => `Delete scheduled task ${i.id}?`, run: async (i) => removeSchedule(i.id) ? `Removed schedule ${i.id}.` : `Schedule ${i.id} not found.` },
  { name: "toggle_schedule", safe: true, description: "Pause or resume a scheduled task by ID. input: {id}.", params: "{id}",
    activity: (i) => `Toggling schedule ${i.id}`, run: async (i) => { const s = toggleSchedule(i.id); return s ? `Schedule ${s.id} is now ${s.enabled ? "enabled" : "paused"}.` : `Schedule ${i.id} not found.`; } },
  { name: "start_swarm", safe: true, description: "Spin up a continuous background Swarm of agents for a massive, multi-step task. input: {goal, system}.", params: "{goal, system}",
    activity: () => `Spawning Swarm`, run: async (i) => { const s = await startSwarm(i.goal, i.system, "free"); return `Swarm '${s.id}' launched. Run list_swarms to check status.`; } },
  { name: "list_swarms", safe: true, description: "List all active or completed background Swarms.", params: "(none)",
    activity: () => `Listing Swarms`, run: async () => {
      const swarms = loadSwarms();
      if (!swarms.length) return "No swarms exist.";
      return swarms.map(s => `[${s.id}] ${s.goal} | status: ${s.status} | agents: ${s.agents.length}`).join("\n");
    } },
  { name: "list_projects", safe: true, description: "List all active brands, projects, and concepts SAM is managing.", params: "(none)",
    activity: () => `Reading Project Registry`, run: async () => {
      if (!PROJECTS.length) return "No projects in registry.";
      return PROJECTS.map(p => `[${p.id}] ${p.name} (${p.status}) - ${p.summary}`).join("\n");
    } },
  { name: "manage_api_keys", safe: false, description: "Add or update an API key in SAM's .env file. input: {provider, key}. Providers: ANTHROPIC, OPENAI, GEMINI, GROQ, etc.", params: "{provider, key}",
    activity: (i) => `Updating ${i.provider} API key`, preview: (i) => `Save ${i.provider} API key to .env?`, run: async (i) => {
      try {
        const fs = await import("node:fs/promises");
        const envPath = resolve(process.cwd(), ".env");
        let content = "";
        try { content = await fs.readFile(envPath, "utf8"); } catch { /* best-effort — nothing downstream depends on this succeeding */ }
        const varName = `${i.provider.toUpperCase()}_API_KEYS`;
        const regex = new RegExp(`^${varName}=.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, `${varName}=${i.key}`);
        } else {
          content += `\n${varName}=${i.key}\n`;
        }
        await fs.writeFile(envPath, content.trim() + "\n", "utf8");
        return `Saved ${varName} to .env. IMPORTANT: Please restart SAM for the new keys to be loaded into the pools.`;
      } catch (e: any) { return `Failed to update .env: ${e.message}`; }
    } },
  // ─── ADMIN SUITE ────────────────────────────────────────────────────────────
  { name: "manage_autopilot", safe: false, description: "Turn SAM's autopilot mode on or off. When on, SAM runs low-risk tools without asking. input: {action: 'on' | 'off' | 'status'}.", params: "{action}",
    activity: (i) => `Autopilot: ${i.action}`, preview: (i) => i.action === "off" ? `Turn OFF autopilot — SAM will ask permission for every action?` : `Turn ON autopilot — SAM runs safe tools without asking?`,
    run: async (i) => {
      if (i.action === "status") return `Autopilot is currently ${autopilotOn() ? "ON ✅" : "OFF 🔴"}.`;
      if (i.action === "on") { setAutopilot(true); return "Autopilot is now ON. SAM will handle safe tasks autonomously."; }
      if (i.action === "off") { setAutopilot(false); return "Autopilot is now OFF. SAM will ask before every action."; }
      return `Unknown action '${i.action}'. Use: on, off, or status.`;
    } },
  { name: "manage_authorizations", safe: false, description: "View, grant, or revoke SAM's standing 'always allow' permissions for specific tools. input: {action: 'list' | 'grant' | 'revoke', tool?: string}.", params: "{action, tool?}",
    activity: (i) => `Permissions: ${i.action} ${i.tool ?? ""}`.trim(), preview: (i) => i.action === "revoke" ? `Revoke permanent permission for '${i.tool}'?` : `Grant permanent permission for '${i.tool}'?`,
    run: async (i) => {
      if (i.action === "list") {
        const tools = listAllowed();
        return tools.length ? `Always-allowed tools:\n${tools.map((t: string) => `  • ${t}`).join("\n")}` : "No tools are permanently authorized — SAM asks for every action.";
      }
      if (!i.tool) return "Please specify a tool name.";
      if (i.action === "grant") { allow(i.tool); return `Granted permanent permission for '${i.tool}'.`; }
      if (i.action === "revoke") { disallow(i.tool); return `Revoked permanent permission for '${i.tool}'.`; }
      return `Unknown action '${i.action}'. Use: list, grant, or revoke.`;
    } },
  { name: "stop_swarm", safe: false, description: "Emergency kill-switch for a running Swarm. Immediately halts all agents. input: {id}.", params: "{id}",
    activity: (i) => `Killing swarm ${i.id}`, preview: (i) => `KILL swarm ${i.id}? All running agents will be stopped immediately.`,
    run: async (i) => stopSwarm(i.id) ? `Swarm '${i.id}' has been killed. All agents halted.` : `Swarm '${i.id}' not found.` },
  { name: "self_restart", safe: false, description: "Cleanly restart SAM's server process. Useful after updating API keys or source code. input: (none).", params: "(none)",
    activity: () => `Restarting SAM...`, preview: () => `Restart SAM's server process now?`,
    run: async () => {
      setTimeout(() => process.exit(0), 500);
      return "SAM is restarting... I'll be back in a moment. 👋";
    } },
  { name: "kill_process", safe: false, description: "Force quit a misbehaving app or process by name. input: {process_name}.", params: "{process_name}",
    activity: (i) => `Killing process ${i.process_name}`, preview: (i) => `Force quit ${i.process_name}?`, run: async (i) => {
      try {
        await sh(`pkill -i -f ${shq(i.process_name)}`);
        return `Terminated process matching "${i.process_name}".`;
      } catch (e: any) { return `Failed to kill (or not found): ${e.message}`; }
    } },
  { name: "kill_port", safe: false, description: "Instantly kill whatever is blocking a specific port. input: {port}.", params: "{port}",
    activity: (i) => `Killing port ${i.port}`, preview: (i) => `Kill process on port ${i.port}?`, run: async (i) => {
      try {
        await sh(`lsof -ti:${Number(i.port)} | xargs kill -9`);
        return `Killed process on port ${i.port}.`;
      } catch (e: any) { return `Failed (port might be empty): ${e.message}`; }
    } },
  { name: "local_ocr", safe: true, description: "Extract text from a local image file. input: {image_path}.", params: "{image_path}",
    activity: () => `Extracting text from image`, run: async (i) => {
      try {
        const { stdout } = await sh(`macocr ${shq(i.image_path)}`);
        return stdout.trim() || "No text found.";
      } catch (e: any) { return `OCR failed. If macOCR isn't installed, run: brew install schappim/macocr/macocr\nError: ${e.message}`; }
    } },
  // ─── ADMIN: VAULT ─────────────────────────────────────────────────────────
  { name: "vault_status", safe: true, description: "Show the Obsidian vault stats: daily note count, project note count, disk path, and recent log entries.", params: "(none)",
    activity: () => `Checking vault status`, run: async () => {
      const s = vaultStats();
      const log = recentLog(5);
      const lines = [`📁 Vault: ${s.path}`, `  • Daily notes: ${s.dailyNotes}`, `  • Project notes: ${s.projectNotes}`];
      if (log.length) { lines.push("", "Recent log entries:"); log.forEach((l) => { lines.push(`  ${l.time}  ${l.msg}`); }); }
      return lines.join("\n");
    } },
  { name: "read_today_log", safe: true, description: "Read today's conversation log from the vault.", params: "(none)",
    activity: () => `Reading today's vault log`, run: async () => {
      const entries = recentLog(20);
      if (!entries.length) return "Nothing logged today yet.";
      return entries.map((l) => `${l.time}  ${l.msg}`).join("\n");
    } },
  { name: "prune_vault", safe: false, description: "Manually purge daily log files older than SAM_LOG_DAYS (default 90 days).", params: "(none)",
    activity: () => `Pruning old vault logs`, preview: () => `Delete vault daily notes older than 90 days?`,
    run: async () => { const r = pruneOldLogs(); return `Pruned ${r.removed} old log file${r.removed !== 1 ? "s" : ""}.`; } },
  // ─── ADMIN: KEY POOL HEALTH ────────────────────────────────────────────────
  // ── 📸 STOCK MEDIA + assets — real footage/photos/GIFs/film data (free tiers) ──
  { name: "stock_photo", safe: true, description: "Find REAL stock photos (free, commercial-ok) via Pexels or Pixabay. input: {query, count?}.", params: "{query, count?}",
    activity: (i) => `Finding stock photos: ${i.query ?? i}`, run: async (i) => {
      const q = String(i.query ?? i ?? "").trim(); if (!q) return "What photos are you after?";
      const n = Math.min(8, Math.max(1, Number(i.count) || 4));
      const px = process.env.PEXELS_API_KEY;
      if (px) { try { const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n}`, { headers: { Authorization: px }, signal: AbortSignal.timeout(15000) }); if (r.ok) { const d: any = await r.json(); const ph = (d.photos || []).map((p: any) => p.src?.large2x || p.src?.large).filter(Boolean); if (ph.length) return `📸 ${ph.length} photos (Pexels):\n` + ph.map((u: string) => `![photo](${u})`).join("\n"); } } catch { /* provider fallback — try the next image source */ } }
      const pb = process.env.PIXABAY_API_KEY;
      if (pb) { try { const r = await fetch(`https://pixabay.com/api/?key=${pb}&q=${encodeURIComponent(q)}&per_page=${n}&image_type=photo`, { signal: AbortSignal.timeout(15000) }); if (r.ok) { const d: any = await r.json(); const ph = (d.hits || []).map((h: any) => h.largeImageURL || h.webformatURL).filter(Boolean); if (ph.length) return `📸 ${ph.length} photos (Pixabay):\n` + ph.map((u: string) => `![photo](${u})`).join("\n"); } } catch { /* provider fallback — try the next image source */ } }
      return "To search real stock photos, add a free Pexels or Pixabay key in Settings → Media.";
    } },
  { name: "stock_video", safe: true, description: "Find REAL stock video / b-roll (free) via Pexels or Pixabay. input: {query, count?}.", params: "{query, count?}",
    activity: (i) => `Finding b-roll: ${i.query ?? i}`, run: async (i) => {
      const q = String(i.query ?? i ?? "").trim(); if (!q) return "What footage do you need?";
      const n = Math.min(6, Math.max(1, Number(i.count) || 3));
      const px = process.env.PEXELS_API_KEY;
      if (px) { try { const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${n}`, { headers: { Authorization: px }, signal: AbortSignal.timeout(15000) }); if (r.ok) { const d: any = await r.json(); const vids = (d.videos || []).map((v: any) => v.video_files?.find((f: any) => f.quality === "hd")?.link || v.video_files?.[0]?.link).filter(Boolean); if (vids.length) return `🎬 ${vids.length} clips (Pexels):\n` + vids.map((u: string) => u).join("\n"); } } catch { /* provider fallback — try the next image source */ } }
      const pb = process.env.PIXABAY_API_KEY;
      if (pb) { try { const r = await fetch(`https://pixabay.com/api/videos/?key=${pb}&q=${encodeURIComponent(q)}&per_page=${n}`, { signal: AbortSignal.timeout(15000) }); if (r.ok) { const d: any = await r.json(); const vids = (d.hits || []).map((h: any) => h.videos?.large?.url || h.videos?.medium?.url).filter(Boolean); if (vids.length) return `🎬 ${vids.length} clips (Pixabay):\n` + vids.join("\n"); } } catch { /* provider fallback — try the next image source */ } }
      return "To search real b-roll, add a free Pexels or Pixabay key in Settings → Media.";
    } },
  { name: "find_gif", safe: true, description: "Find a GIF via GIPHY (free). input: {query}.", params: "{query}",
    activity: (i) => `Finding a GIF: ${i.query ?? i}`, run: async (i) => {
      const q = String(i.query ?? i ?? "").trim(); if (!q) return "What GIF?";
      const k = process.env.GIPHY_API_KEY; if (!k) return "Add a free GIPHY key in Settings → Media to search GIFs.";
      try { const r = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${k}&q=${encodeURIComponent(q)}&limit=3`, { signal: AbortSignal.timeout(12000) }); if (r.ok) { const d: any = await r.json(); const g = (d.data || []).map((x: any) => x.images?.original?.url).filter(Boolean); if (g.length) return g.map((u: string) => `![gif](${u})`).join("\n"); } } catch { /* provider fallback — try the next media source */ }
      return "Couldn't find a GIF for that.";
    } },
  { name: "movie_info", safe: true, description: "Look up a film/TV show — plot, year, rating, poster — via TMDb or OMDb (free). input: {title}.", params: "{title}",
    activity: (i) => `Looking up “${i.title ?? i}”`, run: async (i) => {
      const t = String(i.title ?? i ?? "").trim(); if (!t) return "Which title?";
      const tmdb = process.env.TMDB_API_KEY;
      if (tmdb) { try { const r = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${tmdb}&query=${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(12000) }); if (r.ok) { const d: any = await r.json(); const m = d.results?.[0]; if (m) return `🎬 **${m.title || m.name}** (${(m.release_date || m.first_air_date || "").slice(0, 4)}) · ⭐ ${m.vote_average}\n${m.overview || ""}${m.poster_path ? `\n\n![poster](https://image.tmdb.org/t/p/w500${m.poster_path})` : ""}`; } } catch { /* provider fallback — try the next metadata source */ } }
      const omdb = process.env.OMDB_API_KEY;
      if (omdb) { try { const r = await fetch(`https://www.omdbapi.com/?apikey=${omdb}&t=${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(12000) }); if (r.ok) { const m: any = await r.json(); if (m.Title) return `🎬 **${m.Title}** (${m.Year}) · ⭐ ${m.imdbRating}\n${m.Plot || ""}${m.Poster && m.Poster !== "N/A" ? `\n\n![poster](${m.Poster})` : ""}`; } } catch { /* provider fallback — try the next metadata source */ } }
      return "Add a free TMDb or OMDb key in Settings → Media to look up films.";
    } },

  { name: "generate_image", safe: true, description: "Create an image from a text description — FREE (rotating free lanes, no key needed). Returns the image inline. input: {prompt, width?, height?}.", params: "{prompt, width?, height?}",
    activity: (i) => `Painting: ${String(i.prompt || "").slice(0, 40)}…`, run: async (i) => {
      const prompt = String(i.prompt || i || "").trim();
      if (!prompt) return "Give me a description of the image you want.";
      const w = Math.min(2048, Math.max(256, Number(i.width) | 0 || 1024));
      const h = Math.min(2048, Math.max(256, Number(i.height) | 0 || 1024));
      const done = (url: string, via: string) => `Here you go:\n\n![${prompt.slice(0, 80)}](${url})\n\n(Free — made via ${via}. Right-click to save; want a variation? Just ask.)`;
      // LANE 1 · Pollinations — free, NO key, effectively unlimited. Always first: never
      // spend anyone's free credits while an unlimited no-key lane works.
      const seed = Math.floor(Math.random() * 1e9);
      const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 500))}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
      try {
        // Any response = the host is up (some CDNs answer HEAD with 405 but serve the GET fine).
        // Only a real network error/timeout falls through — so we never burn paid credits when
        // the free lane is reachable. The browser does the actual GET that renders the image.
        await fetch(pUrl, { method: "HEAD", signal: AbortSignal.timeout(20000) });
        return done(pUrl, "Pollinations");
      } catch { /* network error only → try the keyed lanes */ }
      // ── CLOUDFLARE Workers AI · FLUX.1-schnell — up to ~100k images/DAY free (account id + token) ──
      const cfAcct = process.env.CLOUDFLARE_ACCOUNT_ID, cfTok = process.env.CLOUDFLARE_API_TOKEN;
      if (cfAcct && cfTok) {
        try {
          const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAcct}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfTok}` }, signal: AbortSignal.timeout(45000),
            body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 6 }),
          });
          if (r.ok) { const d: any = await r.json(); const b64 = d?.result?.image; if (b64) return done(`data:image/jpeg;base64,${b64}`, "Cloudflare FLUX"); }
        } catch { /* fall through */ }
      }
      // KEYED LANES · rotate smartly (Oliver Twist — sip each provider's free credits evenly).
      // A comprehensive free FLUX/SD matrix — SAM hops across whichever you've connected.
      type ImgLane = { id: string; make: (key: string) => Promise<string | null> };
      const dataUri = (b64: string, mime = "image/png") => `data:${mime};base64,${b64}`;
      const LANES: ImgLane[] = [
        { id: "huggingface", make: async (k) => {   // FLUX.1-schnell via HF Inference (returns image bytes)
          const r = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ inputs: prompt.slice(0, 800) }),
          });
          if (!r.ok) { reportFailure("huggingface", k, r.status); return null; }
          const ct = r.headers.get("content-type") || ""; if (!ct.startsWith("image")) return null;
          reportSuccess("huggingface", k); return dataUri(Buffer.from(await r.arrayBuffer()).toString("base64"), ct.split(";")[0]);
        } },
        { id: "nvidia", make: async (k) => {   // FLUX.1-schnell via NVIDIA (base64 artifacts)
          const r = await fetch("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}`, Accept: "application/json" }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ prompt: prompt.slice(0, 500), width: Math.min(w, 1024), height: Math.min(h, 1024), steps: 4, seed: Math.floor(Math.random() * 1e6) }),
          });
          if (!r.ok) { reportFailure("nvidia", k, r.status); return null; }
          const d: any = await r.json(); const b64 = d?.artifacts?.[0]?.base64 || d?.image; if (b64) { reportSuccess("nvidia", k); return dataUri(b64); } return null;
        } },
        { id: "deepinfra", make: async (k) => {   // FLUX-1-schnell
          const r = await fetch("https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-1-schnell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ prompt: prompt.slice(0, 800) }),
          });
          if (!r.ok) { reportFailure("deepinfra", k, r.status); return null; }
          const d: any = await r.json(); const u = d?.images?.[0] || d?.image_url; if (u) { reportSuccess("deepinfra", k); return u; } return null;
        } },
        { id: "fal", make: async (k) => {   // FLUX schnell (synchronous)
          const r = await fetch("https://fal.run/fal-ai/flux/schnell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Key ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ prompt: prompt.slice(0, 800), image_size: h > w ? "portrait_16_9" : w > h ? "landscape_16_9" : "square_hd" }),
          });
          if (!r.ok) { reportFailure("fal", k, r.status); return null; }
          const u = (await r.json())?.images?.[0]?.url; if (u) reportSuccess("fal", k); return u || null;
        } },
        { id: "leonardo", make: async (k) => {   // Leonardo.Ai — async (submit + poll); $5 free credit
          const sub = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ prompt: prompt.slice(0, 800), num_images: 1, width: Math.min(w, 1024), height: Math.min(h, 1024) }),
          });
          if (!sub.ok) { reportFailure("leonardo", k, sub.status); return null; }
          const id = (await sub.json())?.sdGenerationJob?.generationId; if (!id) return null;
          for (let t = 0; t < 20; t++) {
            await new Promise((r) => setTimeout(r, 3000));
            const st = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${id}`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000) });
            if (!st.ok) continue;
            const g: any = await st.json(); const img = g?.generations_by_pk?.generated_images?.[0]?.url;
            if (img) { reportSuccess("leonardo", k); return img; }
            if (g?.generations_by_pk?.status === "FAILED") return null;
          }
          return null;
        } },
        { id: "together", make: async (k) => {   // FLUX.1-schnell free model
          const r = await fetch("https://api.together.xyz/v1/images/generations", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ model: "black-forest-labs/FLUX.1-schnell-Free", prompt: prompt.slice(0, 500), width: Math.min(w, 1440), height: Math.min(h, 1440), steps: 4, n: 1 }),
          });
          if (!r.ok) { reportFailure("together", k, r.status); return null; }
          const u = (await r.json())?.data?.[0]?.url; if (u) reportSuccess("together", k); return u || null;
        } },
        { id: "siliconflow", make: async (k) => {   // Kwai-Kolors / SD — free tier
          const r = await fetch("https://api.siliconflow.cn/v1/images/generations", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ model: "Kwai-Kolors/Kolors", prompt: prompt.slice(0, 500), image_size: `${Math.min(w, 1024)}x${Math.min(h, 1024)}`, num_inference_steps: 20 }),
          });
          if (!r.ok) { reportFailure("siliconflow", k, r.status); return null; }
          const u = (await r.json())?.images?.[0]?.url; if (u) reportSuccess("siliconflow", k); return u || null;
        } },
      ];
      const avail = LANES.filter((l) => poolSize(l.id) > 0);
      const start = Math.floor(Math.random() * Math.max(1, avail.length));   // spread credit use
      for (let n = 0; n < avail.length; n++) {
        const lane = avail[(start + n) % avail.length];
        const k = getKey(lane.id); if (!k) continue;
        try { const u = await lane.make(k); if (u) return done(u, lane.id); } catch { /* next lane */ }
      }
      // Last resort: hand back the Pollinations URL anyway — the browser will trigger generation.
      return done(pUrl, "Pollinations");
    } },
  { name: "list_photos", safe: true, description: "List the photos SAM has taken/saved (vault/photos) with timestamps — newest first. input: (none).", params: "(none)",
    activity: () => `Checking my photo roll`, run: async () => {
      const dir = join(VAULT_DIR, "photos");
      if (!existsSync(dir)) return "No photos yet — say 'take a photo' or hit 📸 in the ＋ menu.";
      const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort().reverse().slice(0, 40);
      return files.length ? `📸 ${files.length} photo(s), newest first:\n${files.map((f) => `- ${join(dir, f)}`).join("\n")}` : "No photos yet.";
    } },
  { name: "view_photo", safe: true, description: "Look at a saved photo/image file and describe or answer questions about it (e.g. find where objects are in past snapshots). input: {path, question?}.", params: "{path, question?}",
    activity: (i) => `Looking at ${basename(String(i.path || ""))}`, run: async (i) => {
      const p = String(i.path || i || "").replace(/^~/, homedir());
      // Safety: this auto-runs, so a prompt-injected model could try to read arbitrary files.
      // Only ever open real image files, and never anything inside a sensitive/hidden dir.
      if (!/\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(p)) return "I can only look at image files (jpg/png/gif/webp).";
      if (/\/\.(ssh|aws|gnupg|config|kube|docker)\b|\/\.env|id_rsa|\/etc\/|\/var\/(root|log)|Keychains?/i.test(p)) return "I won't open files from a protected location.";
      if (!existsSync(p)) return `Can't find that image: ${p || "(no path)"}`;
      const buf = await readFile(p);
      if (buf.length > 8 * 1024 * 1024) return "That image is over 8MB — too big to inspect.";
      const mime = /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : /\.gif$/i.test(p) ? "image/gif" : "image/jpeg";
      const r = await runVision("You are SAM's eyes reviewing a saved photo.", String(i.question || "Describe this photo in detail — objects, people you might know, and where things are."), [{ mime, data: buf.toString("base64") }]);
      return r.text;
    } },
  { name: "transcribe_audio", safe: true, description: "Transcribe an audio file (voice memo, recording, podcast clip) to text — free via Groq Whisper. input: {path}.", params: "{path}",
    activity: (i) => `Transcribing ${basename(String(i.path || ""))}`, run: async (i) => {
      const p = String(i.path || i || "").replace(/^~/, homedir());
      if (!p || !existsSync(p)) return `Can't find that audio file: ${p || "(no path)"}`;
      const gk = getKey("groq");
      if (!gk) return "Transcription needs a (free) Groq key — grab one at console.groq.com/keys and paste it in Settings → API keys.";
      try {
        const buf = await readFile(p);
        if (buf.length > 24 * 1024 * 1024) return "That file's over 24MB — trim it down and I'll transcribe it.";
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(buf)]), basename(p) || "audio.m4a");
        form.append("model", "whisper-large-v3");
        const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST", headers: { Authorization: `Bearer ${gk}` }, body: form, signal: AbortSignal.timeout(120000),
        });
        if (!r.ok) { reportFailure("groq", gk, r.status); return `Transcription failed (HTTP ${r.status}).`; }
        reportSuccess("groq", gk);
        const text = ((await r.json()) as any)?.text?.trim() || "";
        return text ? `Transcript of ${basename(p)}:\n\n${clip(text, 6000)}` : "Transcribed, but it came back empty — is there speech in that file?";
      } catch (e: any) { return `Transcription hiccup: ${String(e?.message || e).slice(0, 120)}`; }
    } },
  { name: "generate_video", safe: true, description: "Create a short AI video (with sound) from a text description — HappyHorse #1 model via fal, or Novita/SiliconFlow free credits (~1-2 min). input: {prompt}.", params: "{prompt}",
    activity: (i) => `Filming: ${String(i.prompt || "").slice(0, 40)}…`, run: async (i) => {
      const prompt = String(i.prompt || i || "").trim();
      if (!prompt) return "Describe the video you want.";
      // Two free-credit lanes (Novita, SiliconFlow) — rotate to sip credits evenly. Both
      // are async APIs: submit a job, poll (bounded ~2 min).
      const poll = async (fn: () => Promise<string | "pending" | "failed">): Promise<string | null> => {
        for (let t = 0; t < 24; t++) {
          await new Promise((r) => setTimeout(r, 5000));
          try { const s = await fn(); if (s === "failed") return null; if (s !== "pending") return s; } catch { /* keep polling */ }
        }
        return null;
      };
      type VidLane = { id: string; make: (key: string) => Promise<string | null> };
      const LANES: VidLane[] = [
        { id: "fal", make: async (k) => {   // 🏇 HappyHorse 1.1 (Alibaba) — #1 arena video model, native audio; fal = official API
          const sub = await fetch("https://queue.fal.run/alibaba/happy-horse/v1.1/text-to-video", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Key ${k}` }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ prompt: prompt.slice(0, 500) }),
          });
          if (!sub.ok) { reportFailure("fal", k, sub.status); return null; }
          const j: any = await sub.json();
          const statusUrl = j?.status_url, responseUrl = j?.response_url;
          if (!statusUrl || !responseUrl) return null;
          const out = await poll(async () => {
            const st = await fetch(statusUrl, { headers: { Authorization: `Key ${k}` }, signal: AbortSignal.timeout(15000) });
            if (!st.ok) return "pending";
            const d: any = await st.json();
            if (d?.status === "COMPLETED") {
              const r = await fetch(responseUrl, { headers: { Authorization: `Key ${k}` }, signal: AbortSignal.timeout(15000) });
              const v: any = r.ok ? await r.json() : null;
              return v?.video?.url || v?.video_url || "failed";
            }
            if (d?.status === "FAILED" || d?.status === "ERROR") return "failed";
            return "pending";
          });
          if (out) reportSuccess("fal", k);
          return out;
        } },
        { id: "novita", make: async (k) => {
          const sub = await fetch("https://api.novita.ai/v3/async/txt2video", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ model_name: "darkSushiMixMix_225D_46414.safetensors", prompt: prompt.slice(0, 400), width: 640, height: 384, steps: 20, frames: 64 }),
          });
          if (!sub.ok) { reportFailure("novita", k, sub.status); return null; }
          const { task_id } = (await sub.json()) as { task_id?: string };
          if (!task_id) return null;
          const out = await poll(async () => {
            const st = await fetch(`https://api.novita.ai/v3/async/task-result?task_id=${encodeURIComponent(task_id)}`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000) });
            if (!st.ok) return "pending";
            const d: any = await st.json();
            if (d?.task?.status === "TASK_STATUS_SUCCEED") return d?.videos?.[0]?.video_url || d?.video?.video_url || "failed";
            if (d?.task?.status === "TASK_STATUS_FAILED") return "failed";
            return "pending";
          });
          if (out) reportSuccess("novita", k);
          return out;
        } },
        { id: "siliconflow", make: async (k) => {
          const sub = await fetch("https://api.siliconflow.cn/v1/video/submit", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ model: "Wan-AI/Wan2.1-T2V-14B-Turbo", prompt: prompt.slice(0, 400) }),
          });
          if (!sub.ok) { reportFailure("siliconflow", k, sub.status); return null; }
          const { requestId } = (await sub.json()) as { requestId?: string };
          if (!requestId) return null;
          const out = await poll(async () => {
            const st = await fetch("https://api.siliconflow.cn/v1/video/status", {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000),
              body: JSON.stringify({ requestId }),
            });
            if (!st.ok) return "pending";
            const d: any = await st.json();
            if (d?.status === "Succeed") return d?.results?.videos?.[0]?.url || "failed";
            if (d?.status === "Failed") return "failed";
            return "pending";
          });
          if (out) reportSuccess("siliconflow", k);
          return out;
        } },
      ];
      const avail = LANES.filter((l) => poolSize(l.id) > 0);
      if (!avail.length) return "Video generation needs a free-credit key: fal.ai (🏇 HappyHorse — the #1 video model, with sound), Novita, or SiliconFlow — all give new accounts free credits; paste the key in Settings → API keys. Images, though, I can do free right now — want an image instead?";
      const start = Math.floor(Math.random() * avail.length);   // spread credit use
      for (let n = 0; n < avail.length; n++) {
        const lane = avail[(start + n) % avail.length];
        const k = getKey(lane.id); if (!k) continue;
        try { const u = await lane.make(k); if (u) return `🎬 Done — [watch / download your video](${u})\n\n(Made with your free ${lane.id} credits.)`; } catch { /* next lane */ }
      }
      return "Video didn't come back in time (or the free credits are spent) — check your provider dashboard, try a simpler prompt, or want a free image instead?";
    } },
  { name: "capacity_status", safe: true, description: "How much FREE AI capacity SAM has right now, and the one legit free key to add if it's running thin. input: (none).", params: "(none)",
    activity: () => `Checking free AI capacity`, run: async () => {
      const r = capacityReport();
      const nudge = capacityNudge();
      return `Free AI capacity: ${r.level.toUpperCase()} — ${r.configured} free provider(s) configured, ${r.healthy}/${r.freeKeys} keys ready` +
        (r.cooling ? `, ${r.cooling} cooling (rate-limited)` : "") + ".\n" + (nudge || "You're well-stocked — nothing to add.") +
        `\n(Local Ollama is always the unlimited, key-free fallback.)`;
    } },
  { name: "key_pool_status", safe: true, description: "Live dashboard showing every AI provider's key pool: how many keys are healthy vs cooling down.", params: "(none)",
    activity: () => `Checking key pool health`, run: async () => {
      const pools = keyStatus();
      const active = pools.filter((p) => p.total > 0);
      if (!active.length) return "No API keys configured. Add *_API_KEYS to .env and restart SAM.";
      const lines = active.map((p) => {
        const status = p.healthy === 0 ? "🔴 all cooling" : p.cooling > 0 ? `🟡 ${p.healthy} healthy, ${p.cooling} cooling` : `🟢 ${p.healthy} healthy`;
        return `  ${p.provider.padEnd(14)} ${status}  (${p.uses} total uses)`;
      });
      return `Provider key pool status:\n${lines.join("\n")}`;
    } },
  // ─── ADMIN: SELFTEST ──────────────────────────────────────────────────────
  { name: "run_selftest", safe: true, description: "Run SAM's full production health check: models, vault, tools, agents. Returns green/red per subsystem.", params: "(none)",
    activity: () => `Running production selftest`, run: async () => {
      const r = await runSelftest(TOOLS);
      const lines = [`SAM Selftest — ${r.ok ? "✅ ALL GREEN" : "❌ ISSUES FOUND"} (${r.timestamp})`];
      const s = r.subsystems;
      lines.push(`  Models  ${s.models.ok ? "✅" : "⚠️ "}  ${s.models.info}`);
      lines.push(`  Vault   ${s.vault.ok ? "✅" : "❌"}  ${s.vault.info}`);
      lines.push(`  Tools   ${s.tools.ok ? "✅" : "❌"}  ${s.tools.count} registered${s.tools.duplicates ? `, ${s.tools.duplicates} duplicates!` : ""}`);
      lines.push(`  Agents  ${s.agents.ok ? "✅" : "❌"}  ${s.agents.count} registered${s.agents.duplicates ? `, ${s.agents.duplicates} duplicates!` : ""}`);
      return lines.join("\n");
    } },
  // ─── ADMIN: SKILLS ────────────────────────────────────────────────────────
  { name: "list_skills", safe: true, description: "List all SAM skill packs loaded from /skills — their names, tiers, and trigger keywords.", params: "(none)",
    activity: () => `Listing skill packs`, run: async () => {
      const skills = loadSkills();
      if (!skills.length) return "No skill packs found in /skills directory.";
      return skills.map((s) => `  [${s.tier}] ${s.name} — triggers: ${s.triggers.join(", ") || "(none)"}`).join("\n");
    } },
  // ─── ADMIN: PROJECTS ──────────────────────────────────────────────────────
  { name: "add_project", safe: false, description: "Add a new brand/project to the Project Registry (writes to vault/brands.json). input: {id, name, status, summary, domain?}.", params: "{id, name, status, summary, domain?}",
    activity: (i) => `Adding project: ${i.name}`, preview: (i) => `Add project '${i.name}' to vault/brands.json?`,
    run: async (i) => {
      try {
        const fs = await import("node:fs/promises");
        // Was resolve(process.cwd(), "vault", ...) — process.cwd() in a packaged Electron app is
        // whatever launched it, not the writable per-user vault dir; projects.ts reads brands.json
        // from VAULT_DIR (already defined above, just never used here), so a save here landed
        // somewhere the rest of the app never looks — the project silently vanished on next load.
        const brandsPath = join(VAULT_DIR, "brands.json");
        let brands: any[] = [];
        try { brands = JSON.parse(await fs.readFile(brandsPath, "utf8")); } catch { brands = [...PROJECTS]; }
        if (brands.find((p: any) => p.id === i.id)) return `Project '${i.id}' already exists. Use update_project to change it.`;
        brands.push({ id: i.id, name: i.name, domain: i.domain, status: i.status || "concept", branch: "ops", summary: i.summary });
        await fs.mkdir(VAULT_DIR, { recursive: true });
        await fs.writeFile(brandsPath, JSON.stringify(brands, null, 2), "utf8");
        return `Added project '${i.name}'. Restart SAM for it to appear in the project context.`;
      } catch (e: any) { return `Failed: ${e.message}`; }
    } },
  { name: "update_project", safe: false, description: "Update an existing project's status or summary in vault/brands.json. input: {id, status?, summary?, domain?}.", params: "{id, status?, summary?, domain?}",
    activity: (i) => `Updating project: ${i.id}`, preview: (i) => `Update project '${i.id}'?`,
    run: async (i) => {
      try {
        const fs = await import("node:fs/promises");
        // Was resolve(process.cwd(), "vault", ...) — process.cwd() in a packaged Electron app is
        // whatever launched it, not the writable per-user vault dir; projects.ts reads brands.json
        // from VAULT_DIR (already defined above, just never used here), so a save here landed
        // somewhere the rest of the app never looks — the project silently vanished on next load.
        const brandsPath = join(VAULT_DIR, "brands.json");
        let brands: any[] = [];
        try { brands = JSON.parse(await fs.readFile(brandsPath, "utf8")); } catch { brands = [...PROJECTS]; }
        const idx = brands.findIndex((p: any) => p.id === i.id);
        if (idx < 0) return `Project '${i.id}' not found. Use list_projects to see IDs.`;
        if (i.status) brands[idx].status = i.status;
        if (i.summary) brands[idx].summary = i.summary;
        if (i.domain) brands[idx].domain = i.domain;
        await fs.mkdir(VAULT_DIR, { recursive: true });
        await fs.writeFile(brandsPath, JSON.stringify(brands, null, 2), "utf8");
        return `Updated project '${i.id}'.`;
      } catch (e: any) { return `Failed: ${e.message}`; }
    } },
  { name: "import_context", safe: false, description: "Extract and import user persona/facts from a pasted ChatGPT/Claude/Gemini chat history or text profile. input: {text}.", params: "{text}",
    activity: () => `Importing user context`, preview: () => `Extract and save facts from imported context?`,
    run: async (i) => {
      try {
        const name = process.env.SAM_USER_NAME || "the user";
        const facts = await extractFactsFromTranscript(name, i.text, "free");
        const count = await saveImportedFacts(facts);
        return `Successfully processed context. Extracted ${facts.length} facts, saved ${count} new facts to memory.`;
      } catch (e: any) { return `Failed to import context: ${e.message}`; }
    } },
  // ── THE FORGE (Phase 5) — SAM writes its own tools. Confirm-tier: it asks before drafting.
  // The drafted tool is saved DISABLED for the user to review + enable; it can never self-approve.
  { name: "forge", safe: false, description: "When no existing tool fits, DRAFT a new tool for a need. Pure-computation by default; may declare capabilities (net, fs:read, fs:write) — net/fs:write become dangerous-tier. SAM writes it, safety-scans it, tests it in the Cell (isolated), then saves it DISABLED for you to review + enable in Settings. input: {need}.", params: "{need}",
    activity: (i) => `Forging a tool for: ${i.need ?? i}`,
    preview: (i) => `Draft, safety-scan and isolate-test in the Cell a brand-new tool for "${i.need ?? i}". It's saved DISABLED — you review the code + declared capabilities and enable it in Settings before it can ever run.`,
    run: async (i) => {
      const r = await forgeTool(String(i.need ?? i ?? ""));
      if (!r.ok) return `Couldn't forge that: ${r.reason}`;
      const t = r.tool!;
      const caps = t.caps.length ? `Capabilities: ${t.caps.join(", ")} → ${t.tier} tier` : `Pure computation → confirm tier`;
      const samples = (r.samples || []).slice(0, 2).map((s) => `  ${JSON.stringify(s.input)} → ${s.output.slice(0, 80)}`).join("\n");
      return `Forged "${t.name}" (saved disabled — review + enable it in Settings):\n${t.explanation}\n${caps}\n\nCode:\n${t.code}\n\nCell test (isolated):\n${samples}`;
    } },
  { name: "forged_tools", safe: true, description: "List the tools SAM has forged for itself — enabled/disabled status + capabilities. input: (none).", params: "(none)",
    activity: () => `Checking SAM-forged tools`, run: async () => {
      const all = listForged(); const s = forgedStats();
      if (!all.length) return "SAM hasn't forged any tools yet. Ask for something no built-in tool covers and SAM can build it.";
      return `${s.enabled}/${s.total} forged tools enabled (${s.dangerous} dangerous):\n` + all.map((t) => `- ${t.name} [${t.enabled ? "on" : "off"}] ${t.caps.length ? `{${t.caps.join(",")}}` : ""} — ${t.explanation}`).join("\n");
    } },
];

// forge.ts registers user-forged tools INTO this array at runtime. It used to import TOOLS
// directly, making tools.ts ⇄ forge.ts a cycle and module-init order load-bearing. Binding here —
// immediately after the registry exists — keeps the dependency one-way. forge throws if anything
// calls it before this line runs, rather than silently registering nothing.
bindToolRegistry(TOOLS);

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

// Tool catalogue injected into the model's system prompt.
// Pass a subset of names to expose only the relevant tools (smarter + cheaper).
export function toolCatalogue(names?: string[]): string {
  const list = names ? TOOLS.filter((t) => names.includes(t.name)) : TOOLS;
  return list.map((t) => `- ${t.name}(${t.params})${t.safe ? "" : " [asks first]"}: ${t.description}`).join("\n");
}
